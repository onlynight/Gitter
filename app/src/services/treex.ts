import * as fsp from "fs/promises";
import * as path from "path";
import { tryGit } from "./gitexec";
import * as status from "./gitstatus";
import type { FileStatusDTO } from "../shared/types";

/**
 * 项目文件树聚合（editor-design.md §2.1）：
 * 以 `git ls-files -co --exclude-standard` 为骨架（已过滤 .gitignore），
 * 叠加 git 状态分类与 agent 回合改动索引，一次返回全量供前端虚拟化渲染。
 * 骨架对磁盘校正：ls-files -c 只看索引不看工作区，「索引里有、磁盘上已删」
 * 的文件（AD / D）会被剔除——否则树上留下打不开、刷不掉的幽灵条目。
 *
 * 不做分层懒拉：中型仓库单次 <50ms，全量返回让前端可自由展开折叠，
 * 避免懒拉时的目录占位与重排抖动。大型仓库用 prefix 参数分片。
 */

/** 单条树条目。isDir=true 表示目录聚合节点（前端展开用）。 */
export interface TreeEntry {
  path: string;
  isDir: boolean;
  /** git 状态码 (M/A/D/R/U/?)；null = 未改动 */
  status: string | null;
  /** 是否被 agent 本回合碰过（agent.task.files 命中） */
  touchedByAgent: boolean;
}

export interface TreeResult {
  entries: TreeEntry[];
  /** true = 还有更多（prefix 分页场景）；全量返回恒 false */
  hasMore: boolean;
}

/** 状态码映射：porcelain 真实字母（staged 取 index 位——暂存的修改是 M 不是 A）；
 * 冲突归 U、未跟踪归 ?。与 ChangesPage 的 statusLetter 语义对齐。 */
function statusLetter(f: FileStatusDTO): string {
  if (f.isConflict) return "U";
  if (f.category === "unversioned") return "?";
  return f.code?.[0] ?? "M";
}

/** 从 git ls-files 输出构建目录聚合节点集合。 */
function buildDirSet(paths: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) {
    // 逐层收集父目录（去掉文件名后的所有前缀）
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  return dirs;
}

/**
 * 列出文件树。
 *
 * @param workDir  仓库根
 * @param prefix   可选前缀过滤（如 "src/"，用于大型仓库分片）
 * @param touched  agent 本回合改动文件集合（来自 agent.task.files）
 */
export async function listTree(
  workDir: string,
  prefix: string,
  touched: Set<string>,
): Promise<TreeResult> {
  const r = await tryGit(workDir, ["ls-files", "-co", "--exclude-standard"]);
  const all = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // git 状态索引（含 unversioned，因为 ls-files -co 已包含未跟踪文件）
  const st = await status.getStatus(workDir);
  const statusMap = new Map<string, string>();
  for (const f of [...st.changes, ...st.staged, ...st.unversioned, ...st.conflicts]) {
    statusMap.set(f.path, statusLetter(f));
  }

  // 磁盘校正：worktree 位为 D（" D" 删除未暂存 / "AD" 暂存后删除）或冲突含 D 的条目
  // 是「索引里有、磁盘上已删」的幽灵，逐一 stat 确认后剔除——status 可能瞬时陈旧，以磁盘为准
  const missing = new Set<string>();
  for (const f of st.changes) {
    if (f.code === "D") missing.add(f.path);
  }
  for (const f of st.conflicts) {
    if (f.code?.includes("D")) missing.add(f.path);
  }
  const gone = new Set<string>();
  await Promise.all([...missing].map(async (p) => {
    if (!(await fsp.lstat(path.resolve(workDir, p)).catch(() => null))) gone.add(p);
  }));

  const base = prefix ? all.filter((p) => p.startsWith(prefix)) : all;
  const filtered = base.filter((p) => !gone.has(p));

  const dirs = buildDirSet(filtered);

  const entries: TreeEntry[] = [];
  // 目录优先（聚合节点），文件按路径排序
  for (const d of [...dirs].sort()) {
    entries.push({ path: d, isDir: true, status: null, touchedByAgent: false });
  }
  for (const p of [...filtered].sort()) {
    entries.push({
      path: p,
      isDir: false,
      status: statusMap.get(p) ?? null,
      touchedByAgent: touched.has(p),
    });
  }

  return { entries, hasMore: false };
}

