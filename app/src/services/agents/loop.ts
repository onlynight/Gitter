import { streamText, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { thinkingDirective } from "./prompts";
import type { AgentSessionEvent, ThinkingLevel } from "./types";

/**
 * Agent 循环（agent-harness.md v3.0 §三）：Vercel AI SDK streamText 多步工具循环。
 * 循环决策在本体（L2），工具执行经 tools.ts 的授权门/safety.ts——"决策可下放，执行不下放"。
 * 流式增量 → AgentSessionEvent（output 节流 120ms；tool-call → status；终态带用量）。
 * 思考深度双通道：reasoning_effort 由 provider.ts 的自定义 fetch 注入请求体（硬通道，off 不下发）+
 * 系统提示词指令（软通道，全 provider 生效，见 prompts.thinkingDirective）。
 */

export interface LoopOptions {
  /** 循环实现 id（缺省 builtin.default；taskType→loop 绑定经 createTask 解析） */
  loopId?: string;
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  signal: AbortSignal;
  thinking?: ThinkingLevel;
  onEvent: (ev: AgentSessionEvent) => void;
}

export interface LoopResult {
  outcome: "completed" | "failed" | "cancelled";
  lastMessage: string | null;
  usage: { input?: number; output?: number } | null;
  error?: string;
}

interface UsageShape {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  input?: { tokens?: number };
  output?: { tokens?: number };
}

function normalizeUsage(u: unknown): { input?: number; output?: number } | null {
  if (!u || typeof u !== "object") return null;
  const s = u as UsageShape;
  const input = s.inputTokens ?? s.input?.tokens;
  const output = s.outputTokens ?? s.output?.tokens;
  return input === undefined && output === undefined ? null : { input, output };
}

// ---- 循环注册表（agent-harness.md §十 / ui-pluginization-plan.md G7：taskType→loop 绑定）----
// 内置实现自举注册为 builtin.default；任务创建经 loopId（或 taskType.defaultLoop）选择实现。

const HARNESS_LOOPS = new Map<string, (o: LoopOptions) => Promise<LoopResult>>();
const DEFAULT_LOOP = "builtin.default";

export function registerHarnessLoop(id: string, impl: (o: LoopOptions) => Promise<LoopResult>): void {
  HARNESS_LOOPS.set(id, impl);
}

export function harnessLoops(): string[] {
  return [...HARNESS_LOOPS.keys()];
}

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const impl = HARNESS_LOOPS.get(o.loopId ?? DEFAULT_LOOP);
  if (!impl) throw new Error(`未注册的 Agent 循环：${o.loopId ?? DEFAULT_LOOP}`);
  return impl(o);
}

async function builtinLoop(o: LoopOptions): Promise<LoopResult> {
  let finalText = "";
  let pending = "";
  let lastFlush = 0;
  let usage: { input?: number; output?: number } | null = null;
  let errorText: string | undefined;

  const flush = (force = false) => {
    const now = Date.now();
    if (!pending) return;
    if (!force && now - lastFlush < 120) return;
    o.onEvent({ type: "output", text: pending, stream: "assistant" });
    pending = "";
    lastFlush = now;
  };

  try {
    const result = streamText({
      model: o.model,
      system: o.system + thinkingDirective(o.thinking),
      messages: o.messages,
      tools: o.tools,
      stopWhen: stepCountIs(50),
      abortSignal: o.signal,
    });
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          finalText += part.text;
          pending += part.text;
          flush();
          break;
        case "tool-call":
          flush(true);
          o.onEvent({
            type: "status",
            phase: "running-command",
            summary: `工具 ${part.toolName}（${JSON.stringify(part.input).slice(0, 120)}）`,
          });
          break;
        case "tool-result":
          o.onEvent({
            type: "log",
            level: "info",
            text: `${part.toolName} 完成：${JSON.stringify(part.output ?? "").slice(0, 200)}`,
          });
          break;
        case "tool-error":
          o.onEvent({ type: "log", level: "warn", text: `${part.toolName} 工具错误：${String(part.error).slice(0, 300)}` });
          break;
        case "error":
          errorText = part.error instanceof Error ? part.error.message : String(part.error);
          o.onEvent({ type: "log", level: "error", text: `循环错误：${errorText}` });
          break;
        default:
          break;
      }
    }
    flush(true);
    usage = normalizeUsage(await result.usage);
    o.onEvent({ type: "turn-completed", usage: usage ?? undefined, lastMessage: finalText.trim() || undefined });
    return {
      outcome: errorText ? "failed" : "completed",
      lastMessage: finalText.trim() || null,
      usage,
      error: errorText,
    };
  } catch (e) {
    flush(true);
    const err = e as Error;
    if (err.name === "AbortError" || o.signal.aborted) {
      return { outcome: "cancelled", lastMessage: finalText.trim() || null, usage, error: "已中断" };
    }
    o.onEvent({ type: "log", level: "error", text: `循环异常：${err.message}` });
    return { outcome: "failed", lastMessage: finalText.trim() || null, usage, error: err.message };
  }
}

registerHarnessLoop(DEFAULT_LOOP, builtinLoop);
