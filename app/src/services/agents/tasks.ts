import * as fs from "fs";
import * as path from "path";
import type { ModelMessage } from "ai";
import type { AgentTaskRecord } from "./types";

// ---- 会话文件（消息历史 + 事件日志，agent-harness.md v3.0 历史读取）----

export type SessionActor = "human" | "agent" | "host";

/** 会话日志条目：人类动作记为 text；循环/宿主事件记为 event（AgentSessionEvent 原样，避免类型环）。 */
export interface SessionJournalEntry {
  ts: string;
  actor: SessionActor;
  kind: "text" | "event";
  text?: string;
  event?: unknown;
}

export interface SessionFile {
  version: 1;
  taskId: string;
  messages: ModelMessage[];
  events: SessionJournalEntry[];
}

const MAX_JOURNAL = 500;

export function capJournal(j: SessionJournalEntry[]): SessionJournalEntry[] {
  return j.length > MAX_JOURNAL ? j.slice(j.length - MAX_JOURNAL) : j;
}

/**
 * 任务↔会话账本（agent-harness-codex.md v2.0 §三/§四）：
 * 持久化于 <repo>/.git/gitter/agent-tasks.json —— 跟随克隆走、按仓库隔离、不入版本控制。
 * Gitter 重启后非终态任务标 interrupted（外部会话文件仍存续，续跑无损）。
 */

const NON_TERMINAL: AgentTaskRecord["state"][] = ["starting", "working", "awaiting-input", "awaiting-permission"];

export interface AgentTaskFile {
  version: 1;
  tasks: AgentTaskRecord[];
}

function tasksPath(repoDir: string): string {
  return path.join(repoDir, ".git", "gitter", "agent-tasks.json");
}

export function loadAgentTasks(repoDir: string): AgentTaskFile {
  try {
    const raw = JSON.parse(fs.readFileSync(tasksPath(repoDir), "utf8")) as Partial<AgentTaskFile>;
    if (Array.isArray(raw.tasks)) {
      return { version: 1, tasks: raw.tasks as AgentTaskRecord[] };
    }
  } catch {
    // 不存在/损坏 → 空账本（损坏不堵塞会话，旧文件被下次保存覆盖）
  }
  return { version: 1, tasks: [] };
}

export function saveAgentTasks(repoDir: string, file: AgentTaskFile): void {
  const p = tasksPath(repoDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(file, null, 2), "utf8");
}

/** 重启恢复：非终态且不在存活表中的任务标 interrupted；返回改动数。 */
export function markInterrupted(file: AgentTaskFile, liveTaskIds: ReadonlySet<string>): number {
  let n = 0;
  for (const t of file.tasks) {
    if (NON_TERMINAL.includes(t.state) && !liveTaskIds.has(t.taskId)) {
      t.state = "interrupted";
      n++;
    }
  }
  return n;
}

export function upsertTask(file: AgentTaskFile, record: AgentTaskRecord): void {
  const i = file.tasks.findIndex((t) => t.taskId === record.taskId);
  if (i >= 0) file.tasks[i] = record;
  else file.tasks.unshift(record);
}

export function findTask(file: AgentTaskFile, taskId: string): AgentTaskRecord | undefined {
  return file.tasks.find((t) => t.taskId === taskId);
}

const sessionsDir = (repoDir: string): string => path.join(repoDir, ".git", "gitter", "agent-sessions");

export function loadSessionFile(repoDir: string, taskId: string): SessionFile {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir(repoDir), `${taskId}.json`), "utf8")) as Partial<SessionFile>;
    return {
      version: 1,
      taskId,
      messages: Array.isArray(raw.messages) ? (raw.messages as ModelMessage[]) : [],
      events: Array.isArray(raw.events) ? (raw.events as SessionJournalEntry[]) : [],
    };
  } catch {
    return { version: 1, taskId, messages: [], events: [] };
  }
}

export function saveSessionFile(repoDir: string, file: SessionFile): void {
  const dir = sessionsDir(repoDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${file.taskId}.json`), JSON.stringify({ ...file, events: capJournal(file.events) }, null, 2), "utf8");
}

export function deleteSessionFile(repoDir: string, taskId: string): void {
  fs.rmSync(path.join(sessionsDir(repoDir), `${taskId}.json`), { force: true });
}
