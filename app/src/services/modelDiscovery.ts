/**
 * 模型发现（DeepSeek-harness 式添加模型弹窗的后端）：
 * 对 OpenAI 兼容 /models 与 Anthropic /v1/models 做单次抓取 + 模型卡探测，
 * 归一成 ModelDiscoveryEntryDTO（id/name/contextTokens/image）。
 *
 * 契约说明：只有 OpenAI 模型卡（/models/v1、/models/v2、v3 的 model.card）暴露
 * context window 与 image 输入模态；Anthropic 端点只返回 id 列表。无原生声明时
 * UI 用命名启发式（imageGuess/contextHint）决定勾选与置灰，不假装精确。
 *
 * 探测请求逐个模型串行发出，数量上限 + 总时长硬顶：第三方网关不应因一次探测被打爆。
 */
import type { ModelDiscoveryEntryDTO } from "../shared/types";

const CARD_TIMEOUT_MS = 4_000;
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_LIMIT = 12;
const PROBE_TOTAL_MS = 45_000;

export interface DiscoverArgs {
  kind: "openai-compatible" | "anthropic";
  baseURL: string;
  apiKey?: string;
}

export interface DiscoverResult {
  /** 端点级错误信息（成功时为 null） */
  error: string | null;
  /** 模型卡探测是否被限制/跳过（模型多时后端只探前 PROBE_LIMIT 个） */
  probesTruncated: boolean;
  models: ModelDiscoveryEntryDTO[];
}

const MAX_CONVENTIONAL = new Map<string, number>([
  ["context", 32_768],
  ["32k", 32_768],
  ["32k-context", 32_768],
  ["32k_v1", 32_768],
  ["32b", 32_768],
  ["32b-instruct", 32_768],
  ["64k", 65_536],
  ["64k-context", 65_536],
  ["64b", 65_536],
  ["64b-instruct", 65_536],
  ["65k", 65_536],
  ["65k-context", 65_536],
  ["96k", 98_304],
  ["96k-context", 98_304],
  ["96b", 98_304],
  ["96b-instruct", 98_304],
  ["128k", 131_072],
  ["128k-context", 131_072],
  ["128b", 131_072],
  ["128b-instruct", 131_072],
  ["131k", 131_072],
  ["131k-context", 131_072],
  ["180k", 184_320],
  ["180k-context", 184_320],
  ["200k", 204_800],
  ["256k", 262_144],
  ["256b", 262_144],
  ["256b-instruct", 262_144],
]);

/** 命名含视觉标记 → 可能支持图片（无原生声明时的唯一依据）。 */
export function guessVision(id: string): boolean {
  const s = id.toLowerCase();
  return /(^|[-_/.])(vl|vision|mm|-1m$|vl-chat|vl-max|vl-plus|vl1.5|vl2)/.test(s)
    || /vision/.test(s)
    || /(vl|llava|llava-15|internvl|step-?vl|minicpm-?v)/.test(s);
}

const MULT = { k: 1_024, m: 1_048_576 } as const;
const SUFFIXES = ["-context", "-ctx", "-ca", "-cc", "-c", "-long", "-l"];
/** 名称尾部的数值窗口标记：64k / 64K / 200k / 1m / 128,000 */
const WINDOW_TAIL = /[\s\-_/]([\d.]+)([kmg])$/i;

function numWindow(s: string): number | null {
  const m = WINDOW_TAIL.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = { k: 1_024, m: 1_048_576, g: 1_073_741_824 }[m[2].toLowerCase() as "k" | "m" | "g"]!;
  return Math.floor(n * mult);
}

/** 命名带 context 标记 → 上下文窗口提示（不写进档案，仅供 UI 回填参考）。 */
export function contextHint(id: string): number | null {
  const s = id.toLowerCase().trim();
  if (MAX_CONVENTIONAL.has(s)) return MAX_CONVENTIONAL.get(s)!;
  for (const suffix of SUFFIXES) {
    if (s.endsWith(suffix)) {
      const base = s.slice(0, -suffix.length);
      if (MAX_CONVENTIONAL.has(base)) return MAX_CONVENTIONAL.get(base)!;
      const hint = numWindow(base);
      if (hint) return hint;
    }
  }
  // 尾部裸数值窗口（gpt-4-200k / qwen1.5-1m）：仅在名字以窗口标记结尾时采信
  return numWindow(s);
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 列表抓取：OpenAI 兼容 /models 与 Anthropic /v1/models 的 id 归一。 */
export async function listModels(args: DiscoverArgs): Promise<string[]> {
  const base = args.baseURL.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Base URL 不能为空");
  const headers: Record<string, string> = args.kind === "anthropic"
    ? { "x-api-key": args.apiKey ?? "", "anthropic-version": "2023-06-01" }
    : args.apiKey ? { authorization: `Bearer ${args.apiKey}` } : {};
  const url = args.kind === "anthropic"
    ? `${base.endsWith("/v1") ? base : base + "/v1"}/models`
    : `${base}/models`;
  const res = await timedFetch(url, { headers }, PROBE_TIMEOUT_MS);
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? "（密钥无效或缺失）"
      : res.status === 404 ? "（端点不存在，检查 Base URL）"
      : res.status === 429 ? "（限流，稍后再试）" : "";
    throw new Error(`HTTP ${res.status}${hint}`);
  }
  const j = (await res.json()) as {
    data?: Record<string, unknown>[];
    models?: Record<string, unknown>[];
    error?: { message?: string; type?: string };
  };
  if (j.error) throw new Error(j.error.message ?? j.error.type ?? "端点返回了错误对象");
  const rows = (Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : []).filter(
    (x) => typeof x?.id === "string" && !!x.id,
  );
  return rows.map((x) => x.id as string);
}

