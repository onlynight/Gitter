import type { AiConfig } from "../ai";
import type { ToolRegistry, ToolContext } from "./tools";

/**
 * AgentLoop（extension-system-v2.md §十六 D 阶段 / §十五）：
 * 工具调用循环——决策在模型，执行在宿主 ToolRegistry（安全不变量：决策权可下放，执行权不下放）。
 * 传输：双协议——OpenAI 兼容 /chat/completions（SSE 流式）+ Anthropic 原生 /v1/messages
 * tools 协议（content blocks，非流式）。技能 = L1 数据包注入系统提示。
 * registerAgentLoop：循环本身可替换（第三方循环 = L3，F 阶段；内置循环自举注册）。
 */

export interface SkillRef {
  name: string;
  instructions: string;
}

export interface AgentStep {
  kind: "text" | "tool";
  text?: string;
  tool?: string;
  args?: unknown;
  result?: string;
}

export interface AgentRunRequest {
  workDir: string;
  system: string;
  user: string;
  /** 注入系统提示的技能（skills 接缝解析产物） */
  skills: SkillRef[];
  /** 参与循环的工具名；缺省 = 注册表全部工具 */
  toolNames?: string[];
  maxSteps?: number;
  requestApproval: (description: string) => Promise<boolean>;
  /** 流式回调（D 阶段残留收口：SSE delta 透传，仅文本增量） */
  onDelta?: (delta: string) => void;
  onStep?: (step: AgentStep) => void;
}

export interface AgentRunResult {
  text: string;
  steps: AgentStep[];
}

type LoopImpl = (req: AgentRunRequest, config: AiConfig) => Promise<AgentRunResult>;

const LOOPS = new Map<string, LoopImpl>();

let activeRegistry: ToolRegistry | null = null;

/** main 启动时绑定统一工具总线（循环执行器只认注册表——执行权在宿主）。 */
export function bindToolRegistry(reg: ToolRegistry): void {
  activeRegistry = reg;
}

/** 注册循环实现（内置自举 + L2 ctx.registerLoop + L3 存根）。 */
export function registerAgentLoop(id: string, impl: LoopImpl): void {
  LOOPS.set(id, impl);
}

export function registeredLoops(): string[] {
  return [...LOOPS.keys()];
}

export function unregisterAgentLoop(id: string): void {
  LOOPS.delete(id);
}

export async function runRegisteredLoop(id: string, req: AgentRunRequest, config: AiConfig): Promise<AgentRunResult> {
  const impl = LOOPS.get(id);
  if (!impl) throw new Error(`未注册的 Agent 循环：${id}`);
  return impl(req, config);
}

// ---- 内置工具循环（OpenAI 兼容 function calling）----

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

async function chat(cfg: AiConfig, messages: ChatMessage[], tools: unknown[], timeoutMs: number, onDelta?: (d: string) => void): Promise<ChatMessage> {
  const base = (cfg.endpoint ?? "").replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const stream = !!onDelta;
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: "auto", stream }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM 端点返回 ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    if (!stream) {
      const json = (await res.json().catch(() => null)) as any;
      const msg = json?.choices?.[0]?.message;
      if (!msg) throw new Error(`LLM 端点返回意外结构: ${JSON.stringify(json).slice(0, 200)}`);
      return msg as ChatMessage;
    }
    // SSE：内容 delta 透传 onDelta；tool_calls 按 index 分片组装
    let full: ChatMessage = { role: "assistant", content: "" };
    const parts: { id?: string; name?: string; args: string }[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const d = j.choices?.[0]?.delta ?? {};
          if (typeof d.content === "string" && d.content.length > 0) {
            full.content += d.content;
            onDelta!(d.content);
          }
          for (const tc of d.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            parts[idx] ??= { args: "" };
            if (tc.id) parts[idx].id = tc.id;
            if (tc.function?.name) parts[idx].name = tc.function.name;
            if (tc.function?.arguments) parts[idx].args += tc.function.arguments;
          }
        } catch { /* 非 JSON 行忽略 */ }
      }
    }
    const used = parts.filter(Boolean);
    if (used.length > 0) {
      full.tool_calls = used.map((p, i) => ({
        id: p.id ?? `call_${i}`,
        type: "function" as const,
        function: { name: p.name ?? "", arguments: p.args },
      }));
      full.content = full.content || null;
    }
    return full;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`LLM 请求超时（${Math.round(timeoutMs / 1000)}s）`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function builtinToolLoop(req: AgentRunRequest, config: AiConfig): Promise<AgentRunResult> {
  if (!config.endpoint || !config.model) throw new Error("Agent 循环需要配置 openai 兼容端点与模型");
  const registry = activeRegistry;
  if (!registry) throw new Error("ToolRegistry 未初始化");
  const names = req.toolNames ?? registry.list().map((t) => t.name);
  const toolDefs = names.map((n) => registry.get(n)).filter((t): t is NonNullable<ReturnType<ToolRegistry["get"]>> => !!t);
  const tools = toolDefs.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: { type: "object", properties: {} } },
  }));

  const system = req.skills.length > 0
    ? `${req.system}\n\n# 可用技能\n${req.skills.map((s) => `## ${s.name}\n${s.instructions}`).join("\n\n")}`
    : req.system;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: req.user },
  ];
  const steps: AgentStep[] = [];
  const ctx: ToolContext = { workDir: req.workDir, requestApproval: req.requestApproval };
  const maxSteps = Math.max(1, Math.min(req.maxSteps ?? 8, 24));
  let final = "";

  for (let step = 0; step < maxSteps; step++) {
    const msg = await chat(config, messages, tools, (config.timeoutSeconds ?? 120) * 1000, req.onDelta);
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch { /* 非法参数按空对象 */ }
        const result = await registry.call(call.function.name, args, ctx);
        const text = result ?? `未知工具: ${call.function.name}`;
        steps.push({ kind: "tool", tool: call.function.name, args, result: text });
        req.onStep?.(steps[steps.length - 1]);
        messages.push({ role: "tool", tool_call_id: call.id, content: text });
      }
      continue;
    }
    final = typeof msg.content === "string" ? msg.content : "";
    steps.push({ kind: "text", text: final });
    req.onStep?.(steps[steps.length - 1]);
    return { text: final, steps };
  }
  throw new Error(`Agent 循环超过最大步数（${maxSteps}）`);
}

