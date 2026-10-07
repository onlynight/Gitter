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
  const fetchWithThinking: typeof fetch = !inject
    ? fetch
    : async (input, init) => {
        if (init?.body && typeof init.body === "string") {
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
        return fetch(input, init);
      };
  const p = createOpenAICompatible({ name: "gitter-openai", baseURL: cfg.baseURL.trim(), apiKey: cfg.apiKey ?? "", fetch: fetchWithThinking });
  return { ok: true, model: p(cfg.modelId.trim()) };
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
