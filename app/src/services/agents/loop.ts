import { streamText, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { thinkingDirective } from "./prompts";
import type { AgentSessionEvent, ThinkingLevel } from "./types";

/**
 * Agent 循环（agent-harness-v4.md F1/F11/F12 + §14.3 统一循环注册表）：
 * - 历史回写（P0 修复）：response.messages（assistant/tool 消息）追加回宿主传入的 messages 数组；
 * - 重试退避：429/5xx/网络类错误 1s/4s/16s 最多 3 次（未产出任何步时可安全重试）；
 * - tool 事件：toolCallId 配对 start/end（时间线工具卡数据源）；
 * - 中断：AbortController；半截轮以 system-reminder 补记由宿主负责，此处只回写已完成步。
 */

export interface LoopServices {
  /** 只读代理面（§20.3.4：循环无法绕过门——resolver 只在 session 内部） */
  requestPermission(toolName: string, req: {
    title: string; detail: string; command?: string | null;
    payload?: import("./types").PermissionPayload; rememberable?: boolean;
  }): Promise<boolean>;
  askUser(question: string, options: string[]): Promise<string>;
  submitPlan(plan: string): Promise<{ status: "approved" | "revised"; feedback?: string }>;
  setTodos(todos: import("./types").TodoItem[]): void;
  spawnSubtask(args: { name: string; prompt: string; mode: string }): Promise<string>;
}

export interface LoopOptions {
  /** 循环实现 id（缺省 builtin.default；taskType→loop 绑定经 createTask 解析） */
  loopId?: string;
  model: LanguageModel;
  system: string;
  /** 宿主持有的消息数组（循环把响应消息追加回该数组——历史回写契约不变） */
  messages: ModelMessage[];
  tools: ToolSet;
  signal: AbortSignal;
  thinking?: ThinkingLevel;
  maxSteps?: number;
  /** worktree（插件循环适配器使用） */
  worktreePath?: string;
  /** §20.3.4 循环契约 v2：只读服务代理（授权/提问/计划/todo/子代理）——门在宿主，插件拿不到裸执行体 */
  services?: LoopServices;
  onEvent: (ev: AgentSessionEvent) => void;
}

export interface LoopResult {
  outcome: "completed" | "failed" | "cancelled";
  lastMessage: string | null;
  usage: { input?: number; output?: number; cacheRead?: number; elapsedMs?: number } | null;
  error?: string;
}

interface UsageShape {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  input?: { tokens?: number };
  output?: { tokens?: number };
  cacheReadInputTokens?: number;
  cache_read_input_tokens?: number;
}

function normalizeUsage(u: unknown): { input?: number; output?: number; cacheRead?: number } | null {
  if (!u || typeof u !== "object") return null;
  const s = u as UsageShape;
  const input = s.inputTokens ?? s.input?.tokens;
  const output = s.outputTokens ?? s.output?.tokens;
  const cacheRead = s.cacheReadInputTokens ?? s.cache_read_input_tokens;
  return input === undefined && output === undefined && cacheRead === undefined ? null : { input, output, cacheRead };
}

// ---- 统一循环注册表（§14.3：内置自举 + ctx.registerLoop 转发 + 插件循环适配）----

const HARNESS_LOOPS = new Map<string, (o: LoopOptions) => Promise<LoopResult>>();
const DEFAULT_LOOP = "builtin.default";
const MAX_RETRY = 3;
const RETRY_BACKOFF_MS = [1000, 4000, 16_000];

export function registerHarnessLoop(id: string, impl: (o: LoopOptions) => Promise<LoopResult>): void {
  HARNESS_LOOPS.set(id, impl);
}

export function unregisterHarnessLoop(id: string): void {
  HARNESS_LOOPS.delete(id);
}

export function harnessLoops(): string[] {
  return [...HARNESS_LOOPS.keys()];
}

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const id = o.loopId ?? DEFAULT_LOOP;
  const impl = HARNESS_LOOPS.get(id);
  if (impl) return impl(o);
  // 插件循环适配：ctx.registerLoop 注册的实现（AgentRunRequest 契约）→ LoopOptions 适配（§14.3）
  const { registeredLoopIds, runAdaptedLoop } = await import("./loopAdapter");
  if (registeredLoopIds().includes(id)) return runAdaptedLoop(id, o);
  throw new Error(`未注册的 Agent 循环：${id}`);
}

function isRetryableError(message: string): boolean {
  return /(?:\b429\b|rate.?limit|\b5\d\d\b|timeout|timed?\s?out|ECONN|EAI_AGAIN|fetch failed|network|socket)/i.test(
    message,
  );
}

