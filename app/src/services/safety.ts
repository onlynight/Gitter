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
