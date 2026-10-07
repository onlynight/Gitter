import type { AgentOutcome, AgentPhase, AgentSessionEvent, FileChangeKind } from "./types";
import type { HarnessEventMap } from "../extensions/schema";

/**
 * 声明式事件映射求值器（agent-harness-codex.md v2.0 §二 events 段）。
 * 纯函数、无 IO——协议帧（JSONL 反序列化后的对象）→ AgentSessionEvent[]。
 * when 表达式为极小 JSONPath 子集：属性路径 + ==/!= + &&/|| + 括号 + 字面量；
 * 刻意不做成脚本（可审计、可快照测试，宿主无脚本宿主依赖）。
 */

// ---- 路径求值：$.a.b[0]（$ = 帧；[*] 仅用于 from 展开数组）----

function splitPath(p: string): (string | number | "*")[] {
  const out: (string | number | "*")[] = [];
  const body = p.startsWith("$") ? p.slice(1) : p;
  const re = /\.([A-Za-z0-9_-]+)|\[(\*|\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) out.push(m[1]);
    else out.push(m[2] === "*" ? "*" : parseInt(m[2], 10));
  }
  return out;
}

export function getPath(frame: unknown, p: string): unknown {
  let cur: unknown = frame;
  for (const seg of splitPath(p)) {
    if (seg === "*") return undefined; // 通配只允许出现在 from 展开里
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function expandPath(frame: unknown, p: string): unknown[] {
  const segs = splitPath(p);
  const idx = segs.indexOf("*");
  if (idx === -1) {
    const v = getPath(frame, p);
    return Array.isArray(v) ? v : v === undefined ? [] : [v];
  }
  let cur: unknown = frame;
  for (const seg of segs.slice(0, idx)) {
    if (cur === null || cur === undefined) return [];
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  if (!Array.isArray(cur)) return [];
  const rest = segs.slice(idx + 1);
  if (rest.length === 0) return cur;
  return cur.map((el) => {
    let v: unknown = el;
    for (const seg of rest) {
      if (v === null || v === undefined) return undefined;
      v = (v as Record<string | number, unknown>)[seg];
    }
    return v;
  });
}

// ---- when 表达式：or := and (|| and)*; and := eq (&& eq)*; eq := prim (==|!= prim)? ----

type Predicate = (frame: unknown) => boolean;

interface Token {
  t: "path" | "str" | "num" | "ident" | "op" | "lparen" | "rparen";
  v: string;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith("&&", i)) {
      out.push({ t: "op", v: "&&" });
      i += 2;
      continue;
    }
    if (src.startsWith("||", i)) {
      out.push({ t: "op", v: "||" });
      i += 2;
      continue;
    }
    if (src.startsWith("==", i)) {
      out.push({ t: "op", v: "==" });
      i += 2;
      continue;
    }
    if (src.startsWith("!=", i)) {
      out.push({ t: "op", v: "!=" });
      i += 2;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lparen", v: c });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rparen", v: c });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end === -1) throw new Error(`when 表达式字符串未闭合：${src}`);
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === "$") {
      // 路径：$.a.b[0] —— 吃到下一个操作符/括号前
      let j = i + 1;
      while (j < src.length && !/[\s()]/.test(src[j]) && !src.startsWith("&&", j) && !src.startsWith("||", j) && !src.startsWith("==", j) && !src.startsWith("!=", j)) j++;
      out.push({ t: "path", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: "num", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_-]/.test(src[j])) j++;
      out.push({ t: "ident", v: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`when 表达式含非法字符 '${c}'：${src}`);
  }
  return out;
}

function tokenToValue(tk: Token, frame: unknown): unknown {
  if (tk.t === "path") return getPath(frame, tk.v);
  if (tk.t === "str") return tk.v;
  if (tk.t === "num") return parseFloat(tk.v);
  if (tk.t === "ident") {
    if (tk.v === "true") return true;
    if (tk.v === "false") return false;
    if (tk.v === "null") return undefined; // null 与「缺失」同判，够用且可预期
  }
  return tk.v;
}