/**
 * 文件内容读取（editor-design.md §2.2）。
 * 不设 64K 字符 cap（区别于 agent.task.previewFile，那是给 agent 上下文用的），
 * 8 MB 上限；返回 mtime/eol 供编辑器做冲突检测与保存时保留行尾。
 * 编码：自动嗅探 UTF-8(BOM)/GBK（Windows 中文场景常见 ANSI/GBK 日志与老代码），
 * 也可显式指定 encoding（「以编码重新打开」，强制档不做有效性校验，非法字节替换）。
 */
export type TextEncoding = "utf8" | "gbk";

export interface FileContentResult {
  content: string;
  encoding: TextEncoding;
  /** 读到的文件带 UTF-8 BOM（保存时还原；BOM 字符不进 content） */
  bom: boolean;
  eol: "crlf" | "lf";
  size: number;
  mtime: number;
  binary: boolean;
  truncated: boolean;
  revision: string;
}

/** 行尾嗅探：CRLF 优先（Windows 默认），否则 LF。 */
export function detectEol(buf: Buffer): "crlf" | "lf" {
  // 扫描前 64KB 即可判定，避免大文件全量扫描
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  for (let i = 0; i < sample.length - 1; i++) {
    if (sample[i] === 0x0a) {
      // LF
      if (i === 0 || sample[i - 1] !== 0x0d) return "lf";
    }
  }
  // 全部是 CRLF 或无换行符
  if (sample.includes(0x0d)) return "crlf";
  return "lf";
}

