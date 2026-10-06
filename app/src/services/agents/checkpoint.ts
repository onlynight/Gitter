import { tryGit } from "../gitexec";

/**
 * 宿主托管 checkpoint（agent-harness-codex.md v2.0 §三 checkpoint.ts / §12.9）：
 * 触发点为 turn-completed 事件；仅在【任务 worktree】内 git add -A && git commit，
 * trailer（Assisted-by / Gitter-Session）由 Gitter 代打——会话归组不依赖 agent 自觉。
 * 主 worktree 永不自动提交；工作区干净时跳过。
 */

export interface CheckpointOptions {
  /** 轮次摘要（取 LastMessage 首行截断） */
  summary: string;
  /** manifest identity.assistedBy（如 codex） */
  assistedBy: string;
  /** 会话归组键（用 taskId） */
  sessionId: string;
}

export interface CheckpointResult {
  sha: string | null;
  skipped: boolean;
  reason: string | null;
}

function oneLine(s: string): string {
  const line = s.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  return line.length > 72 ? line.slice(0, 69) + "…" : line;
}

export async function commitCheckpoint(worktreePath: string, opts: CheckpointOptions): Promise<CheckpointResult> {
  const add = await tryGit(worktreePath, ["add", "-A"]);
  if (add.code !== 0) return { sha: null, skipped: true, reason: `git add 失败：${add.stderr.trim()}` };

  const st = await tryGit(worktreePath, ["status", "--porcelain"]);
  if (st.code !== 0) return { sha: null, skipped: true, reason: `git status 失败：${st.stderr.trim()}` };
  if (st.stdout.trim() === "") return { sha: null, skipped: true, reason: "工作区干净，跳过 checkpoint" };

  const subject = `checkpoint: ${oneLine(opts.summary) || "无摘要"}`;
  const trailers = `Assisted-by: ${opts.assistedBy}\nGitter-Session: ${opts.sessionId}`;
  const commit = await tryGit(worktreePath, ["commit", "-m", subject, "-m", trailers]);
  if (commit.code !== 0) return { sha: null, skipped: true, reason: `git commit 失败：${commit.stderr.trim()}` };

  const sha = (await tryGit(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  return { sha: sha || null, skipped: false, reason: null };
}

/** 会话基线：任务 worktree 的 HEAD（spawn 时记录，squash 视角 diff 的起点）。 */
export async function headSha(worktreePath: string): Promise<string | null> {
  const r = await tryGit(worktreePath, ["rev-parse", "HEAD"]);
  const sha = r.stdout.trim();
  return r.code === 0 && sha ? sha : null;
}
