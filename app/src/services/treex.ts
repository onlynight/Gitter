import * as fsp from "fs/promises";
import * as path from "path";
import { tryGit } from "./gitexec";
import * as status from "./gitstatus";
import type { FileStatusDTO } from "../shared/types";

/**
 * 项目文件树聚合（editor-design.md §2.1）：
 * 以 `git ls-files -co --exclude-standard` 为骨架（已过滤 .gitignore），
 * 叠加 git 状态分类与 agent 回合改动索引，一次返回全量供前端虚拟化渲染。
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

/** 状态码映射：四层分类 → 单字符。与 ChangesPage 的 statusLetter 语义对齐。 */
function statusLetter(f: FileStatusDTO): string {
  if (f.isConflict) return "U";
  switch (f.category) {
    case "unversioned": return "?";
    case "staged": return "A";
    case "changes": return "M";
    default: return "M";
  }
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
  const filtered = prefix ? all.filter((p) => p.startsWith(prefix)) : all;

  // git 状态索引（含 unversioned，因为 ls-files -co 已包含未跟踪文件）
  const st = await status.getStatus(workDir);
  const statusMap = new Map<string, string>();
  for (const f of [...st.changes, ...st.staged, ...st.unversioned, ...st.conflicts]) {
    statusMap.set(f.path, statusLetter(f));
  }

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
 */
export interface FileContentResult {
  content: string;
  encoding: "utf8";
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

export async function readFileContent(
  workDir: string,
  rel: string,
  revision: "worktree" | "index" | string = "worktree",
  maxBytes = 8 * 1024 * 1024,
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
        buf = Buffer.from(show.stdout, "binary");
        fromIndex = true;
      }
    }
  } else if (/^[0-9a-f]{40}$/.test(revision)) {
    // git object hash（提交中的版本）
    const show = await tryGit(workDir, ["show", `${revision}:${rel}`]);
    if (show.code === 0) {
      buf = Buffer.from(show.stdout, "binary");
    }
  } else {
    // worktree（默认）
    try {
      const st = await fsp.stat(abs);
      if (st.size > maxBytes) {
        const truncated = await fsp.readFile(abs).then(b => b.subarray(0, maxBytes));
        return {
          content: truncated.toString("utf8"),
          encoding: "utf8",
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

  return {
    content: buf.toString("utf8"),
    encoding: "utf8",
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

export async function writeFileContent(
  workDir: string,
  rel: string,
  content: string,
  eol?: "crlf" | "lf",
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

  const buf = Buffer.from(text, "utf8");
  if (buf.length > MAX_WRITE_BYTES) {
    return { ok: false, size: buf.length, mtime: 0, error: "size_limit" };
  }

  // NUL 嗅探：拒绝写入二进制文件（避免误改）
  if (buf.includes(0)) {
    return { ok: false, size: buf.length, mtime: 0, error: "binary" };
  }

  try {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, buf, "utf8");
    const st = await fsp.stat(abs);
    return { ok: true, size: st.size, mtime: st.mtimeMs };
  } catch {
    return { ok: false, size: buf.length, mtime: 0, error: "write_failed" };
  }
}