/** NUL 嗅探：二进制检测。 */
export function isBinary(buf: Buffer): boolean {
  // 前 4096 字节内出现 NUL 即判为二进制（UTF-8 文本不可能有 NUL）
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  return sample.includes(0);
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

/** 编码嗅探：BOM → utf8(bom)；严格 UTF-8 解码失败 → gbk（GBK 几乎全字节域合法，作兜底）。 */
export function detectEncoding(buf: Buffer): { encoding: TextEncoding; bom: boolean } {
  if (buf.length >= 3 && buf[0] === UTF8_BOM[0] && buf[1] === UTF8_BOM[1] && buf[2] === UTF8_BOM[2]) {
    return { encoding: "utf8", bom: true };
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { encoding: "utf8", bom: false };
  } catch {
    return { encoding: "gbk", bom: false };
  }
}

/** 按编码解码（强制档不做有效性校验：utf8 用非 fatal 容忍替换符，gbk 解不动回退 utf8）。 */
function decodeByEncoding(buf: Buffer, encoding: TextEncoding, bom: boolean): string {
  const body = bom ? buf.subarray(3) : buf;
  if (encoding === "gbk") {
    try {
      return new TextDecoder("gbk").decode(body);
    } catch {
      return body.toString("utf8");
    }
  }
  return body.toString("utf8");
}

export async function readFileContent(
  workDir: string,
  rel: string,
  revision: "worktree" | "index" | string = "worktree",
  maxBytes = 8 * 1024 * 1024,
  encoding?: TextEncoding,
): Promise<FileContentResult | null> {
  // 路径锁：resolve + realpath 双重校验
  const abs = path.resolve(workDir, rel);
  const realWt = await fsp.realpath(workDir).catch(() => workDir);
  const relCheck = path.relative(realWt, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return null; // 越界
  }

  let buf: Buffer | null = null;
  let fromIndex = false;

  if (revision === "index") {
    // 读 git index（暂存版本）
    const stat = await tryGit(workDir, ["cat-file", "-s", `:${rel}`]);
    if (stat.code === 0 && parseInt(stat.stdout.trim(), 10) <= maxBytes) {
      const show = await tryGit(workDir, ["show", `:${rel}`]);
      if (show.code === 0) {
        buf = Buffer.from(show.stdout, "utf8");
        fromIndex = true;
      }
    }
  } else if (revision === "HEAD" || /^[0-9a-f]{40}$/.test(revision)) {
    // git rev（HEAD / 对象 hash）：文件不在该版本里（未跟踪新文件）→ null。
    // tryGit 已按 UTF-8 解码，重编码必须走 utf8——"binary"（latin1）会把
    // 多字节字符压成单字节（U+4E00 → 0x00 NUL），非 ASCII 内容全体变 mojibake
    const show = await tryGit(workDir, ["show", `${revision}:${rel}`]);
    if (show.code === 0) {
      buf = Buffer.from(show.stdout, "utf8");
    }
  } else {
    // worktree（默认）
    try {
      const st = await fsp.stat(abs);
      if (st.size > maxBytes) {
        const truncated = await fsp.readFile(abs).then(b => b.subarray(0, maxBytes));
        const det = encoding ? { encoding, bom: false } : detectEncoding(truncated);
        return {
          content: decodeByEncoding(truncated, det.encoding, det.bom),
          encoding: det.encoding,
          bom: det.bom,
          eol: detectEol(truncated),
          size: st.size,
          mtime: st.mtimeMs,
          binary: false,
          truncated: true,
          revision: "worktree",
        };
      }
      buf = await fsp.readFile(abs);
    } catch {
      return null; // 文件不存在
    }
  }

  if (buf === null) return null;

  if (buf.length > maxBytes) {
    buf = buf.subarray(0, maxBytes);
  }

  // NUL 嗅探
  if (isBinary(buf)) {
    return {
      content: "",
      encoding: "utf8",
      bom: false,
      eol: "lf",
      size: buf.length,
      mtime: 0,
      binary: true,
      truncated: false,
      revision,
    };
  }

  let mtime = 0;
  if (!fromIndex) {
    try {
      const st = await fsp.stat(abs);
      mtime = st.mtimeMs;
    } catch {
      mtime = 0;
    }
  }

  // 编码：显式指定（重新打开）优先，否则嗅探；git index/HEAD 基线恒按 UTF-8
  const det = fromIndex
    ? { encoding: "utf8" as TextEncoding, bom: false }
    : (encoding ? { encoding, bom: encoding === "utf8" && buf[0] === UTF8_BOM[0] && buf[1] === UTF8_BOM[1] && buf[2] === UTF8_BOM[2] } : detectEncoding(buf));

  return {
    content: decodeByEncoding(buf, det.encoding, det.bom),
    encoding: det.encoding,
    bom: det.bom,
    eol: detectEol(buf),
    size: buf.length,
    mtime,
    binary: false,
    truncated: false,
    revision,
  };
}

/**
 * 文件写入（editor-design.md §2.3）。
 * 复用 fsx 的路径锁与 2MB 写入护栏，但**不走 readLog 校验**——
 * 编辑器自己就是读文件的一方，刚读过就写，不需要"先读再写"校验。
 *
 * 写成功后由调用方刷新 env.readLog（让 agent 的 file_patch 能通过 mtime 校验）。
 */
export interface FileWriteResult {
  ok: boolean;
  size: number;
  mtime: number;
  error?: "size_limit" | "path_locked" | "binary" | "write_failed";
}

export const MAX_WRITE_BYTES = 2 * 1024 * 1024;

/**
 * 二进制文档通道（office-integration-plan.md §5/§10）：
 * 预览格式扩展名走白名单——二进制容器不做 NUL 嗅探、不做 EOL 变换，
 * 以 base64 进出 RPC。读写上限独立于文本通道（读 50MB / 写 20MB）：
 * 复杂工作簿/演示文稿 5–20MB 常见，文本通道的 2MB 写护栏不适用。
 * §10 预览-only：页面侧只用读半边（office 页无写权限）；写半边保留给 agent。
 * 白名单 = OOXML 家族 + §10.6 扩展的 .pdf / .ods（csv/tsv 走既有文本通道）。
 */
const BINARY_DOC_EXTS = new Set([
  ".pptx", ".pptm", ".ppsx", ".potx",
  ".docx", ".docm", ".dotx",
  ".xlsx", ".xlsm", ".xltx",
  ".pdf", ".ods",
]);

/** 图片族（与任务面板 IMG_RE 同集）：file.readBinary 通道放行只读预览，写入仍限 OOXML */
const BINARY_IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico",
]);

export function isBinaryDocPath(rel: string): boolean {
  const i = rel.lastIndexOf(".");
  return i >= 0 && BINARY_DOC_EXTS.has(rel.slice(i).toLowerCase());
}