export function compileWhen(expr: string): Predicate {
  const toks = tokenize(expr);
  let pos = 0;
  const peek = () => toks[pos];
  const parseOr = (): Predicate => {
    let left = parseAnd();
    while (peek()?.t === "op" && peek().v === "||") {
      pos++;
      const right = parseAnd();
      const l = left;
      left = (f) => l(f) || right(f);
    }
    return left;
  };
  const parseAnd = (): Predicate => {
    let left = parseUnary();
    while (peek()?.t === "op" && peek().v === "&&") {
      pos++;
      const right = parseUnary();
      const l = left;
      left = (f) => l(f) && right(f);
    }
    return left;
  };
  const parseUnary = (): Predicate => {
    const tk = peek();
    if (tk?.t === "lparen") {
      pos++;
      const inner = parseOr();
      if (peek()?.t !== "rparen") throw new Error(`when 表达式括号未闭合：${expr}`);
      pos++;
      return inner;
    }
    return parseEq();
  };
  const parseEq = (): Predicate => {
    const leftTk = toks[pos];
    if (!leftTk) throw new Error(`when 表达式意外结束：${expr}`);
    pos++;
    const op = peek();
    if (op?.t === "op" && (op.v === "==" || op.v === "!=")) {
      pos++;
      const rightTk = toks[pos];
      if (!rightTk) throw new Error(`when 表达式比较缺少右侧：${expr}`);
      pos++;
      const isEq = op.v === "==";
      return (f) => {
        const a = tokenToValue(leftTk, f);
        const b = tokenToValue(rightTk, f);
        const eq = a === undefined || b === undefined ? a === b : String(a) === String(b);
        return isEq ? eq : !eq;
      };
    }
    // 无比较符 = 存在性判定（路径取值后转布尔）
    return (f) => {
      const v = tokenToValue(leftTk, f);
      return Boolean(v);
    };
  };
  const pred = parseOr();
  if (pos !== toks.length) throw new Error(`when 表达式有未消费的记号（位置 ${pos}）：${expr}`);
  return pred;
}

// ---- emit → 事件 ----

export interface EmitSpec {
  kind:
    | "status"
    | "output"
    | "checkpoint"
    | "session-meta"
    | "file-change"
    | "turn-completed"
    | "completed"
    | "failed"
    | "log";
  phase?: string;
  summary?: string;
  text?: string;
  stream?: string;
  commitSha?: string;
  externalId?: string;
  path?: string;
  changeKind?: string;
  from?: string;
  usageIn?: string;
  usageOut?: string;
  level?: string;
  capture?: "lastMessage";
}

export interface CompiledEventMap {
  externalIdPath: string | null;
  rules: { when: Predicate; emit: EmitSpec }[];
  unmatched: "log" | "ignore";
}

export function compileEventMap(spec: HarnessEventMap | null): CompiledEventMap | null {
  if (!spec) return null;
  const rules = spec.rules.map((r) => ({ when: compileWhen(r.when), emit: r.emit as unknown as EmitSpec }));
  return { externalIdPath: spec.externalId ?? null, rules, unmatched: spec.unmatched };
}

const PHASES: AgentPhase[] = [
  "starting", "thinking", "editing", "running-command", "running-tests", "awaiting-input", "idle", "finished",
];
const CHANGE_KINDS: Record<string, FileChangeKind> = {
  add: "added", added: "added", create: "added", created: "added", new: "added",
  modified: "modified", update: "modified", updated: "modified", change: "modified", edit: "modified",
  delete: "deleted", deleted: "deleted", remove: "deleted", removed: "deleted",
  rename: "renamed", renamed: "renamed", move: "renamed", moved: "renamed",
};

