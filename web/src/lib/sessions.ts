import type { CommitDTO } from "../bridge/types";

// 会话聚合（app/src/services/sessions.ts 的渲染层镜像——按 Assisted-By + Gitter-Session
// trailer 聚合连续 AI checkpoint 提交；人写提交永不聚合；孤立 AI 提交不成组）。

export const GAP_WINDOW_MS = 30 * 60 * 1000;

export interface AgentSession {
  sessionId: string;
  agentId: string;
  start: number;
  end: number;
  commits: CommitDTO[];
}

export function groupSessions(commitsDesc: CommitDTO[]): AgentSession[] {
  const sessions: AgentSession[] = [];
  let current: CommitDTO[] | null = null;
  let currentAgent: string | null = null;
  let currentSessionId: string | null = null;

  const flush = () => {
    if (current && current.length >= 2) {
      sessions.push({
        sessionId: currentSessionId ?? `${currentAgent}|${current[current.length - 1].sha}`,
        agentId: currentAgent ?? "ai",
        start: current[current.length - 1].committerDate,
        end: current[0].committerDate,
        commits: current,
      });
    }
    current = null;
  };

  for (const c of commitsDesc) {
    const assistedBy = c.assistedBy[0] ?? null;
    if (!assistedBy) {
      flush();
      continue;
    }
    const sameGroup =
      current !== null &&
      assistedBy === currentAgent &&
      (c.sessionId
        ? !!currentSessionId && c.sessionId === currentSessionId
        : currentSessionId === null && current[0].committerDate - c.committerDate <= GAP_WINDOW_MS);
    if (!sameGroup) flush();
    current ??= [];
    currentAgent = assistedBy;
    currentSessionId = c.sessionId;
    current.push(c);
  }
  flush();
  return sessions;
}

export function squashMessage(s: AgentSession): string {
  const tip = s.commits[0];
  const oldest = s.commits[s.commits.length - 1];
  return `${tip.subject}\n\nSquashed ${s.commits.length} checkpoint commits from ${s.agentId} (${oldest.shortSha}..${tip.shortSha}).`;
}
