import * as fsp from "fs/promises";
import * as path from "path";
import { tryGit } from "./gitexec";
import { runExclusive } from "./ioQueue";

/**
 * 项目文件树聚合（磁盘为骨架，git 状态由后台 gitstatusService 单独推送）：
 * 递归扫描工作区（.git 除外）得到文件与目录条目，叠加 agent 回合改动索引，
 * 一次返回全量供前端虚拟化渲染。**git 状态不在本文件计算**——repo.tree 返回
 * 的是纯磁盘骨架，status 恒 null；前端订阅 git.status.changed 事件后由
 * gitstatusService 推送扁平状态映射，原地写入 entries[].status。
 *
 * 相比 git ls-files 骨架：被 .gitignore 忽略的文件与空目录同样可见——
 * 文件编辑器的语义是「磁盘即真相」；「索引里有、磁盘上已删」的幽灵条目
 * 也天然不存在（磁盘扫描不会产出）。非 git 目录同样可用（git 标注缺席即中性）。
 *
 * 护栏（全量返回、不做懒拉——仅对首屏）：node_modules 按名快速折叠（几乎恒为
 * 最大的忽略目录，不进去数文件）；子树文件数超阈值的目录折叠为单个条目（heavy）；
 * 全树条目超上限后剩余目录一律折叠。heavy 条目前端点击时按 prefix 懒加载下钻
 * （listTree 本身支持 prefix 只扫子树），初始树轻、大目录随取随有。
 */

/** 单条树条目。isDir=true 表示目录节点（含空目录；前端展开用）。 */
export interface TreeEntry {
  path: string;
  isDir: boolean;
  /** git 状态码 (M/A/D/R/U/?/!)；null = 未改动未被忽略 */
  status: string | null;
  /** 是否被 agent 本回合碰过（agent.task.files 命中） */
  touchedByAgent: boolean;
  /** 目录条目：子树过大（或为链接/触发总量护栏）未随首屏枚举，前端点击按 prefix 懒加载 */
  heavy?: boolean;
}

export interface TreeResult {
  entries: TreeEntry[];
  /** true = 还有更多（prefix 分页场景）；全量返回恒 false */
  hasMore: boolean;
}

// ---- 磁盘扫描护栏 ----
// 不做按名折叠（FAST_COLLAPSE_DIR 已删）、不做按文件数阈值折叠（HEAVY_DIR_FILES 已删）
// ——目录内容一律真实递归读取并直接下发，不因目录大就折叠成 heavy 点击才加载。
// 仅保留全树条目上限防御：超出后目录一律折叠、文件不再下发（防文件数畸多的仓库）。

/** 全树条目上限（防御文件数畸多的仓库；超出后目录一律折叠、文件不再下发） */
const MAX_TREE_ENTRIES = 200_000;

/**
 * 会话内「已展开」的 heavy 目录（workDir → 目录前缀集）：前端点击懒加载时登记。
 * 全量扫描时这些目录不再折叠而是直接枚举——外部变更触发的整树刷新
 * 不会把已展开的大目录重新折叠回 heavy（否则一点开就被 fs.changed 刷掉）。
 * 每次全量扫描后惰性清除磁盘上已不存在的登记。
 */
const expandedHeavyDirs = new Map<string, Set<string>>();

/** 单个目录的扫描产物；fileCount 为子树（含自身直挂文件）文件总数（供总量防御统计）。 */
interface DirScan {
  files: string[];
  dirs: { path: string; heavy: boolean }[];
  fileCount: number;
}