export function isBinaryImagePath(rel: string): boolean {
  const i = rel.lastIndexOf(".");
  return i >= 0 && BINARY_IMAGE_EXTS.has(rel.slice(i).toLowerCase());
}

export const MAX_BINARY_READ_BYTES = 50 * 1024 * 1024;
export const MAX_BINARY_WRITE_BYTES = 20 * 1024 * 1024;

export interface BinaryContentResult {
  base64: string;
  size: number;
  mtime: number;
  /** 超读上限：base64 为空串（zip 截断半包无意义），前端提示过大 */
  truncated: boolean;
}

/** 轻量 stat（office 页顶栏大小显示；避免为显示体积拉全量 base64）。 */
export async function statFile(
  workDir: string,
  rel: string,
): Promise<{ size: number; mtime: number } | null> {
  const abs = path.resolve(workDir, rel);
  const realWt = await fsp.realpath(workDir).catch(() => workDir);
  const relCheck = path.relative(realWt, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return null;
  }
  try {
    const st = await fsp.stat(abs);
    return { size: st.size, mtime: st.mtimeMs };
  } catch {
    return null;
  }
}

export async function readBinaryContent(
  workDir: string,
  rel: string,
): Promise<BinaryContentResult | null> {
  if (!isBinaryDocPath(rel) && !isBinaryImagePath(rel)) return null; // 白名单外不走二进制通道（防绕过文本嗅探）
  const abs = path.resolve(workDir, rel);
  const realWt = await fsp.realpath(workDir).catch(() => workDir);
  const relCheck = path.relative(realWt, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return null;
  }
  try {
    const st = await fsp.stat(abs);
    if (st.size > MAX_BINARY_READ_BYTES) {
      return { base64: "", size: st.size, mtime: st.mtimeMs, truncated: true };
    }
    const buf = await fsp.readFile(abs);
    return { base64: buf.toString("base64"), size: buf.length, mtime: st.mtimeMs, truncated: false };
  } catch {
    return null;
  }
}

export async function writeBinaryContent(
  workDir: string,
  rel: string,
  base64: string,
): Promise<FileWriteResult> {
  if (!isBinaryDocPath(rel)) {
    // 写入仍限 OOXML 文档——图片族只进只读预览通道，页内不回写
    return { ok: false, size: 0, mtime: 0, error: "binary" };
  }
  const abs = path.resolve(workDir, rel);
  const realWt = await fsp.realpath(workDir).catch(() => workDir);
  const relCheck = path.relative(realWt, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return { ok: false, size: 0, mtime: 0, error: "path_locked" };
  }
  const buf = Buffer.from(base64, "base64");
  if (buf.length > MAX_BINARY_WRITE_BYTES) {
    return { ok: false, size: buf.length, mtime: 0, error: "size_limit" };
  }
  try {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, buf);
    const st = await fsp.stat(abs);
    return { ok: true, size: st.size, mtime: st.mtimeMs };
  } catch {
    return { ok: false, size: buf.length, mtime: 0, error: "write_failed" };
  }
}

export async function writeFileContent(
  workDir: string,
  rel: string,
  content: string,
  eol?: "crlf" | "lf",
  encoding: TextEncoding = "utf8",
  bom = false,
): Promise<FileWriteResult> {
  // 路径锁
  const abs = path.resolve(workDir, rel);
  const realWt = await fsp.realpath(workDir).catch(() => workDir);
  const relCheck = path.relative(realWt, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return { ok: false, size: 0, mtime: 0, error: "path_locked" };
  }

  // 行尾归一：编辑器保存时必须保留原行尾，否则 git diff 会显示整文件改动
  let text = content;
  if (eol) {
    // 先统一为 LF，再按目标行尾转换
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (eol === "crlf") text = text.replace(/\n/g, "\r\n");
  }

  // 编码：GBK 需 full-ICU（Electron 默认带）；编码不可用回退 UTF-8 保内容不丢
  let buf: Buffer;
  if (encoding === "gbk") {
    try {
      // BufferEncoding 类型档不含 ICU 扩展编码，运行时（full-ICU）可用；不支持则抛错回退
      buf = Buffer.from(text, "gbk" as unknown as BufferEncoding);
    } catch {
      buf = Buffer.from(text, "utf8");
    }
  } else {
    buf = Buffer.from(text, "utf8");
    if (bom) buf = Buffer.concat([Buffer.from(UTF8_BOM), buf]);
  }
  if (buf.length > MAX_WRITE_BYTES) {
    return { ok: false, size: buf.length, mtime: 0, error: "size_limit" };
  }

  // NUL 嗅探：拒绝写入二进制文件（避免误改）
  if (buf.includes(0)) {
    return { ok: false, size: buf.length, mtime: 0, error: "binary" };
  }

  try {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, buf);
    const st = await fsp.stat(abs);
    return { ok: true, size: st.size, mtime: st.mtimeMs };
  } catch {
    return { ok: false, size: buf.length, mtime: 0, error: "write_failed" };
  }
}

