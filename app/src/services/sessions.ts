import type { CommitDTO } from "../shared/types";

// 会话聚合（C# CommitTrailers + LogSessionGrouping 移植，ai-native-redesign.md §5.1）。
// 识别连续的 AI checkpoint 提交：优先 Gitter-Session trailer 归组；
// 无 session trailer 时按"同 Assisted-By + 时间窗 ≤30 分钟"聚合；人写提交永不聚合。

export const GAP_WINDOW_MS = 30 * 60 * 1000;

export interface AiMeta {
  assistedBy: string | null;
  sessionId: string | null;
}

/** trailer 解析：只看 message 最后一个段落（git trailer 约定位置），大小写不敏感。 */
export function readTrailers(body: string): AiMeta {
  if (!body) return { assistedBy: null, sessionId: null };
  const blocks = body.trimEnd().split(/\r\n\r\n|\n\n/);
  const trailerBlock = blocks[blocks.length - 1];
  const agent = /^assisted-by:[ \t]*(.+)$/im.exec(trailerBlock);
  const session = /^gitter-session:[ \t]*(.+)$/im.exec(trailerBlock);
  return {
    assistedBy: agent ? agent[1].trim() : null,
    sessionId: session ? session[1].trim() : null,
  };
}

export interface AgentSession {
  sessionId: string;
  agentId: string;
  start: number; // unix 秒
  end: number;
  commits: CommitDTO[];
}

/** 会话卡折叠消息（squash 用）：tip 主题 + 模板 body。 */
export function squashMessage(s: AgentSession): string {
  const tip = s.commits[0];
  const oldest = s.commits[s.commits.length - 1];
  return `${tip.subject}\n\nSquashed ${s.commits.length} checkpoint commits from ${s.agentId} (${oldest.shortSha}..${tip.shortSha}).`;
}

/** 聚合（输入按时间倒序，即 Log 页顺序）。孤立 AI 提交不成组。 */
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
    const meta = readTrailers(c.body);
    const isAi = (c.assistedBy.length > 0) || !!meta.assistedBy;
    const assistedBy = meta.assistedBy ?? c.assistedBy[0] ?? null;
    if (!isAi) {
      flush();
      continue;
    }
    const sameGroup =
      current !== null &&
      assistedBy === currentAgent &&
      (meta.sessionId
        ? !!currentSessionId && meta.sessionId === currentSessionId
        : currentSessionId === null && current[0].committerDate - c.committerDate <= GAP_WINDOW_MS);
    if (!sameGroup) flush();
    current ??= [];
    currentAgent = assistedBy;
    currentSessionId = meta.sessionId;
    current.push(c);
  }
  flush();
  return sessions;
}
