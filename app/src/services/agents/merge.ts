import * as fs from "fs";
import * as path from "path";
import { tryGit } from "../gitexec";

/**
 * 任务收尾合并的 git 预检逻辑（task-page-wrapup-and-list-design.md §3.6/§3.7）。
 * 纯函数层：不碰账本/会话——编排（权限、checkpoint、清理、记录回写）在 session.ts。
 */

export interface MergeCheckInfo {
  baseBranch: string;
  mainBranch: string;
  mainDirty: boolean;
  ahead: number;
  behind: number;
  uncommitted: number;
  /** null = 无法预检（老 git 且兜底失败）；[] = 干净 */
  conflicts: string[] | null;
  diffStat: string;
}

export async function currentBranch(workDir: string): Promise<string | null> {
  const r = await tryGit(workDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const b = r.stdout.trim();
  return r.code === 0 && b && b !== "HEAD" ? b : null;
}

export async function isDirty(workDir: string): Promise<boolean> {
  const r = await tryGit(workDir, ["status", "--porcelain"]);
  return r.code !== 0 || r.stdout.trim() !== "";
}

export async function dirtyCount(workDir: string): Promise<number> {
  const r = await tryGit(workDir, ["status", "--porcelain"]);
  if (r.code !== 0) return 0;
  return r.stdout.split(/\r?\n/).filter(Boolean).length;
}

/** ahead/behind：base...task → left=基线独有（behind），right=任务独有（ahead）。 */
export async function aheadBehind(repo: string, base: string, task: string): Promise<{ ahead: number; behind: number }> {
  const r = await tryGit(repo, ["rev-list", "--left-right", "--count", `${base}...${task}`]);
  if (r.code !== 0) return { ahead: 0, behind: 0 };
  const [left, right] = r.stdout.trim().split(/\s+/).map((x) => parseInt(x, 10) || 0);
  return { ahead: right || 0, behind: left || 0 };
}

/**
 * 冲突预检：首选 `git merge-tree --write-tree --name-only`（git ≥ 2.38，零工作区改动）；
 * 不可用（老 git）时回退到临时 detach worktree 试合并 → abort → 删。两路都失败返回 available=false。
 */
export async function detectConflicts(repo: string, base: string, task: string): Promise<{ available: boolean; conflicts: string[] | null }> {
  const r = await tryGit(repo, ["merge-tree", "--write-tree", "--name-only", base, task]);
  if (r.code === 0) return { available: true, conflicts: [] };
  if (r.code === 1) {
    // 输出：首行 tree oid，随后冲突文件清单（--name-only），空行之后是 informational 提示段
    // （Auto-merging / CONFLICT ...）——只取空行前的文件名
    const lines = r.stdout.split(/\r?\n/);
    const files: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "") break;
      files.push(lines[i].trim());
    }
    return { available: true, conflicts: files };
  }
  const tmp = path.join(process.env.LOCALAPPDATA ?? ".", "GitUI", "tmp", `mergecheck-${Date.now().toString(36)}`);
  let added = false;
  try {
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const add = await tryGit(repo, ["worktree", "add", "--detach", tmp, base]);
    if (add.code !== 0) return { available: false, conflicts: null };
    added = true;
    const m = await tryGit(tmp, ["merge", "--no-commit", "--no-ff", task]);
    if (m.code === 0) return { available: true, conflicts: [] };
    const u = await tryGit(tmp, ["diff", "--name-only", "--diff-filter=U"]);
    return { available: true, conflicts: u.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) };
  } catch {
    return { available: false, conflicts: null };
  } finally {
    if (added) await tryGit(repo, ["worktree", "remove", "--force", tmp]);
  }
}

/** 差异预览（diff --stat 原文，merge-base..task）。 */
export async function diffStat(repo: string, base: string, task: string): Promise<string> {
  const mb = await tryGit(repo, ["merge-base", base, task]);
  const baseRef = mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : base;
  const r = await tryGit(repo, ["diff", "--stat", `${baseRef}..${task}`]);
  return r.code === 0 ? r.stdout.trim() : "";
}

/** 汇总预检信息（编排方先做好 live/主 worktree 拦截）。 */
export async function collectMergeInfo(repo: string, worktreePath: string, taskBranch: string, baseBranchFallback: string | null): Promise<MergeCheckInfo> {
  const mainBranch = (await currentBranch(repo)) ?? "";
  const baseBranch = baseBranchFallback || mainBranch;
  const mainDirty = await isDirty(repo);
  const uncommitted = await dirtyCount(worktreePath);
  const { ahead, behind } = await aheadBehind(repo, baseBranch, taskBranch);
  const { available, conflicts } = ahead === 0 ? { available: true, conflicts: [] as string[] | null } : await detectConflicts(repo, baseBranch, taskBranch);
  const stat = ahead === 0 ? "" : await diffStat(repo, baseBranch, taskBranch);
  return { baseBranch, mainBranch, mainDirty, ahead, behind, uncommitted, conflicts: available ? conflicts : null, diffStat: stat };
}
