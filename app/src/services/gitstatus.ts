import { git, tryGit, GitError } from "./gitexec";
import { parseUnifiedDiff } from "./gitlog";
import type { ChangesStateDTO, DiffDTO, FileStatusDTO } from "../shared/types";

// ---------------------------------------------------------------------------
// 工作区状态（对齐 ChangesViewModel 三层分类语义）
// ---------------------------------------------------------------------------

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export async function getStatus(workDir: string): Promise<ChangesStateDTO> {
  const out = await git(workDir, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
  const [numstatWt, numstatIdx] = await Promise.all([
    tryGit(workDir, ["diff", "--numstat"]),
    tryGit(workDir, ["diff", "--cached", "--numstat"]),
  ]);
  const wtCounts = parseNumstat(numstatWt.stdout);
  const idxCounts = parseNumstat(numstatIdx.stdout);

  const changes: FileStatusDTO[] = [];
  const staged: FileStatusDTO[] = [];
  const unversioned: FileStatusDTO[] = [];
  const conflicts: FileStatusDTO[] = [];

  const parts = out.split("\0");
  let i = 0;
  while (i < parts.length) {
    const entry = parts[i];
    i++;
    if (!entry) continue;
    const x = entry[0]; // index 状态
    const y = entry[1]; // worktree 状态
    let p = entry.slice(3);
    // porcelain v1 -z：R/C 记录为 "XY new\0old\0"，追加消费 origPath
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      i++; // skip origPath
    }

    const isUntracked = x === "?" && y === "?";
    const isConflict = CONFLICT_CODES.has(`${x}${y}`) || x === "U" || y === "U";

    if (isUntracked) {
      unversioned.push({ path: p, category: "unversioned", isConflict: false, added: null, deleted: null });
      continue;
    }
    if (isConflict) {
      conflicts.push({ path: p, category: "conflicts", isConflict: true, added: null, deleted: null });
      continue;
    }
    if (x !== " " && x !== "?") {
      const c = idxCounts.get(p);
      staged.push({ path: p, category: "staged", isConflict: false, added: c?.added ?? null, deleted: c?.deleted ?? null });
    }
    if (y !== " " && y !== "?") {
      const c = wtCounts.get(p);
      changes.push({ path: p, category: "changes", isConflict: false, added: c?.added ?? null, deleted: c?.deleted ?? null });
    }
  }

  return { workDir, changes, staged, unversioned, conflicts };
}

