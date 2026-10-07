import * as path from "path";
import type { DiffDTO } from "../shared/types";

// 提交安全网规则引擎（C# CommitSafetyScanner 移植，ai-native-redesign.md §4.2）。
// 纯函数零 AI 依赖；只扫新增行；注释行豁免。

export type Severity = "warning" | "blocked";

export interface RuleFinding {
  ruleId: string;
  severity: Severity;
  filePath: string;
  line: number | null;
  message: string;
}

export const RULE_SECRET = "secret.leak";
export const RULE_DEBUG = "debug.residue";
export const RULE_LARGE_FILE = "large.file";
export const RULE_BINARY = "binary.incoming";

export interface SafetyOptions {
  largeFileAddedLineThreshold: number;
  exemptPaths: string[];
}

export const SAFETY_DEFAULTS: SafetyOptions = { largeFileAddedLineThreshold: 2000, exemptPaths: [] };

const AWS_KEY = /AKIA[0-9A-Z]{16}/i;
const PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----/;
const GITHUB_TOKEN = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/;
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/;
const AI_KEY = /\bsk-(?:ant-)?(?:proj-)?[A-Za-z0-9_-]{20,}\b/;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/;
const KV_SECRET = /(?:api[_-]?key|secret|token|password|passwd|pwd)["']?\s*[:=]\s*["']?([^"'\r\n]{8,})/i;
const KV_PLACEHOLDER =
  /(process\.env|os\.environ|ENV\[|getenv|Environment\.GetEnvironmentVariable|Configuration|appsettings|<[^>]*>|\{\{|\$\{|\$\(|%\(|\*+|x{3,}|XXXX|PLACEHOLDER|YOUR[_A-Z]|changeme|example|dummy|localhost|127\.0\.0\.1)/i;

const DEBUG_PATTERNS: { exts: string[]; pattern: RegExp }[] = [
  { exts: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"], pattern: /\bconsole\.(?:log|debug)\s*\(|\bdebugger\s*;/ },
  { exts: [".cs"], pattern: /System\.Diagnostics\.Debug\.WriteLine\s*\(/ },
  { exts: [".py"], pattern: /\bbreakpoint\s*\(\s*\)/ },
  { exts: [".rs"], pattern: /\bdbgi?\s*!/ },
];

export interface ScannableFile {
  path: string;
  patch: string | null; // index vs HEAD 的 unified diff；null = 无差异
  isBinary: boolean;
  isNew: boolean;
  addedLines: number;
  deletedLines: number;
}

/** 扫描全部文件，Blocked 在前。 */
export function scan(files: ScannableFile[], options?: Partial<SafetyOptions>): RuleFinding[] {
  const opts = { ...SAFETY_DEFAULTS, ...options };
  const findings: RuleFinding[] = [];
  for (const file of files) {
    if (isExempt(file.path, opts.exemptPaths)) continue;
    if (file.isBinary) {
      if (file.isNew) {
        findings.push({ ruleId: RULE_BINARY, severity: "warning", filePath: file.path, line: null, message: "二进制文件入库" });
      }
      continue;
    }
    scanPatch(file, findings);
    if (file.isNew && file.addedLines >= opts.largeFileAddedLineThreshold) {
      findings.push({
        ruleId: RULE_LARGE_FILE,
        severity: "warning",
        filePath: file.path,
        line: null,
        message: `新增 ${file.addedLines} 行，超过大文件阈值 ${opts.largeFileAddedLineThreshold}`,
      });
    }
  }
  const order: Record<Severity, number> = { blocked: 0, warning: 1 };
  return findings.sort((a, b) =>
    order[a.severity] - order[b.severity] ||
    a.filePath.localeCompare(b.filePath) ||
    (a.line ?? 0) - (b.line ?? 0),
  );
}

// ---- safetyRules 数据包规则（extension-system-v2.md §16.5 safetyRules 接缝，A 阶段）----
// 数据包规则恒为 warning 档：否决权（blocked）保留给内置规则 + 人审，包规则只有提示权。

export interface PackageRule {
  packageId: string;
  id: string;
  regex: RegExp;
  message: string;
  fileExts: string[];
}

/** 用包规则扫描新增行（注释行豁免与内置一致；severity 恒 warning）。 */
export function scanPackageRules(files: ScannableFile[], rules: PackageRule[]): RuleFinding[] {
  if (rules.length === 0) return [];
  const findings: RuleFinding[] = [];
  for (const file of files) {
    if (file.isBinary || !file.patch) continue;
    const ext = path.extname(file.path).toLowerCase();
    let newLineNo = 0;
    let inHunk = false;
    for (const raw of file.patch.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith("@@")) {
        inHunk = true;
        newLineNo = parseNewStart(line);
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith("-")) continue;
      if (line.startsWith("+")) {
        const content = line.slice(1);
        const trimmed = content.trimStart();
        const isComment =
          trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*");
        if (!isComment) {
          for (const rule of rules) {
            if (rule.fileExts.length > 0 && !rule.fileExts.includes(ext)) continue;
            if (rule.regex.test(content)) {
              findings.push({
                ruleId: rule.id,
                severity: "warning",
                filePath: file.path,
                line: newLineNo,
                message: `${rule.message}（${rule.packageId}）`,
              });
            }
          }
        }
        newLineNo++;
      } else if (line.length > 0) {
        newLineNo++;
      }
    }
  }
  return findings;
}

function scanPatch(file: ScannableFile, findings: RuleFinding[]) {
  if (!file.patch) return;
  let newLineNo = 0;
  let inHunk = false;
  for (const raw of file.patch.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("@@")) {
      inHunk = true;
      newLineNo = parseNewStart(line);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("-")) continue;
    if (line.startsWith("+")) {
      scanAddedLine(file.path, line.slice(1), newLineNo, findings);
      newLineNo++;
    } else if (line.length > 0) {
      newLineNo++;
    }
  }
}

function scanAddedLine(filePath: string, content: string, lineNo: number, findings: RuleFinding[]) {
  const trimmed = content.trimStart();
  // 注释行不算泄露/残留
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

  if (trimmed.startsWith("-----BEGIN") && PRIVATE_KEY_HEADER.test(content)) {
    findings.push({ ruleId: RULE_SECRET, severity: "blocked", filePath, line: lineNo, message: "疑似私钥块" });
    return;
  }
  if (AWS_KEY.test(content) || GITHUB_TOKEN.test(content) || SLACK_TOKEN.test(content) || AI_KEY.test(content) || JWT.test(content)) {
    findings.push({ ruleId: RULE_SECRET, severity: "blocked", filePath, line: lineNo, message: "疑似密钥/token 明文" });
    return;
  }
  const kv = KV_SECRET.exec(content);
  if (kv && !KV_PLACEHOLDER.test(kv[1])) {
    findings.push({ ruleId: RULE_SECRET, severity: "blocked", filePath, line: lineNo, message: "疑似明文密钥赋值" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  for (const { exts, pattern } of DEBUG_PATTERNS) {
    if (exts.includes(ext)) {
      if (pattern.test(content)) {
        findings.push({ ruleId: RULE_DEBUG, severity: "warning", filePath, line: lineNo, message: "调试输出残留" });
      }
      break;
    }
  }
}

function parseNewStart(hunkHeader: string): number {
  const m = /\+(\d+)/.exec(hunkHeader);
  return m ? parseInt(m[1], 10) || 1 : 1;
}

/** 豁免路径匹配（精确/目录前缀/通配 *）。 */
export function isExempt(p: string, exemptPaths: string[]): boolean {
  if (!exemptPaths || exemptPaths.length === 0) return false;
  const norm = p.replace(/\\/g, "/");
  for (const raw of exemptPaths) {
    if (!raw || !raw.trim()) continue;
    const pattern = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (norm.toLowerCase() === pattern.toLowerCase()) return true;
    if (raw.endsWith("/") || raw.endsWith("\\")) {
      if (norm.toLowerCase().startsWith((pattern + "/").toLowerCase())) return true;
    }
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : "\\" + c)) + "$", "i");
      if (regex.test(norm)) return true;
    } else if (norm.toLowerCase().startsWith((pattern + "/").toLowerCase())) {
      return true;
    }
  }
  return false;
}

// ---- 危险命令分级（agent-harness-v4.md F4.3：terminal_run 授权卡风险条 + yolo 豁口）----
// 纯函数；规则表数据化，safetyRules 包可按同一形状扩展（v4.1 数据可插件原则）。

export type CommandRisk = "high" | "medium";

/** high：不可逆/破坏性命令——yolo 模式仍强制 each-time 授权。 */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z-]*\s+)*-[a-z-]*[rf][a-z-]*\b/i, // rm -rf / -fr 等
  /\b(rm|del|rd|rmdir|erase)\b.*\b(\/s\b|\/q\b|-r\b|--recursive\b)/i,
  /\bformat\b[a-z]*\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bmkfs/i,
  /\breg\s+(delete|add)\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*[fd]/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+filter-branch\b/i,
  /\b(shutdown|reboot)\b/i,
  /\btaskkill\s+\/f\s+\/im\b/i,
  /\bRemove-Item\b.*(-Recurse|-Force)/i,
  /\bFormat-Volume\b/i,
  /\bdrop\s+(database|table)\b/i,
  /\btruncate\s+table\b/i,
];

/** medium：可恢复但有副作用——授权卡黄条提示。 */
const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /\bgit\s+checkout\b[^&;|]*--/,
  /\bgit\s+restore\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+rebase\b/,
  /\bgit\s+branch\s+-d\b/,
  /\bgit\s+stash\s+(drop|clear)\b/,
  /\bnpm\s+(uninstall|ci)\b/,
  /\bpnpm\s+(remove|install)\b.*--force/i,
  /\bdel\b\s+\/q\b/i,
  /\bRemove-Item\b/i,
  /\bgit\s+push\s+--delete\b/,
];

// ---- 包规则（§20.3.9：commandRiskRules L1，只上调不下降——max 语义合并）----

export interface PackageRiskRule {
  packageId: string;
  pattern: RegExp;
  risk: CommandRisk;
}

const PACKAGE_RISK_RULES: PackageRiskRule[] = [];

/** 包贡献的风险规则注册（bridge 在包装载/变更时全量重建）。 */
export function setPackageRiskRules(rules: PackageRiskRule[]): void {
  PACKAGE_RISK_RULES.splice(0, PACKAGE_RISK_RULES.length, ...rules);
}

/** 命令风险评估：拆分 ; && || 换行 后逐段匹配，任一段命中取最高级（内置表 + 包规则 max 合并）。 */
export function commandRisk(command: string): CommandRisk | null {
  const segments = command.split(/(?:&&|\|\||;|\r?\n)/g).map((s) => s.trim()).filter(Boolean);
  let risk: CommandRisk | null = null;
  for (const seg of segments) {
    if (HIGH_RISK_PATTERNS.some((re) => re.test(seg))) return "high";
    if (risk === null && MEDIUM_RISK_PATTERNS.some((re) => re.test(seg))) risk = "medium";
    for (const r of PACKAGE_RISK_RULES) {
      if (r.pattern.test(seg)) {
        if (r.risk === "high") return "high";
        if (risk === null) risk = "medium";
      }
    }
  }
  return risk;
}
