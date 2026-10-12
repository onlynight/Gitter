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

// ---------------------------------------------------------------------------
// revert / cherry-pick（log 页右键动作 + 冲突续行）。
// revert --no-commit（默认）：反向改动留在 index/工作区，落变更页由用户确认提交——
// 破坏面最小的一档；commitNow=true 才直接 --no-edit 落提交。
// 冲突时 CHERRY_PICK_HEAD / REVERT_HEAD 标记由 operationState 识别，走 *Abort / *Continue。
// ---------------------------------------------------------------------------

export async function revertCommit(workDir: string, sha: string, commitNow: boolean): Promise<void> {
  const args = commitNow
    ? ["-c", "core.editor=true", "revert", "--no-edit", sha]
    : ["revert", "--no-commit", sha];
  const r = await tryGit(workDir, args);
  if (r.code !== 0) throw new GitError(args, r);
}

export async function cherryPickCommit(workDir: string, sha: string): Promise<void> {
  const r = await tryGit(workDir, ["cherry-pick", sha]);
  if (r.code !== 0) throw new GitError(["cherry-pick", sha], r);
}

export async function revertAbort(workDir: string): Promise<void> {
  const r = await tryGit(workDir, ["revert", "--abort"]);
  if (r.code !== 0) throw new GitError(["revert", "--abort"], r);
}

export async function revertContinue(workDir: string): Promise<void> {
  const r = await tryGit(workDir, ["-c", "core.editor=true", "revert", "--continue"]);
  if (r.code !== 0) throw new GitError(["revert", "--continue"], r);
}

export async function cherryPickAbort(workDir: string): Promise<void> {
  const r = await tryGit(workDir, ["cherry-pick", "--abort"]);
  if (r.code !== 0) throw new GitError(["cherry-pick", "--abort"], r);
}

export async function cherryPickContinue(workDir: string): Promise<void> {
  const r = await tryGit(workDir, ["-c", "core.editor=true", "cherry-pick", "--continue"]);
  if (r.code !== 0) throw new GitError(["cherry-pick", "--continue"], r);
}