/** 批量轻量 stat（外部变更监听：打开标签的 mtime 校验一次往返）。 */
export async function statMany(
  workDir: string,
  rels: string[],
): Promise<{ path: string; mtime: number; size: number }[]> {
  const out: { path: string; mtime: number; size: number }[] = [];
  for (const rel of rels) {
    const st = await statFile(workDir, rel);
    if (st) out.push({ path: rel, mtime: st.mtime, size: st.size });
  }
  return out;
}

/**
 * 跨文件全文搜索（files 页全局搜索，Ctrl+Shift+F）：
 * git grep（-I 跳二进制、--untracked 含未跟踪），定长/正则两档、大小写开关。
 * 列式解析 path:line:text（路径含冒号的极端场景罕见，接受）；结果截断到 max。
 */
export interface SearchHit {
  file: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchHit[];
  truncated: boolean;
  error?: string;
}

export async function searchWorkspace(
  workDir: string,
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean; max?: number } = {},
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { matches: [], truncated: false };
  const max = Math.min(Math.max(opts.max ?? 300, 1), 1000);
  const args = [
    "grep", "-n", "-I", "--untracked", "--no-color",
    ...(opts.regex ? [] : ["-F"]),
    ...(opts.caseSensitive ? [] : ["-i"]),
    "-e", q,
  ];
  const r = await tryGit(workDir, args);
  if (r.code > 1) return { matches: [], truncated: false, error: r.stderr.trim() || "git grep 失败" };
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  const matches: SearchHit[] = [];
  for (const ln of lines) {
    const c1 = ln.indexOf(":");
    if (c1 <= 0) continue;
    const c2 = ln.indexOf(":", c1 + 1);
    if (c2 <= 0) continue;
    const lineNo = parseInt(ln.slice(c1 + 1, c2), 10);
    if (!Number.isFinite(lineNo)) continue;
    matches.push({ file: ln.slice(0, c1), line: lineNo, text: ln.slice(c2 + 1) });
    if (matches.length >= max) return { matches, truncated: true };
  }
  return { matches, truncated: false };
}

/** git blame --line-porcelain 解析（files 页编辑器悬停归属）。 */
export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  /** unix 秒；0 = 解析不到 */
  time: number;
  summary: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;

export async function blameFile(workDir: string, rel: string): Promise<BlameLine[]> {
  const r = await tryGit(workDir, ["blame", "--line-porcelain", "--", rel]);
  if (r.code !== 0) return [];
  const out: BlameLine[] = [];
  let cur: Partial<BlameLine> = {};
  for (const ln of r.stdout.split(/\r?\n/)) {
    if (SHA_RE.test(ln.slice(0, 40)) && (ln[40] === " " || ln.length === 40)) {
      if (cur.line !== undefined) out.push(cur as BlameLine);
      // <sha> <orig-line> <final-line> [<num-lines>]
      cur = { sha: ln.slice(0, 40), line: parseInt(ln.split(/\s+/)[2], 10) || out.length + 1 };
    } else if (ln.startsWith("author ")) {
      cur.author = ln.slice(7);
    } else if (ln.startsWith("author-time ")) {
      cur.time = parseInt(ln.slice(12), 10) || 0;
    } else if (ln.startsWith("summary ")) {
      cur.summary = ln.slice(8);
    }
  }
  if (cur.line !== undefined) out.push(cur as BlameLine);
  return out.slice(0, 20000);
}