async function scanDir(
  absDir: string,
  relDir: string,
  ctx: { budget: { left: number }; expanded: Set<string> | null; shallow?: boolean },
): Promise<DirScan> {
  let items: import("fs").Dirent[];
  try {
    items = await fsp.readdir(absDir, { withFileTypes: true });
  } catch {
    return { files: [], dirs: [], fileCount: 0 }; // 无权限/竞态删除：整个子树缺席
  }
  const out: DirScan = { files: [], dirs: [], fileCount: 0 };
  const open: { abs: string; rel: string }[] = [];
  for (const it of items) {
    if (it.name === ".git") continue; // 目录或 .git 文件（worktree/submodule）形态都不进树
    const rel = relDir ? `${relDir}/${it.name}` : it.name;
    if (it.isDirectory()) {
      if (ctx.budget.left <= 0) {
        out.dirs.push({ path: rel, heavy: true });
        ctx.budget.left--;
      } else {
        open.push({ abs: path.join(absDir, it.name), rel });
      }
    } else if (it.isSymbolicLink()) {
      if (ctx.budget.left <= 0) continue;
      // 链接：stat 跟随判型——目录链接/junction 可见但不下钻（防环），其余按文件下发
      const st = await fsp.stat(path.join(absDir, it.name)).catch(() => null);
      ctx.budget.left--;
      if (st?.isDirectory()) out.dirs.push({ path: rel, heavy: true });
      else { out.files.push(rel); out.fileCount++; }
    } else if (it.isFile()) {
      if (ctx.budget.left <= 0) continue;
      out.files.push(rel);
      out.fileCount++;
      ctx.budget.left--;
    }
    // socket/fifo/设备等非常规条目不下发
  }
  for (const d of open) {
    if (ctx.shallow) {
      // 浅层模式（首屏）：只扫当前层，子目录一律折叠为 heavy 不递归——
      // 目录节点立即显示，内容由用户点击下钻（expandHeavy）或后台全量补全
      out.dirs.push({ path: d.rel, heavy: true });
      continue;
    }
    if (ctx.budget.left <= 0) {
      out.dirs.push({ path: d.rel, heavy: true });
      continue;
    }
    const sub = await scanDir(d.abs, d.rel, ctx);
    // 不再按文件数折叠（HEAVY_DIR_FILES 已删）：内容直接读出下发。
    // 仅当全树条目预算耗尽时上层已折叠（budget.left <= 0 分支）。
    out.files.push(...sub.files);
    out.dirs.push(...sub.dirs, { path: d.rel, heavy: false });
    out.fileCount += sub.fileCount;
  }
  return out;
}

/** prefix 归一：去首尾斜杠；含空段/./.. 视为非法回退全量（防越界，树仍可用）。 */
function normalizePrefix(prefix: string): string {
  const p = prefix.replace(/^\/+|\/+$/g, "");
  if (!p || p.split("/").some((s) => !s || s === "." || s === "..")) return "";
  return p;
}

/**
 * 列出文件树（纯磁盘扫描，git 状态不在此计算）。
 *
 * @param workDir  仓库根（也可以是非 git 目录：只扫磁盘，无状态标注）
 * @param prefix   可选前缀（如 "src"，只扫描/返回该子树，用于大型仓库分片）
 * @param touched  agent 本回合改动文件集合（来自 agent.task.files）
 * @param opts.rememberExpanded  懒加载取子树时置 true：把该 prefix 登记为「已展开」，
 *                               此后的全量扫描不再折叠它（刷新不破坏展开状态）
 * @param opts.shallow  浅层模式（FilesPage 首屏）：只扫当前层，子目录一律折叠为
 *                       heavy 不递归——目录节点立即显示，内容由点击下钻/后台补全
 *
 * 注意：返回的 entries[].status 恒为 null。git 状态由 gitstatusService
 * 后台单线程计算并通过 git.status.changed 推送，前端订阅后原地合并。
 */
export async function listTree(
  workDir: string,
  prefix: string,
  touched: Set<string>,
  opts?: { rememberExpanded?: boolean; shallow?: boolean },
): Promise<TreeResult> {
  const base = normalizePrefix(prefix);
  const fullScan = base === "";
  let expanded: Set<string> | null = null;
  if (fullScan) {
    expanded = expandedHeavyDirs.get(workDir) ?? null;
  } else if (opts?.rememberExpanded) {
    expanded = expandedHeavyDirs.get(workDir) ?? null;
    if (!expanded) {
      expanded = new Set();
      expandedHeavyDirs.set(workDir, expanded);
    }
    expanded.add(base);
  }

  // 浅层首屏（shallow）毫秒级、优先执行不排队；全量/下钻扫描经 ioQueue 串行——
  // 与 gitstatusService 的 git 计算共享同一队列，避免并发抢磁盘 I/O（首次 10s+ 根因）。
  const doScan = () =>
    scanDir(
      base ? path.resolve(workDir, base) : workDir,
      base,
      { budget: { left: MAX_TREE_ENTRIES }, expanded, shallow: opts?.shallow },
    );
  const scan = opts?.shallow ? await doScan() : await runExclusive(doScan);

  // 登记的目录若已从磁盘消失（删除/改名），从登记里惰性清除
  if (fullScan && expanded && expanded.size > 0) {
    const onDisk = new Set(scan.dirs.map((d) => d.path));
    for (const p of [...expanded]) {
      if (!onDisk.has(p)) expanded.delete(p);
    }
  }

  const entries: TreeEntry[] = [];
  for (const d of scan.dirs.sort((a, b) => a.path.localeCompare(b.path))) {
    entries.push({
      path: d.path,
      isDir: true,
      status: null, // git 状态由后台推送，前端合并
      touchedByAgent: false,
      ...(d.heavy ? { heavy: true } : {}),
    });
  }
  for (const p of scan.files.sort((a, b) => a.localeCompare(b))) {
    entries.push({ path: p, isDir: false, status: null, touchedByAgent: touched.has(p) });
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
