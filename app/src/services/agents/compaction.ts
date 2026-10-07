import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { wrapReminder, compactionSystemPromptText } from "./prompts";
import type { CompactionRecord } from "./tasks";

/**
 * 上下文预算与自动压缩（agent-harness-v4.md F7）：
 * - 估算：字符数/2.5（中英混合经验值）+ 每消息 8 token 开销；
 * - 触发：turn 开始 est > 0.8 × budget（budget = contextWindow − reservedOutput）；
 * - 切割：保留最近 keepLast 条；切点必须落在 user 消息边界（保持 tool-call/result 配对完整）；
 * - 摘要：专用五段式提示词（目标/已完成/未完成/约束反馈/注意点），失败降级不压缩。
 */

const CHARS_PER_TOKEN = 2.5;
const PER_MESSAGE_OVERHEAD = 8;

export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    const c = m.content;
    if (typeof c === "string") chars += c.length;
    else if (Array.isArray(c)) {
      for (const p of c) {
        if (typeof p === "object" && p && "text" in p) chars += String((p as { text?: string }).text ?? "").length;
        else chars += 64; // tool-call/image 等部件估个常数
      }
    }
    chars += PER_MESSAGE_OVERHEAD;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** 预算（F7.1）。 */
export function budgetOf(contextWindow: number, reservedOutput = 8192): number {
  return Math.max(4096, contextWindow - reservedOutput);
}

/**
 * 找压缩切点：保留最近 keepLast 条；从候选切点向后找首个 user 边界；
 * 找不到则回退全文首个 user 边界（保底切在合法块边界）。返回被压缩段末索引（不含）。
 */
export function findCompactionCut(messages: ModelMessage[], keepLast = 8): number | null {
  if (messages.length <= keepLast) return null;
  const candidate = messages.length - keepLast;
  for (let i = candidate; i < messages.length; i++) {
    if (messages[i].role === "user") return i;
  }
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "user") return i;
  }
  return null;
}

function transcriptOf(messages: ModelMessage[], capChars = 60_000): string {
  const parts: string[] = [];
  let chars = 0;
  for (const m of messages) {
    let role = m.role;
    let text = "";
    const c = m.content;
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) {
      const chunks: string[] = [];
      for (const p of c) {
        if (typeof p === "object" && p) {
          if ("text" in p) chunks.push(String((p as { text?: string }).text ?? ""));
          else if ("toolName" in p) chunks.push(`[调用 ${String((p as { toolName?: string }).toolName)}：${JSON.stringify((p as { input?: unknown }).input ?? {}).slice(0, 400)}]`);
          else if ("toolCallId" in p) chunks.push(`[工具结果 ${(p as { toolCallId?: string }).toolCallId}：${String((p as { output?: { text?: string } }).output?.text ?? "").slice(0, 800)}]`);
        }
      }
      text = chunks.join("\n");
    }
    if (role === "tool") role = "user"; // 协议角色归一（摘要视角）
    const line = `【${role}】${text.trim()}\n`;
    if (chars + line.length > capChars) {
      parts.push(`…（更早内容省略 ${messages.length} 条中的前段）`);
      break;
    }
    parts.push(line);
    chars += line.length;
  }
  return parts.join("\n");
}

export interface CompactOptions {
  messages: ModelMessage[];
  contextWindow: number;
  systemEstTokens: number;
  model: LanguageModel;
  signal?: AbortSignal;
  /** 0.8 默认触发阈值 */
  threshold?: number;
  keepLast?: number;
}

export interface CompactResult {
  messages: ModelMessage[];
  record: CompactionRecord;
}

/** 预算检查 + 压缩；未触发/失败返回 null（绝不因压缩失败中断任务）。 */
export async function maybeCompact(opts: CompactOptions): Promise<CompactResult | null> {
  const budget = budgetOf(opts.contextWindow);
  const est = estimateMessagesTokens(opts.messages) + opts.systemEstTokens;
  const threshold = opts.threshold ?? 0.8;
  if (est <= budget * threshold) return null;

  const cut = findCompactionCut(opts.messages, opts.keepLast ?? 8);
  if (cut === null || cut < 1) return null;

  try {
    const transcript = transcriptOf(opts.messages.slice(0, cut));
    const r = await generateText({
      model: opts.model,
      system: await compactionSystemPromptText(),
      prompt: transcript,
      abortSignal: opts.signal,
      maxOutputTokens: 4000,
    });
    const summary = r.text.trim();
    if (!summary) return null;
    const kept = opts.messages.slice(cut);
    const replacement: ModelMessage = {
      role: "user",
      content: wrapReminder(`［会话压缩摘要 · ${new Date().toISOString()}］\n\n${summary}\n\n（以上摘要由宿主生成，取代更早的对话原文）`),
    };
    const next = [replacement, ...kept];
    return {
      messages: next,
      record: {
        ts: new Date().toISOString(),
        removedCount: cut,
        tokensBefore: est,
        tokensAfter: estimateMessagesTokens(next) + opts.systemEstTokens,
        summary: summary.slice(0, 2000),
      },
    };
  } catch {
    return null;
  }
}

/** 手动压缩（/compact）：不看阈值，能切就切。 */
export async function compactNow(opts: Omit<CompactOptions, "threshold">): Promise<CompactResult | null> {
  return maybeCompact({ ...opts, threshold: 0 });
}

// ---- 内置压缩器自举（§14.5：与插件压缩器同一接缝，单槽覆盖语义见 activeCompactor）----

import { registerCompactor } from "./seams";

registerCompactor({
  id: "builtin.summarizer",
  source: "builtin",
  compact: (input) => maybeCompact(input),
});

// ---- §20.4 #8 消息序列完整性校验（宿主内核，不迁移给插件/循环）----

export interface SequenceCheck {
  ok: boolean;
  badIndex: number;
  /** 自愈切点：最后一个合法 user 边界（不含） */
  cutIndex: number;
}

/**
 * 校验消息序列（tool-call/result 配对完整、首条为 user、user 前无未闭合调用）。
 * 非法时给出自愈切点（截到最后一个 user 边界）。
 */
export function validateMessageSequence(messages: ModelMessage[]): SequenceCheck {
  const openCalls = new Set<string>();
  let lastUserBoundary = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      if (openCalls.size > 0) return { ok: false, badIndex: i, cutIndex: lastUserBoundary };
      lastUserBoundary = i + 1;
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (typeof part !== "object" || !part) continue;
      const t = (part as { type?: string }).type;
      if (t === "tool-call") openCalls.add((part as { toolCallId?: string }).toolCallId ?? "");
      else if (t === "tool-result") {
        const id = (part as { toolCallId?: string }).toolCallId ?? "";
        if (!openCalls.delete(id)) return { ok: false, badIndex: i, cutIndex: lastUserBoundary };
      }
    }
  }
  if (openCalls.size > 0) {
    // 末尾存在未闭合调用：切到最后一个 user 边界
    return { ok: false, badIndex: messages.length, cutIndex: lastUserBoundary };
  }
  return { ok: true, badIndex: -1, cutIndex: messages.length };
}
