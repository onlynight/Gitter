import { scan, type RuleFinding, type ScannableFile } from "./safety";

/**
 * 风险信号面板（M2.2 harness-mainline-roadmap.md：ai-native-redesign.md §3.3 的 TS 落地）。
 * 纯规则零 AI 依赖（降级原则）；输入 = 改动文件集（path + unified patch + numstat），
 * 输出 = 逐文件信号与全库汇总。复用 safety.ts 密钥/残留特征，叠加路径家族与规模规则。
 */

export type RiskLevel = "high" | "medium" | "low";

export interface RiskSignal {
  level: RiskLevel;
  kind: string;
  message: string;
}

export interface RiskFileReport {
  path: string;
  added: number | null;
  deleted: number | null;
  isBinary: boolean;
  signals: RiskSignal[];
}

export interface RiskReport {
  files: RiskFileReport[];
  counts: { high: number; medium: number; low: number };
}

/** 敏感路径家族：命中即 medium（密钥类文件 high）。 */
const PATH_RULES: { re: RegExp; level: RiskLevel; kind: string; message: string }[] = [
  { re: /\.(env|pem|key|pfx|p12|jks|keystore)$/i, level: "high", kind: "path.secret", message: "敏感凭据类文件被改动" },
  { re: /(^|\/)\.env([./]|$)/i, level: "high", kind: "path.secret", message: "环境变量文件被改动（.env*）" },
  { re: /(^|\/)(secrets?|credentials?)([./]|$)/i, level: "high", kind: "path.secret", message: "凭据目录/文件被改动" },
  { re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|composer\.lock)$/i, level: "low", kind: "path.lockfile", message: "锁文件变更（依赖漂移）" },
  { re: /(^|\/)migrations?\//i, level: "medium", kind: "path.migration", message: "数据库迁移脚本变更" },
  { re: /(^|\/)\.github\/workflows\//i, level: "medium", kind: "path.ci", message: "CI 流水线定义变更" },
  { re: /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/i, level: "medium", kind: "path.container", message: "容器构建/编排定义变更" },
];

/** diff 新增行的破坏性语句特征（AI 高频事故；注释行豁免由 scan 统一处理）。 */
const CONTENT_RULES: { re: RegExp; level: RiskLevel; kind: string; message: string }[] = [
  { re: /\bDROP\s+(TABLE|DATABASE|INDEX|COLUMN)\b/i, level: "high", kind: "sql.drop", message: "新增行包含 DROP 语句" },
  { re: /\bDELETE\s+FROM\b(?![^;]{0,200}\bWHERE\b)/i, level: "high", kind: "sql.delete", message: "新增行包含无 WHERE 的 DELETE" },
  { re: /\bTRUNCATE\s+TABLE\b/i, level: "high", kind: "sql.truncate", message: "新增行包含 TRUNCATE" },
  { re: /\bgit\s+push\b[^\n]*(-f|--force)(?!\s*with-lease)/i, level: "high", kind: "git.force-push", message: "新增行包含强推命令" },
  { re: /\brm\s+-rf\b|\bRemove-Item\b[^\n]*-Recurse/i, level: "medium", kind: "shell.rmrf", message: "新增行包含递归删除命令" },
  { re: /\bchmod\s+[47]77\b/i, level: "medium", kind: "shell.chmod", message: "新增行包含放开全部权限" },
  { re: /\bcurl\b[^\n]*\|\s*(ba)?sh\b/i, level: "medium", kind: "shell.pipe", message: "新增行包含管道执行远程脚本" },
];

const LARGE_DIFF_LINES = 500;
const BIG_DELETE_LINES = 300;

/** 汇总风险报告：路径规则 + 内容规则（新增行）+ safety 密钥扫描 + 规模规则。 */
export function scanRiskSignals(files: {
  path: string;
  patch?: string | null;
  added?: number | null;
  deleted?: number | null;
  isBinary?: boolean;
}[]): RiskReport {
  const out: RiskFileReport[] = [];
  const counts = { high: 0, medium: 0, low: 0 };
  const scannable: ScannableFile[] = [];

  for (const f of files) {
    const signals: RiskSignal[] = [];
    const norm = f.path.replace(/\\/g, "/");
    for (const r of PATH_RULES) {
      if (r.re.test(norm)) signals.push({ level: r.level, kind: r.kind, message: r.message });
    }
    const added = f.added ?? 0;
    const deleted = f.deleted ?? 0;
    const total = added + deleted;
    if (total >= LARGE_DIFF_LINES) {
      signals.push({ level: "medium", kind: "size.large", message: `单文件变更 ${total} 行（≥${LARGE_DIFF_LINES}），建议拆分或重点审阅` });
    }
    if (deleted >= BIG_DELETE_LINES && (f.added ?? 0) <= 10) {
      signals.push({ level: "medium", kind: "size.mass-delete", message: `删除 ${deleted} 行而几乎无新增——确认是否有意为之` });
    }
    if (!f.isBinary && f.patch) {
      // 无 @@ 头的裸 patch（伪 diff / 手工拼装）直接从正文扫起；有 @@ 头按标准 hunk 走
      let inHunk = !f.patch.includes("@@");
      let lineNo = 1;
      for (const raw of f.patch.split("\n")) {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith("@@")) {
          inHunk = true;
          lineNo = Number(/(?<=\+)(\d+)/.exec(line)?.[1] ?? 1);
          continue;
        }
        if (!inHunk) continue;
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("-")) continue;
        if (line.startsWith("+")) {
          const content = line.slice(1);
          const trimmed = content.trimStart();
          const isComment = trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*");
          if (!isComment) {
            for (const r of CONTENT_RULES) {
              if (r.re.test(content)) signals.push({ level: r.level, kind: r.kind, message: `${r.message}（第 ${lineNo} 行）` });
            }
          }
          lineNo++;
        } else if (line.length > 0) {
          lineNo++;
        }
      }
    }
    const isBinary = !!f.isBinary;
    if (!isBinary && f.patch) scannable.push({ path: f.path, patch: f.patch, isBinary: false, isNew: false, addedLines: added, deletedLines: deleted });
    out.push({ path: f.path, added: f.added ?? null, deleted: f.deleted ?? null, isBinary, signals: dedupe(signals) });
  }

  // 密钥/残留特征（safety 引擎，blocked → high、warning → low；仅看 patch，提交安全网另行跑）
  const findings: RuleFinding[] = scan(scannable, { largeFileAddedLineThreshold: 100_000 });
  for (const fd of findings) {
    const target = out.find((x) => x.path === fd.filePath);
    if (!target) continue;
    if (fd.ruleId === "secret.leak") {
      target.signals.push({ level: "high", kind: "content.secret", message: `${fd.message}（第 ${fd.line ?? "?"} 行）` });
    } else if (fd.ruleId === "debug.residue") {
      target.signals.push({ level: "low", kind: "content.debug", message: `${fd.message}（第 ${fd.line ?? "?"} 行）` });
    }
  }

  for (const f of out) {
    f.signals.sort((a, b) => rank(b.level) - rank(a.level));
    for (const s of f.signals) counts[s.level]++;
  }
  out.sort((a, b) => {
    const ta = a.signals[0]?.level ?? null;
    const tb = b.signals[0]?.level ?? null;
    if (ta !== tb) return rank(tb) - rank(ta);
    return a.path.localeCompare(b.path);
  });
  return { files: out, counts };
}

function rank(l: RiskLevel | null): number {
  return l === "high" ? 3 : l === "medium" ? 2 : l === "low" ? 1 : 0;
}

function dedupe(signals: RiskSignal[]): RiskSignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const k = `${s.kind}:${s.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const RISK_RULE_COUNT = PATH_RULES.length + CONTENT_RULES.length;