/**
 * 新建文件/文件夹（files 页资源管理器行内新建）。
 * Windows 段名校验 + 路径锁 + wx 独占创建（防竞态覆盖已有文件）。
 * 文件按需递归建父目录、内容为空；文件夹允许一次建多层（mkdir recursive）。
 */
export type FileCreateKind = "file" | "dir";

export interface FileCreateResult {
  ok: boolean;
  path: string;
  error?: "invalid_name" | "path_locked" | "exists" | "create_failed";
}

/** Windows 保留设备名（含带扩展名形态，CON.txt 同样保留） */
const RESERVED_WIN_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function validateCreatePath(rel: string): "invalid_name" | null {
  if (!rel || rel.length > 260) return "invalid_name";
  for (const seg of rel.split("/")) {
    if (!seg || seg === "." || seg === "..") return "invalid_name";
    if (seg.toLowerCase() === ".git") return "invalid_name"; // 嵌套 .git 会干扰 git 的仓库边界判定
    if (/[<>:"|?*\u0000-\u001f\\]/.test(seg)) return "invalid_name";
    if (/[.\s]$/.test(seg)) return "invalid_name"; // Windows 会剥掉结尾点/空格，落盘名与请求名不一致
    if (RESERVED_WIN_NAME.test(seg)) return "invalid_name";
  }
  return null;
}

export async function createEntry(
  workDir: string,
  rel: string,
  kind: FileCreateKind,
): Promise<FileCreateResult> {
  const invalid = validateCreatePath(rel);
  if (invalid) return { ok: false, path: rel, error: invalid };

  const abs = path.resolve(workDir, rel);
  const realWt = await fsp.realpath(workDir).catch(() => workDir);
  const relCheck = path.relative(realWt, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return { ok: false, path: rel, error: "path_locked" };
  }

  try {
    const existing = await fsp.lstat(abs).catch(() => null);
    if (existing) return { ok: false, path: rel, error: "exists" };
    if (kind === "dir") {
      await fsp.mkdir(abs, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, "", { flag: "wx" }); // 独占创建：stat 与 write 间隙被并发建出则在此失败
    }
    return { ok: true, path: rel };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "EISDIR") return { ok: false, path: rel, error: "exists" };
    return { ok: false, path: rel, error: "create_failed" };
  }
}

// ---- 重命名 / 删除 / 复制剪切粘贴（files 页资源管理器右键菜单）----

export type FileMutateError = "invalid_name" | "path_locked" | "exists" | "not_found" | "failed";

export interface FileMutateResult {
  ok: boolean;
  /** 操作落定的相对路径（POSIX 分隔符；粘贴重名冲突时 = 请求路径） */
  path: string;
  error?: FileMutateError;
}

/** 路径锁 + realpath 双重校验（与 createEntry 同规则），返回绝对路径或 null（越界）。 */
async function resolveInside(workDir: string, rel: string): Promise<string | null> {
  const abs = path.resolve(workDir, rel);
  const realWt = await fsp.realpath(workDir).catch(() => workDir);
  const relCheck = path.relative(realWt, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) return null;
  return abs;
}

/** 源/目标路径任一段命中 .git（大小写不敏感）即拒绝——重命名/删除/粘贴不得触碰仓库元数据 */
function touchesGit(...rels: string[]): boolean {
  return rels.some((r) => r.split(/[\\/]/).some((seg) => seg.toLowerCase() === ".git"));
}

/** 相对路径 POSIX 归一（供回传前端与再拼接）。 */
function toPosixRel(abs: string, workDir: string): string {
  return path.relative(workDir, abs).split(path.sep).join("/");
}

export async function renameEntry(
  workDir: string,
  rel: string,
  newName: string,
): Promise<FileMutateResult> {
  // 重命名只接受单段名（跨目录移动走 file.paste 剪切），校验规则与新建共用
  if (!newName || newName.includes("/")) return { ok: false, path: rel, error: "invalid_name" };
  const invalid = validateCreatePath(newName);
  if (invalid) return { ok: false, path: rel, error: invalid };
  if (touchesGit(rel, newName)) return { ok: false, path: rel, error: "invalid_name" };

  const abs = await resolveInside(workDir, rel);
  if (!abs) return { ok: false, path: rel, error: "path_locked" };
  const target = path.join(path.dirname(abs), newName);
  const targetIn = await resolveInside(workDir, toPosixRel(target, workDir));
  if (!targetIn) return { ok: false, path: rel, error: "path_locked" };

  try {
    if (!(await fsp.lstat(abs).catch(() => null))) return { ok: false, path: rel, error: "not_found" };
    if (await fsp.lstat(target).catch(() => null)) return { ok: false, path: rel, error: "exists" };
    await fsp.rename(abs, target);
    return { ok: true, path: toPosixRel(target, workDir) };
  } catch {
    // Windows 下文件被占用（EPERM/EBUSY）等一律归为失败
    return { ok: false, path: rel, error: "failed" };
  }
}

export async function deleteEntry(
  workDir: string,
  rel: string,
): Promise<FileMutateResult> {
  if (!rel || touchesGit(rel)) return { ok: false, path: rel, error: "invalid_name" };
  const abs = await resolveInside(workDir, rel);
  if (!abs) return { ok: false, path: rel, error: "path_locked" };
  try {
    const st = await fsp.lstat(abs);
    if (st.isDirectory()) {
      await fsp.rm(abs, { recursive: true });
    } else {
      await fsp.unlink(abs);
    }
    return { ok: true, path: rel };
  } catch {
    return { ok: false, path: rel, error: "failed" };
  }
}

/**
 * 复制 / 剪切粘贴（files 页资源管理器右键）：from 复制/移动到 toDir 下（保留原名）。
 * 复制 = cp recursive，重名按 VSCode 风格自动序号「xxx copy.ext」「xxx copy 2.ext」；
 * 剪切 = rename（跨卷 EXDEV 回退 cp+rm），重名不自动改名——返回 exists 由前端提示。
 */
export async function pasteEntry(
  workDir: string,
  fromRel: string,
  toDirRel: string,
  cut: boolean,
): Promise<FileMutateResult> {
  if (!fromRel || touchesGit(fromRel)) return { ok: false, path: fromRel, error: "invalid_name" };
  const base = fromRel.split("/").pop() ?? fromRel;
  let targetRel = toDirRel ? `${toDirRel}/${base}` : base;
  if (touchesGit(targetRel)) return { ok: false, path: targetRel, error: "invalid_name" };
  const invalid = validateCreatePath(targetRel);
  if (invalid) return { ok: false, path: targetRel, error: invalid };

  const from = await resolveInside(workDir, fromRel);
  if (!from) return { ok: false, path: fromRel, error: "path_locked" };
  let target = await resolveInside(workDir, targetRel);
  if (!target) return { ok: false, path: targetRel, error: "path_locked" };

  try {
    if (from === target) {
      // 剪切回原地 = 无操作；复制回原地 = 复制副本，落到下方重名自动序号分支
      if (cut) return { ok: false, path: targetRel, error: "exists" };
    } else if (!(await fsp.lstat(from).catch(() => null))) {
      return { ok: false, path: fromRel, error: "not_found" };
    }
    if (await fsp.lstat(target).catch(() => null)) {
      if (cut) return { ok: false, path: targetRel, error: "exists" };
      // 复制重名：自动序号（有扩展名时插在扩展名前）
      const dir = path.dirname(target);
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      let final: string | null = null;
      for (let i = 1; i <= 99; i++) {
        const cand = path.join(dir, `${stem} copy${i > 1 ? ` ${i}` : ""}${ext}`);
        if (!(await fsp.lstat(cand).catch(() => null))) { final = cand; break; }
      }
      if (!final) return { ok: false, path: targetRel, error: "exists" };
      target = final;
      targetRel = toPosixRel(final, workDir);
    }
    if (cut) {
      try {
        await fsp.rename(from, target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
        await fsp.cp(from, target, { recursive: true, errorOnExist: true, force: false });
        await fsp.rm(from, { recursive: true });
      }
    } else {
      await fsp.cp(from, target, { recursive: true, errorOnExist: true, force: false });
    }
    return { ok: true, path: targetRel };
  } catch {
    return { ok: false, path: targetRel, error: "failed" };
  }
}