registerAgentLoop("builtin.tools", builtinToolLoop);

// ---- Anthropic 原生 tools 协议（/v1/messages：tool_use / tool_result content blocks）----

interface AnthropicBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}

async function anthropicChat(
  cfg: AiConfig,
  system: string,
  messages: AnthropicMessage[],
  tools: unknown[],
  timeoutMs: number,
  onDelta?: (d: string) => void,
): Promise<AnthropicBlock[]> {
  let base = (cfg.endpoint ?? "").replace(/\/+$/, "");
  if (!base.endsWith("/v1")) base += "/v1";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const stream = !!onDelta;
    const res = await fetch(base + "/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages, tools, stream }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Anthropic 端点返回 ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    if (!stream) {
      const json = (await res.json().catch(() => null)) as { content?: AnthropicBlock[] };
      if (!Array.isArray(json?.content)) throw new Error("Anthropic 端点返回意外结构");
      return json.content;
    }
    // SSE：content_block_delta 的 text_delta 透传 onDelta；input_json_delta 按 index 组装 tool_use input
    const out: AnthropicBlock[] = [];
    const jsonParts: string[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          if (j.type === "content_block_start") {
            const cb = j.content_block ?? {};
            out[j.index ?? out.length] = cb.type === "tool_use"
              ? { type: "tool_use", id: cb.id, name: cb.name, input: {} }
              : { type: "text", text: cb.text ?? "" };
          } else if (j.type === "content_block_delta") {
            const idx = j.index ?? 0;
            const d = j.delta ?? {};
            if (d.type === "text_delta" && d.text) {
              out[idx] ??= { type: "text", text: "" };
              out[idx].text = (out[idx].text ?? "") + d.text;
              onDelta!(d.text);
            } else if (d.type === "input_json_delta") {
              jsonParts[idx] = (jsonParts[idx] ?? "") + d.partial_json;
            }
          } else if (j.type === "content_block_stop") {
            const idx = j.index ?? 0;
            if (out[idx]?.type === "tool_use" && jsonParts[idx]) {
              try { out[idx].input = JSON.parse(jsonParts[idx]); } catch { /* 非法分片按空 input */ }
            }
          }
        } catch { /* 非 JSON 行忽略 */ }
      }
    }
    return out.filter(Boolean);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`LLM 请求超时（${Math.round(timeoutMs / 1000)}s）`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function builtinAnthropicLoop(req: AgentRunRequest, config: AiConfig): Promise<AgentRunResult> {
  if (!config.endpoint || !config.model) throw new Error("Agent 循环需要配置 Anthropic 端点与模型");
  const registry = activeRegistry;
  if (!registry) throw new Error("ToolRegistry 未初始化");
  const names = req.toolNames ?? registry.list().map((t) => t.name);
  const tools = names
    .map((n) => registry.get(n))
    .filter((t): t is NonNullable<ReturnType<ToolRegistry["get"]>> => !!t)
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: "object" as const, properties: {} as Record<string, unknown> },
    }));

  const system = req.skills.length > 0
    ? `${req.system}\n\n# 可用技能\n${req.skills.map((s) => `## ${s.name}\n${s.instructions}`).join("\n\n")}`
    : req.system;
  const messages: AnthropicMessage[] = [{ role: "user", content: req.user }];
  const steps: AgentStep[] = [];
  const ctx: ToolContext = { workDir: req.workDir, requestApproval: req.requestApproval };
  const maxSteps = Math.max(1, Math.min(req.maxSteps ?? 8, 24));
  const timeoutMs = (config.timeoutSeconds ?? 120) * 1000;

  for (let step = 0; step < maxSteps; step++) {
    const blocks = await anthropicChat(config, system, messages, tools, timeoutMs, req.onDelta);
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const toolUses = blocks.filter((b) => b.type === "tool_use" && b.id && b.name);
    if (toolUses.length === 0) {
      steps.push({ kind: "text", text });
      req.onStep?.(steps[steps.length - 1]);
      return { text, steps };
    }
    messages.push({ role: "assistant", content: blocks });
    const results: AnthropicBlock[] = [];
    for (const tu of toolUses) {
      const result = await registry.call(tu.name!, tu.input ?? {}, ctx);
      const content = result ?? `未知工具: ${tu.name}`;
      steps.push({ kind: "tool", tool: tu.name!, args: tu.input ?? {}, result: content });
      req.onStep?.(steps[steps.length - 1]);
      results.push({ type: "tool_result", tool_use_id: tu.id!, content });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error(`Agent 循环超过最大步数（${maxSteps}）`);
}

registerAgentLoop("builtin.tools.anthropic", builtinAnthropicLoop);