function parseNumstat(out: string): Map<string, { added: number | null; deleted: number | null }> {
  const map = new Map<string, { added: number | null; deleted: number | null }>();
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.split("\t");
    if (tab.length < 3) continue;
    map.set(tab[2], {
      added: tab[0] === "-" ? null : parseInt(tab[0], 10),
      deleted: tab[1] === "-" ? null : parseInt(tab[1], 10),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// 暂存 / 撤销暂存 / 提交 / 同步
// ---------------------------------------------------------------------------

export async function stageFiles(workDir: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(workDir, ["add", "--", ...paths]);
}

export async function unstageFiles(workDir: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(workDir, ["reset", "HEAD", "--", ...paths]);
}

/** 工作区（或 index）文件 diff。untracked 走 --no-index。 */
export async function worktreeFileDiff(
  workDir: string,
  path_: string,
  staged: boolean,
  isNewFile: boolean,
): Promise<DiffDTO> {
  let patch: string;
  if (!staged && isNewFile) {
    patch = await git(workDir, ["diff", "--no-color", "--no-index", "--", "/dev/null", path_]);
  } else {
    patch = await git(workDir, ["diff", "--no-color", staged ? "--cached" : "", "--", path_].filter(Boolean));
  }
  const files = parseUnifiedDiff(patch);
  return (
    files[0] ?? {
      path: path_, oldPath: path_, isBinary: false, isNew: isNewFile, isDeleted: false, isRenamed: false,
      hunks: [], addedLines: 0, deletedLines: 0, oldEndsWithNewline: true, newEndsWithNewline: true,
    }
  );
}

/**
 * hunk 级暂存（对齐 StageHunksAsync：git apply --cached 分块）。
 * patch 源 = `git diff -- <path>`；未选 hunk 直接剔除，行数经 --recount 修正。
 */
export async function stageHunks(workDir: string, path_: string, hunkIndices: number[]): Promise<void> {
  await applyHunks(workDir, path_, hunkIndices, { cached: false, reverse: false });
}

/** hunk 级撤销暂存：从 index 反向应用 `git diff --cached` 的所选块。 */
export async function unstageHunks(workDir: string, path_: string, hunkIndices: number[]): Promise<void> {
  await applyHunks(workDir, path_, hunkIndices, { cached: true, reverse: true });
}

async function applyHunks(
  workDir: string,
  path_: string,
  hunkIndices: number[],
  opts: { cached: boolean; reverse: boolean },
): Promise<void> {
  const patch = await git(workDir, [
    "diff", "--no-color", ...(opts.cached ? ["--cached"] : []), "--", path_,
  ]);
  const files = parseUnifiedDiff(patch);
  const file = files[0];
  if (!file || file.hunks.length === 0) return;

  // 重建 patch：文件头 + 所选 hunk 段。头取原始文本到第一个 @@ 之前。
  const rawLines = patch.split("\n");
  const firstHunkLine = rawLines.findIndex((l) => l.startsWith("@@"));
  if (firstHunkLine < 0) return;
  const header = rawLines.slice(0, firstHunkLine);

  // 逐段提取所选 hunk 的原文（含 @@ 行与其后内容行，直到下一 @@ / EOF / 文件边界）
  const selected: string[] = [];
  const idxSet = new Set(hunkIndices);
  let curIdx = -1;
  for (let i = firstHunkLine; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.startsWith("@@")) {
      curIdx++;
      // 同文件多段时，遇到下一个文件的 "diff --git" 停止（单文件查询不会出现）
      continue;
    }
    if (line.startsWith("diff --git ")) break;
    if (idxSet.has(curIdx)) selected.push(line);
  }
  if (selected.length === 0) return;

  const out = [...header, ...selected].join("\n") + "\n";
  const args = ["apply", "--cached", "--whitespace=nofix", "--recount"];
  if (opts.reverse) args.push("--reverse");
  const r = await tryGit(workDir, args, out);
  if (r.code !== 0) throw new GitError(args, r);
}

export interface CommitResult {
  sha: string | null;
  pushError: string | null;
}

/** 提交（路径已由调用方暂存/撤销暂存完毕）。push=true 时提交成功后推送。 */
export async function commit(workDir: string, message: string, push: boolean): Promise<CommitResult> {
  await git(workDir, ["commit", "-m", message]);
  const sha = (await git(workDir, ["rev-parse", "HEAD"])).trim();
  let pushError: string | null = null;
  if (push) {
    const r = await tryGit(workDir, ["push"]);
    if (r.code !== 0) pushError = classifyPushError(r.stderr + r.stdout);
  }
  return { sha, pushError };
}

export async function retryPush(workDir: string): Promise<string | null> {
  const r = await tryGit(workDir, ["push"]);
  return r.code === 0 ? null : classifyPushError(r.stderr + r.stdout);
}

/** 推送失败粗分类（对齐 PushFailureKind 语义子集，v1：四分类）。 */
export function classifyPushError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("no upstream") || s.includes("set-upstream") || s.includes("has no upstream")) return "noUpstream";
  if (s.includes("rejected") || s.includes("fetch first") || s.includes("behind")) return "rejected";
  if (s.includes("could not resolve host") || s.includes("connection") || s.includes("timed out") || s.includes("unable to access")) return "network";
  return "other";
}

export async function pull(workDir: string, rebase: boolean): Promise<void> {
  await git(workDir, rebase ? ["pull", "--rebase"] : ["pull"]);
}

export async function fetchAll(workDir: string): Promise<void> {
  await git(workDir, ["fetch", "--all", "--quiet"]);
}
