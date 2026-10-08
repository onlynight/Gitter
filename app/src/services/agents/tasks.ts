import * as fs from "fs";
import * as path from "path";
import type { ModelMessage } from "ai";
import type { AgentTaskRecord } from "./types";

/**
 * 会话持久化（agent-harness-v4.md F1.2）：
 * - 会话文件 v2：<taskId>.json = messages（完整回写）+ compactions + usageHistory；
 * - journal 分段：<taskId>/journal-<n>.json，每段 500 条，追加滚动；
 * - v1 迁移：旧单体文件里的 events 搬入 journal-0。
 */

export type SessionActor = "human" | "agent" | "host";

/** 会话日志条目：人类动作记为 text；循环/宿主事件记为 event（AgentSessionEvent 原样，避免类型环）。 */
export interface SessionJournalEntry {
  ts: string;
  actor: SessionActor;
  kind: "text" | "event";
  text?: string;
  event?: unknown;
}

/** 压缩记账（F7.2）。 */
export interface CompactionRecord {
  ts: string;
  removedCount: number;
  tokensBefore: number;
  tokensAfter: number;
  summary: string;
}

export interface UsageEntry {
  ts: string;
  input?: number;
  output?: number;
  /** 最近一轮流式耗时（speed = output / elapsedMs），旧会话文件无此字段 */
  elapsedMs?: number;
  /** 本轮命中缓存的输入 token 数（cache_hit_rate = cacheRead / input） */
  cacheRead?: number;
}

export interface SessionFile {
  version: 2;
  taskId: string;
  messages: ModelMessage[];
  compactions: CompactionRecord[];
  usageHistory: UsageEntry[];
}

// ---- 任务账本（<repo>/.git/gitter/agent-tasks.json）----

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

/** 记录字段补默认（旧账本兼容：v4 新字段缺省）。 */
export function normalizeRecord(r: AgentTaskRecord): AgentTaskRecord {
  return {
    ...r,
    permissionMode: r.permissionMode ?? "default",
    todoState: r.todoState ?? null,
    planHistory: r.planHistory ?? [],
    queued: r.queued ?? [],
  };
}

// ---- 会话文件 + journal 分段 ----

const sessionsDir = (repoDir: string): string => path.join(repoDir, ".git", "gitter", "agent-sessions");
const journalDirOf = (repoDir: string, taskId: string): string => path.join(sessionsDir(repoDir), taskId);
const JOURNAL_SEG = 500;

function sessionPath(repoDir: string, taskId: string): string {
  return path.join(sessionsDir(repoDir), `${taskId}.json`);
}

export function emptySessionFile(taskId: string): SessionFile {
  return { version: 2, taskId, messages: [], compactions: [], usageHistory: [] };
}

/**
 * 读取会话文件；v1 → v2 就地迁移（旧 events 搬入 journal-0，一次写入）。
 */
export function loadSessionFile(repoDir: string, taskId: string): SessionFile {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath(repoDir, taskId), "utf8")) as Partial<SessionFile> & {
      events?: SessionJournalEntry[];
    };
    const file: SessionFile = {
      version: 2,
      taskId,
      messages: Array.isArray(raw.messages) ? (raw.messages as ModelMessage[]) : [],
      compactions: Array.isArray(raw.compactions) ? raw.compactions : [],
      usageHistory: Array.isArray(raw.usageHistory) ? raw.usageHistory : [],
    };
    if (Array.isArray(raw.events) && raw.events.length > 0 && !fs.existsSync(journalDirOf(repoDir, taskId))) {
      appendJournalFile(repoDir, taskId, raw.events as SessionJournalEntry[]);
    }
    return file;
  } catch {
    return emptySessionFile(taskId);
  }
}

export function saveSessionFile(repoDir: string, file: SessionFile): void {
  const dir = sessionsDir(repoDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionPath(repoDir, file.taskId), JSON.stringify(file, null, 2), "utf8");
}

export function deleteSessionFile(repoDir: string, taskId: string): void {
  fs.rmSync(sessionPath(repoDir, taskId), { force: true });
  fs.rmSync(journalDirOf(repoDir, taskId), { recursive: true, force: true });
}

// ---- journal 分段（agent-harness-v4.md F1.2）----

function segmentPath(repoDir: string, taskId: string, n: number): string {
  return path.join(journalDirOf(repoDir, taskId), `journal-${n}.json`);
}

function listSegments(repoDir: string, taskId: string): number[] {
  try {
    return fs
      .readdirSync(journalDirOf(repoDir, taskId))
      .map((f) => /^journal-(\d+)\.json$/.exec(f))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => parseInt(m[1], 10))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** 追加条目到末段（满 500 滚新段）。同步 IO（journal 批量冲刷时调用，量小）。 */
export function appendJournalFile(repoDir: string, taskId: string, entries: SessionJournalEntry[]): void {
  if (entries.length === 0) return;
  fs.mkdirSync(journalDirOf(repoDir, taskId), { recursive: true });
  const segs = listSegments(repoDir, taskId);
  const last = segs.length > 0 ? segs[segs.length - 1] : 0;
  const p = segmentPath(repoDir, taskId, last);
  let cur: SessionJournalEntry[] = [];
  try {
    cur = JSON.parse(fs.readFileSync(p, "utf8")) as SessionJournalEntry[];
  } catch {
    /* 新段 */
  }
  let rest = entries;
  if (cur.length + rest.length > JOURNAL_SEG) {
    const take = JOURNAL_SEG - cur.length;
    cur.push(...rest.slice(0, take));
    fs.writeFileSync(p, JSON.stringify(cur), "utf8");
    rest = rest.slice(take);
    let n = last + 1;
    while (rest.length > 0) {
      const chunk = rest.slice(0, JOURNAL_SEG);
      rest = rest.slice(JOURNAL_SEG);
      fs.writeFileSync(segmentPath(repoDir, taskId, n), JSON.stringify(chunk), "utf8");
      n++;
    }
    return;
  }
  cur.push(...rest);
  fs.writeFileSync(p, JSON.stringify(cur), "utf8");
}

/** journal 分页读取（F1.2：before 之前、最多 limit 条；返回 hasMore 供"加载更早"）。 */
export function loadJournalRange(
  repoDir: string,
  taskId: string,
  opts?: { before?: string; limit?: number },
): { entries: SessionJournalEntry[]; hasMore: boolean } {
  const limit = Math.max(1, Math.min(opts?.limit ?? 200, 500));
  const segs = listSegments(repoDir, taskId);
  const collected: SessionJournalEntry[] = [];
  let hasMore = false;
  for (let i = segs.length - 1; i >= 0 && !hasMore; i--) {
    let entries: SessionJournalEntry[] = [];
    try {
      entries = JSON.parse(fs.readFileSync(segmentPath(repoDir, taskId, segs[i]), "utf8")) as SessionJournalEntry[];
    } catch {
      continue;
    }
    for (let j = entries.length - 1; j >= 0; j--) {
      const e = entries[j];
      if (opts?.before && e.ts >= opts.before) continue;
      if (collected.length >= limit) {
        hasMore = true;
        break;
      }
      collected.push(e);
    }
  }
  return { entries: collected.reverse(), hasMore };
}
