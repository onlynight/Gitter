import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * 模型档案解析（task-model-modules.md §二）：
 * ModelProfile 一等公民——解析链（任务绑定 → 任务型缺省 → 全局默认）与快慢分工
 * 的纯函数部分在此；bridge 负责密钥解密（safeStorage）后调用 resolveProfileModel。
 * 旧 resolveLanguageModel(settings 单档) 已被档案链取代（一次性迁移见 settings.ts）。
 */

export interface ProfileLike {
  id: string;
  enabled?: boolean;
  name?: string;
  capabilities?: { tools?: boolean };
}

export interface ProviderConfig {
  kind: "openai-compatible" | "anthropic";
  baseURL: string;
  modelId: string;
  apiKey: string | null;
  params?: { temperature?: number; maxOutputTokens?: number };
  /** 思考深度（硬通道）：openai-compatible 端点注入请求体 reasoning_effort；off/undefined 不注入 */
  thinking?: "off" | "low" | "medium" | "high";
}

export type ResolveResult = { ok: true; model: LanguageModel } | { ok: false; error: string };

/** 档案 → LanguageModel（密钥已由调用方解密）。 */
export function resolveProfileModel(cfg: ProviderConfig): ResolveResult {
  if (!cfg.modelId || !cfg.modelId.trim()) {
    return { ok: false, error: "档案缺少模型名" };
  }
  if (cfg.kind === "anthropic") {
    const p = createAnthropic({ apiKey: cfg.apiKey ?? "" });
    return { ok: true, model: p(cfg.modelId.trim()) };
  }
  if (!cfg.baseURL || !cfg.baseURL.trim()) {
    return { ok: false, error: "档案缺少端点 URL" };
  }
  // 硬通道：请求体注入 reasoning_effort（@ai-sdk/openai-compatible 不透传任意 providerOptions，
  // 用自定义 fetch 改写 JSON 体；仅 openai-compatible 且非 off 时注入，严格端点可设 思考深度=关闭）
  const inject = cfg.thinking && cfg.thinking !== "off";
  const fetchPatched: typeof fetch = async (input, init) => {
    if (inject && init?.body && typeof init.body === "string") {
      try {
        const j = JSON.parse(init.body);
        if (j && typeof j === "object" && !Array.isArray(j)) {
          j.reasoning_effort = cfg.thinking;
          init = { ...init, body: JSON.stringify(j) };
        }
      } catch {
        /* 非 JSON 体：原样放行 */
      }
    }
    const res = await fetch(input, init);
    if (!res.body) return res;
    const ctype = res.headers.get("content-type") ?? "";
    // §22.8 数据链路修复：DeepSeek 的 usage 用顶层 prompt_cache_hit_tokens 表达缓存命中，
    // @ai-sdk/openai-compatible 只认 OpenAI 形状的 prompt_tokens_details.cached_tokens——
    // 不归一则 cacheRead 恒 0、任务卡「缓存命中率」恒 0%。逐行按标记改写：非 DeepSeek 响应原样放行。
    if (ctype.includes("text/event-stream")) return normalizeUsageSse(res);
    if (ctype.includes("application/json")) return normalizeUsageJson(res);
    return res;
  };
  // includeUsage：流式请求带 stream_options.include_usage——否则 DeepSeek 等端点流式不回 usage，
  // 统计栏（token 用量/速度/缓存命中率）在 agent 轮（恒流式）下整条失效
  const p = createOpenAICompatible({ name: "gitter-openai", baseURL: cfg.baseURL.trim(), apiKey: cfg.apiKey ?? "", includeUsage: true, fetch: fetchPatched });
  return { ok: true, model: p(cfg.modelId.trim()) };
}

/** 单条 SSE 行 / 响应 JSON 的 usage 归一：DeepSeek 顶层 prompt_cache_hit_tokens → OpenAI prompt_tokens_details.cached_tokens。 */
function patchDeepSeekUsage(usage: { prompt_cache_hit_tokens?: unknown; prompt_tokens_details?: unknown } | undefined): boolean {
  const hit = usage?.prompt_cache_hit_tokens;
  if (!usage || typeof hit !== "number" || usage.prompt_tokens_details) return false;
  usage.prompt_tokens_details = { cached_tokens: hit };
  return true;
}

function deepSeekUsageNormalizedLine(line: string): string {
  if (!line.includes("prompt_cache_hit_tokens")) return line;
  const m = line.match(/^(\s*data:\s*)(\{.*\})(\s*)$/s);
  if (!m) return line;
  try {
    const j = JSON.parse(m[2]) as { usage?: { prompt_cache_hit_tokens?: unknown; prompt_tokens_details?: unknown } };
    if (patchDeepSeekUsage(j.usage)) return m[1] + JSON.stringify(j) + m[3];
  } catch {
    /* 半包/非 JSON 行原样放行 */
  }
  return line;
}

function resWithBody(body: string | ReadableStream<Uint8Array>, res: Response): Response {
  const headers = new Headers(res.headers);
  headers.delete("content-length"); // 改写后长度可能变化，避免消费端按旧长度截断
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/** SSE 响应：按行缓冲改写（一个 JSON 事件一行；跨网络分段由缓冲兜底）。 */
function normalizeUsageSse(res: Response): Response {
  if (!res.body) return res;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) ctrl.enqueue(encoder.encode(deepSeekUsageNormalizedLine(l) + "\n"));
      },
      flush(ctrl) {
        if (buf) ctrl.enqueue(encoder.encode(deepSeekUsageNormalizedLine(buf)));
      },
    }),
  );
  return resWithBody(body, res);
}

/** JSON 响应：解析改写 usage（错误体/无该字段原样重建）。 */
async function normalizeUsageJson(res: Response): Promise<Response> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { usage?: { prompt_cache_hit_tokens?: unknown; prompt_tokens_details?: unknown } };
    if (patchDeepSeekUsage(j?.usage)) return resWithBody(JSON.stringify(j), res);
  } catch {
    /* 非 JSON 原样放行 */
  }
  return resWithBody(text, res);
}

/**
 * 解析链（§2.2）：preferred（任务绑定/任务型缺省）→ defaultModelId → 首个可用档案。
 * 跳过 disabled 与 tools=false（工具循环硬拒绝，声明不信任）。
 */
export function pickProfileRef<T extends ProfileLike>(models: readonly T[], preferred: string | null): T | null {
  const chain = [preferred, ...(models.filter((m) => m.enabled !== false).map((m) => m.id))].filter(
    (x): x is string => !!x,
  );
  for (const ref of chain) {
    const m = models.find((x) => x.id === ref && x.enabled !== false);
    if (!m) continue;
    if (m.capabilities?.tools === false) continue;
    return m;
  }
  return null;
}

/** 快慢分工（§2.4）：fastModelId → defaultModelId → 首个；fast 档案失效自动回落。 */
export function pickFastProfileRef<T extends ProfileLike>(
  models: readonly T[],
  fastModelId: string | null,
  defaultModelId: string | null,
): T | null {
  const fast = fastModelId ? models.find((m) => m.id === fastModelId && m.enabled !== false) : undefined;
  if (fast) return fast;
  return pickProfileRef(models, defaultModelId);
}