type OpenAiShape = {
  context_length?: unknown;
  max_context_length?: unknown;
  max_input_tokens?: unknown;
  context_window?: unknown;
  context_length_null_is_unspecified?: unknown;
  input_modalities?: unknown;
  input_types?: unknown;
  supported_parameters?: unknown;
  model?: { card?: { metadata?: Record<string, unknown>; specs?: { input_modalities?: unknown } } };
  card?: { metadata?: Record<string, unknown>; specs?: { input_modalities?: unknown } };
};

/** 解析 OpenAI 模型卡（v1/v2/v3）的上下文窗口与输入模态；无则 null。 */
export function parseModelCard(json: unknown): { contextTokens: number | null; image: boolean | null } {
  const j = json as OpenAiShape ?? {};
  const candidates: unknown[] = [];
  const v3Meta = j.model?.card?.metadata ?? j.card?.metadata;
  if (v3Meta) candidates.push(v3Meta.context_length, v3Meta.max_context_length, v3Meta.max_input_tokens);
  candidates.push(j.context_length, j.max_context_length, j.max_input_tokens, j.context_window);

  let contextTokens: number | null = null;
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) { contextTokens = Math.floor(c); break; }
  }
  // v2 的 null_is_unspecified 标记：context_length=null 属"未声明"而非"无限"，保持 null。

  let image: boolean | null = null;
  const specsMod = j.model?.card?.specs?.input_modalities ?? j.card?.specs?.input_modalities;
  for (const mod of [specsMod, v3Meta?.input_modalities, j.input_modalities, j.input_types, j.supported_parameters]) {
    if (!Array.isArray(mod)) continue;
    const has = mod.some((m) => typeof m === "string" && /(^|[-_./])image/i.test(m));
    if (has || mod.length > 0) { image = has; break; }
  }
  return { contextTokens, image };
}

/** 单个模型卡的上下文/模态探测：GET /models/{id}（v2）与 GET /models（v3 全量卡）两路都试。 */
async function probeCard(args: DiscoverArgs, modelId: string, deadline: number): Promise<{ contextTokens: number | null; image: boolean | null }> {
  const base = args.baseURL.trim().replace(/\/+$/, "");
  const headers: Record<string, string> = args.apiKey ? { authorization: `Bearer ${args.apiKey}` } : {};
  const url = `/models/${encodeURIComponent(modelId)}`;
  const fullUrl = `/models`;
  for (const path of [url, fullUrl]) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    try {
      const res = await timedFetch(base + path, { headers, signal: AbortSignal.timeout(left) }, Math.min(CARD_TIMEOUT_MS, left));
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      if (!json || typeof json !== "object") continue;
      const found = parseModelCard(json);
      if (found.contextTokens !== null || found.image !== null) return found;
    } catch {
      // 单个模型卡不可得是常态（多数网关未实现），跳过继续下一路
    }
  }
  return { contextTokens: null, image: null };
}

/**
 * 完整发现流程：列表 + 模型卡探测。
 * 探测失败不阻断列表返回——UI 仍可按 id 手动选择，只是上下文/视觉留空或走启发式。
 */
export async function discoverModels(args: DiscoverArgs): Promise<DiscoverResult> {
  let ids: string[];
  try {
    ids = await listModels(args);
  } catch (e) {
    return { error: (e as Error).message, probesTruncated: false, models: [] };
  }
  if (ids.length === 0) return { error: "端点未返回任何模型", probesTruncated: false, models: [] };

  const probesTruncated = ids.length > PROBE_LIMIT;
  const deadline = Date.now() + PROBE_TOTAL_MS;
  const models: ModelDiscoveryEntryDTO[] = [];
  for (const id of ids) {
    const probed = args.kind === "openai-compatible" && Date.now() < deadline && ids.indexOf(id) < PROBE_LIMIT
      ? await probeCard(args, id, deadline)
      : { contextTokens: null, image: null };
    const hint = contextHint(id);
    models.push({
      id,
      name: id,
      contextTokens: probed.contextTokens ?? hint,
      image: probed.image ?? null,
      imageGuess: guessVision(id),
      contextHint: hint,
    });
  }
  return { error: null, probesTruncated, models };
}