function rv(frame: unknown, spec: string | undefined): string | undefined {
  if (spec === undefined) return undefined;
  const v = spec.startsWith("$") ? getPath(frame, spec) : spec;
  return v === undefined || v === null ? undefined : String(v);
}

function rn(frame: unknown, spec: string | undefined): number | undefined {
  const s = rv(frame, spec);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export interface FrameMapResult {
  events: AgentSessionEvent[];
  externalId: string | null;
  lastMessage: string | null;
  turnCompleted: boolean;
  /** 帧内显式终态（completed/failed）；exit code 终态由传输层合成 */
  completed: AgentOutcome | null;
}

export function mapFrame(cm: CompiledEventMap, frame: unknown): FrameMapResult {
  const res: FrameMapResult = { events: [], externalId: null, lastMessage: null, turnCompleted: false, completed: null };
  let matched = false;
  for (const rule of cm.rules) {
    let ok = false;
    try {
      ok = rule.when(frame);
    } catch {
      ok = false; // 求值异常按未匹配处理，不中断会话
    }
    if (!ok) continue;
    matched = true;
    const e = rule.emit;
    switch (e.kind) {
      case "status":
        res.events.push({
          type: "status",
          phase: (PHASES as string[]).includes(rv(frame, e.phase) ?? "") ? (rv(frame, e.phase) as AgentPhase) : "thinking",
          summary: rv(frame, e.summary),
        });
        break;
      case "output": {
        const text = rv(frame, e.text) ?? "";
        const stream = e.stream === "terminal" || e.stream === "tool" ? e.stream : "assistant";
        res.events.push({ type: "output", text, stream });
        if (e.capture === "lastMessage" && text.trim()) res.lastMessage = text;
        break;
      }
      case "checkpoint":
        res.events.push({
          type: "checkpoint",
          commitSha: rv(frame, e.commitSha) ?? "",
          summary: rv(frame, e.summary) ?? "",
        });
        break;
      case "session-meta": {
        const id = rv(frame, e.externalId) ?? (cm.externalIdPath ? rv(frame, cm.externalIdPath) : undefined);
        if (id) {
          res.events.push({ type: "session-meta", externalSessionId: id });
          res.externalId = id;
        }
        break;
      }
      case "file-change": {
        const targets = e.from ? expandPath(frame, e.from) : [frame];
        for (const t of targets) {
          const p = rv(t, e.path);
          if (!p) continue;
          const rawKind = (rv(t, e.changeKind) ?? "modified").toLowerCase();
          res.events.push({
            type: "file-change",
            path: p,
            kind: CHANGE_KINDS[rawKind] ?? "modified",
            summary: rv(t, e.summary),
          });
        }
        break;
      }
      case "turn-completed": {
        const input = rn(frame, e.usageIn);
        const output = rn(frame, e.usageOut);
        res.events.push({
          type: "turn-completed",
          usage: input === undefined && output === undefined ? undefined : { input, output },
        });
        res.turnCompleted = true;
        break;
      }
      case "completed":
      case "failed": {
        const outcome: AgentOutcome = e.kind === "completed" ? "completed" : "failed";
        res.events.push({ type: "completed", outcome, summary: rv(frame, e.summary) });
        res.completed = outcome;
        break;
      }
      case "log":
        res.events.push({
          type: "log",
          level: e.level === "debug" || e.level === "warn" || e.level === "error" ? e.level : "info",
          text: rv(frame, e.text) ?? "",
        });
        break;
    }
  }
  if (!matched && cm.unmatched === "log") {
    let snippet: string;
    try {
      snippet = JSON.stringify(frame) ?? "null";
    } catch {
      snippet = String(frame);
    }
    res.events.push({ type: "log", level: "info", text: `unmatched: ${snippet.slice(0, 240)}` });
  }
  // 顶层 externalId（thread.started 规则缺失时的兜底声明）
  if (!res.externalId && cm.externalIdPath) {
    const id = rv(frame, cm.externalIdPath);
    if (id) res.externalId = id;
  }
  return res;
}
