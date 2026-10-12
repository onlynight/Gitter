import * as fs from "fs";
import * as path from "path";
import { tryGit, GitError } from "./gitexec";

/**
 * 合并/变基操作状态与续行控制（M1.4 harness-mainline-roadmap.md：冲突闭环）。
 * 冲突后的人在环：state 检测（.git 标记文件）→ 继续（--continue）/ 中止（--abort）。
 * 冲突文件清单走既有 gitstatus（conflicts 组）；行级解决在前端（标记解析 + 写回 + git add）。
 */

export type GitOperationKind = "merge" | "rebase" | "cherry-pick" | "revert";

export interface GitOperationState {
  /** null = 无进行中的多步操作 */
  kind: GitOperationKind | null;
  /** 变基交互阶段提示（如 "第 2/5 步"；其余操作为 null） */
  detail: string | null;
}

/** 检测进行中的多步操作（探 gitdir 标记文件；rev-parse --absolute-git-dir 兼容 worktree 指针）。 */
export async function operationState(workDir: string): Promise<GitOperationState> {
  const r = await tryGit(workDir, ["rev-parse", "--absolute-git-dir"]);
  if (r.code !== 0 || !r.stdout.trim()) return { kind: null, detail: null };
  const gitDir = r.stdout.trim();
  const has = (p: string): boolean => fs.existsSync(path.join(gitDir, p));
  if (has("rebase-merge") || has("rebase-apply")) {
    const mergeDir = has("rebase-merge");
    const step = readOne(gitDir, mergeDir ? "rebase-merge/msgnum" : "rebase-apply/next");
    const total = readOne(gitDir, mergeDir ? "rebase-merge/end" : "rebase-apply/last");
    return { kind: "rebase", detail: step && total ? `第 ${step}/${total} 步` : null };
  }
  if (has("MERGE_HEAD")) return { kind: "merge", detail: null };
  if (has("CHERRY_PICK_HEAD")) return { kind: "cherry-pick", detail: null };
  if (has("REVERT_HEAD")) return { kind: "revert", detail: null };
  return { kind: null, detail: null };
}

function readOne(gitDir: string, rel: string): string | null {
  try {
    return (fs.readFileSync(path.join(gitDir, rel), "utf8").trim() || null);
  } catch {
    return null;
  }
}

export async function rebaseAbort(workDir: string): Promise<void> {
  const r = await tryGit(workDir, ["rebase", "--abort"]);
  if (r.code !== 0) throw new GitError(["rebase", "--abort"], r);
}

export async function rebaseContinue(workDir: string): Promise<void> {
  // -c core.editor=true：续行提交复用既有 MERGE_MSG，不开交互编辑器（无 TTY 场景必须）
  const r = await tryGit(workDir, ["-c", "core.editor=true", "rebase", "--continue"]);
  if (r.code !== 0) throw new GitError(["rebase", "--continue"], r);
}

export async function mergeAbort(workDir: string): Promise<void> {
  const r = await tryGit(workDir, ["merge", "--abort"]);
  if (r.code !== 0) throw new GitError(["merge", "--abort"], r);
}

export async function mergeContinue(workDir: string): Promise<void> {
  // git merge --continue 在旧 git 缺失时回退 commit --no-edit（等价语义）
  const direct = await tryGit(workDir, ["-c", "core.editor=true", "merge", "--continue"]);
  if (direct.code === 0) return;
  const r = await tryGit(workDir, ["commit", "--no-edit"]);
  if (r.code !== 0) throw new GitError(["commit", "--no-edit"], r);
}