async function builtinLoop(o: LoopOptions): Promise<LoopResult> {
  let finalText = "";
  let pending = "";
  let lastFlush = 0;
  let usage: { input?: number; output?: number; cacheRead?: number; elapsedMs?: number } | null = null;
  let errorText: string | undefined;
  // toolCallId → start 信息（工具卡配对）
  const openCalls = new Map<string, { name: string; args: unknown; start: number; source?: string | null }>();

  const flush = (force = false) => {
    const now = Date.now();
    if (!pending) return;
    if (!force && now - lastFlush < 120) return;
    o.onEvent({ type: "output", text: pending, stream: "assistant" });
    pending = "";
    lastFlush = now;
  };

  const toolSourceOf = (name: string): string | null => {
    const suffix = name.includes(".") ? name.split(".")[0] : null;
    if (!suffix) return null;
    if (suffix === "mcp") return "mcp";
    return "plugin";
  };

  let attempt = 0;
  for (;;) {
    errorText = undefined;
    try {
      const roundStartedAt = Date.now();
      const result = streamText({
        model: o.model,
        system: o.system + thinkingDirective(o.thinking),
        messages: o.messages,
        tools: o.tools,
        stopWhen: stepCountIs(o.maxSteps ?? 50),
        abortSignal: o.signal,
      });
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            finalText += part.text;
            pending += part.text;
            flush();
            break;
          case "tool-call": {
            flush(true);
            const callId = String((part as { toolCallId?: string }).toolCallId ?? `c${openCalls.size}`);
            const source = toolSourceOf(part.toolName);
            openCalls.set(callId, { name: part.toolName, args: part.input, start: Date.now(), source });
            o.onEvent({
              type: "tool",
              phase: "start",
              callId,
              name: part.toolName,
              args: part.input,
              source,
              subtaskId: undefined,
            });
            o.onEvent({
              type: "status",
              phase: "running-command",
              summary: `工具 ${part.toolName}（${JSON.stringify(part.input).slice(0, 120)}）`,
            });
            break;
          }
          case "tool-result": {
            const callId = String((part as { toolCallId?: string }).toolCallId ?? "");
            const open = openCalls.get(callId);
            openCalls.delete(callId);
            const resultText =
              typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? "");
            o.onEvent({
              type: "tool",
              phase: "end",
              callId,
              name: part.toolName,
              args: open?.args,
              result: resultText.slice(0, 16_000),
              durationMs: open ? Date.now() - open.start : undefined,
              isError: false,
              source: open?.source ?? toolSourceOf(part.toolName),
              subtaskId: undefined,
            });
            break;
          }
          case "tool-error": {
            const callId = String((part as { toolCallId?: string }).toolCallId ?? "");
            const open = openCalls.get(callId);
            openCalls.delete(callId);
            o.onEvent({
              type: "tool",
              phase: "end",
              callId,
              name: part.toolName,
              args: open?.args,
              result: `错误：${String(part.error).slice(0, 2000)}`,
              durationMs: open ? Date.now() - open.start : undefined,
              isError: true,
              source: open?.source ?? toolSourceOf(part.toolName),
              subtaskId: undefined,
            });
            o.onEvent({ type: "log", level: "warn", text: `${part.toolName} 工具错误：${String(part.error).slice(0, 300)}` });
            break;
          }
          case "error": {
            const message = part.error instanceof Error ? part.error.message : String(part.error);
            errorText = message;
            o.onEvent({ type: "log", level: "error", text: `循环错误：${message}` });
            break;
          }
          default:
            break;
        }
      }
      flush(true);
      usage = normalizeUsage(await result.usage);
      if (usage) usage.elapsedMs = Date.now() - roundStartedAt;
      // 历史回写（P0 修复）：assistant/tool 消息追加回宿主数组。
      // ai@7 的 StreamTextResult.response 不含 messages，正确出口是 responseMessages（自动消费流）。
      try {
        const respMsgs = await result.responseMessages;
        if (Array.isArray(respMsgs) && respMsgs.length > 0) {
          o.messages.push(...(respMsgs as unknown as ModelMessage[]));
        }
      } catch {
        /* 中断/流异常：已完成步的回写尽力而为 */
      }
      if (errorText) {
        const retryable = isRetryableError(errorText);
        if (retryable && attempt < MAX_RETRY - 1 && !finalText && !o.signal.aborted) {
          attempt++;
          o.onEvent({
            type: "log",
            level: "warn",
            text: `模型调用失败（${errorText.slice(0, 120)}），${RETRY_BACKOFF_MS[attempt - 1] / 1000}s 后重试（${attempt}/${MAX_RETRY - 1}）`,
          });
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]));
          continue;
        }
        o.onEvent({ type: "turn-completed", usage: usage ?? undefined, lastMessage: finalText.trim() || undefined });
        return { outcome: "failed", lastMessage: finalText.trim() || null, usage, error: errorText };
      }
      o.onEvent({ type: "turn-completed", usage: usage ?? undefined, lastMessage: finalText.trim() || undefined });
      return {
        outcome: "completed",
        lastMessage: finalText.trim() || null,
        usage,
      };
    } catch (e) {
      flush(true);
      const err = e as Error;
      if (err.name === "AbortError" || o.signal.aborted) {
        o.onEvent({ type: "turn-completed", usage: usage ?? undefined, lastMessage: finalText.trim() || undefined });
        return { outcome: "cancelled", lastMessage: finalText.trim() || null, usage, error: "已中断" };
      }
      const retryable = isRetryableError(err.message);
      if (retryable && attempt < MAX_RETRY - 1 && !finalText) {
        attempt++;
        o.onEvent({
          type: "log",
          level: "warn",
          text: `循环异常（${err.message.slice(0, 120)}），${RETRY_BACKOFF_MS[attempt - 1] / 1000}s 后重试`,
        });
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]));
        continue;
      }
      o.onEvent({ type: "log", level: "error", text: `循环异常：${err.message}` });
      return { outcome: "failed", lastMessage: finalText.trim() || null, usage, error: err.message };
    }
  }
}

registerHarnessLoop(DEFAULT_LOOP, builtinLoop);
