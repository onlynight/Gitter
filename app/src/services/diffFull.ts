import * as fs from "fs";
import * as path from "path";
import { tryGit } from "./gitexec";
import { parseUnifiedDiff } from "./gitlog";
import type { DiffFullDTO } from "../shared/types";

/**
 * monaco diff 编辑器的全量双文本装配（*DiffFull RPC 共用）：
 * patch（同一份 `git diff` 输出）贡献 isBinary 与 hunk 区间（勾选暂存映射用），
 * 双侧全文按各产出方语义取 blob / 工作区文件。单侧超上限置 tooLarge（内容清空，
 * 客户端回退 hunk 版 DiffView）；二进制同样不搬运内容。hunk 数超上限清空
 * （勾选暂存 UI 隐藏，整文件暂存不受影响）。
 */

const MAX_SIDE_CHARS = 800_000;
const MAX_HUNKS = 500;
const BLOB_SNIFF_BYTES = 8192;

export function isBinaryText(text: string): boolean {
  return text.slice(0, BLOB_SNIFF_BYTES).includes("\u0000");
}

export function buildDiffFull(path_: string, patch: string, original: string, modified: string): DiffFullDTO {
  const file = parseUnifiedDiff(patch)[0] ?? null;
  const isBinary = isBinaryText(original) || isBinaryText(modified) || (file?.isBinary ?? false);
  const tooLarge = !isBinary && (original.length > MAX_SIDE_CHARS || modified.length > MAX_SIDE_CHARS);
  const ranges = file && file.hunks.length <= MAX_HUNKS
    ? file.hunks.map((h) => ({ oldStart: h.oldStart, oldCount: h.oldCount, newStart: h.newStart, newCount: h.newCount }))
    : [];
  return {
    path: path_,
    isBinary,
    tooLarge,
    original: isBinary || tooLarge ? "" : original,
    modified: isBinary || tooLarge ? "" : modified,
    hunks: ranges,
  };
}

/** git cat-file blob <rev>:<rel>；路径在该 rev 不存在（新文件/删除侧）返回 null。 */
export async function blobText(workDir: string, rev: string, rel: string): Promise<string | null> {
  const r = await tryGit(workDir, ["cat-file", "blob", `${rev}:${rel}`]);
  return r.code === 0 ? r.stdout : null;
}

/** 工作区文件文本；不存在/不可读返回空串（删除侧语义）。 */
export async function worktreeText(workDir: string, rel: string): Promise<string> {
  const buf = await fs.promises.readFile(path.resolve(workDir, rel)).catch(() => null);
  if (!buf) return "";
  return buf.toString("utf8");
}
