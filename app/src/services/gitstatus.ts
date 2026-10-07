import { git, tryGit, tryGitStream, GitError, type GitResult } from "./gitexec";
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

/** 工作区（或 index）文件 diff。
 * 未跟踪新文件走 `git diff --no-index -- /dev/null <path>`——其退出码语义特殊：
 * 0 = 无差异（空文件），1 = 有差异（正常情况，stdout 即补丁），其余才是真错误。
 * 之前把退出码 1 当失败，导致新增文件详情全部报错。 */
export async function worktreeFileDiff(
  workDir: string,
  path_: string,
  staged: boolean,
  isNewFile: boolean,
): Promise<DiffDTO> {
  const empty: DiffDTO = {
    path: path_, oldPath: path_, isBinary: false, isNew: isNewFile, isDeleted: false, isRenamed: false,
    hunks: [], addedLines: 0, deletedLines: 0, oldEndsWithNewline: true, newEndsWithNewline: true,
  };
  if (!staged && isNewFile) {
    const r = await tryGit(workDir, ["diff", "--no-color", "--no-index", "--", "/dev/null", path_]);
    if (r.code === 0) return empty; // 空文件：无差异
    if (r.code === 1) {
      const files = parseUnifiedDiff(r.stdout);
      return files[0] ?? empty;
    }
    throw new GitError(["diff", "--no-index", path_], r);
  }
  const patch = await git(workDir, ["diff", "--no-color", staged ? "--cached" : "", "--", path_].filter(Boolean));
  let files = parseUnifiedDiff(patch);
  // 未合并路径（冲突）：git diff 输出 combined diff（diff --cc），解析器不支持 → 空结果。
  // 改展示 ours(:2) vs theirs(:3) 的标准 unified diff，给用户决定取舍依据。
  if (files.length === 0 && !staged) {
    const unmerged = await tryGit(workDir, ["ls-files", "-u", "--", path_]);
    if (unmerged.stdout.trim()) {
      const sides = await tryGit(workDir, ["diff", "--no-color", `:2:${path_}`, `:3:${path_}`]);
      files = parseUnifiedDiff(sides.stdout);
    }
  }
  return files[0] ?? empty;
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

/** 提交（路径已由调用方暂存/撤销暂存完毕）。alsoPush=true 时提交成功后推送。 */
export async function commit(workDir: string, message: string, alsoPush: boolean, onProgress?: SyncProgress): Promise<CommitResult> {
  await git(workDir, ["commit", "-m", message]);
  const sha = (await git(workDir, ["rev-parse", "HEAD"])).trim();
  let pushError: string | null = null;
  if (alsoPush) {
    const r = await push(workDir, onProgress);
    if (r.code !== 0) pushError = classifyPushError(r.stderr + r.stdout);
  }
  return { sha, pushError };
}

export type ResetMode = "soft" | "mixed" | "hard";

/** 分支重置（Android Studio 语义）：soft 保留改动且保持暂存；mixed 保留改动取消暂存；hard 丢弃全部。 */
export async function resetTo(workDir: string, targetSha: string, mode: ResetMode): Promise<void> {
  if (!["soft", "mixed", "hard"].includes(mode)) throw new GitError(["reset"], { code: -1, stdout: "", stderr: `非法模式: ${mode}` });
  const r = await tryGit(workDir, ["reset", `--${mode}`, targetSha]);
  if (r.code !== 0) throw new GitError(["reset", `--${mode}`, targetSha], r);
}

export async function retryPush(workDir: string, onProgress?: SyncProgress): Promise<string | null> {
  const r = await push(workDir, onProgress);
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

/** 同步操作进度回调：text = git 进度行，percent = 解析出的百分比（无则 null）。 */
export type SyncProgress = (text: string, percent: number | null) => void;

/** 从 git 进度行提取百分比：如 "Receiving objects:  50% (3/6)"。 */
function parsePercent(line: string): number | null {
  const m = /:\s+(\d{1,3})%\s*\(/.exec(line);
  return m ? Math.min(100, parseInt(m[1], 10)) : null;
}

/** 网络同步类操作统一走 --progress + stderr 流式分行（TTY 之外默认不输出进度）。 */
async function syncOp(workDir: string, args: string[], onProgress?: SyncProgress): Promise<GitResult> {
  if (!onProgress) return tryGit(workDir, args);
  return tryGitStream(workDir, args, (line: string) => onProgress(line.replace(/^remote:\s*/, ""), parsePercent(line)));
}

export async function push(workDir: string, onProgress?: SyncProgress): Promise<GitResult> {
  return syncOp(workDir, ["push", "--progress"], onProgress);
}

export async function pullWithProgress(workDir: string, rebase: boolean, onProgress?: SyncProgress): Promise<GitResult> {
  return syncOp(workDir, ["pull", "--progress", ...(rebase ? ["--rebase"] : [])], onProgress);
}

export async function fetchAll(workDir: string, onProgress?: SyncProgress): Promise<GitResult> {
  return syncOp(workDir, ["fetch", "--all", "--progress"], onProgress);
}
