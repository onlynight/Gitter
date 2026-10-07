import { z } from "zod";
import { registerAgentTool } from "./registry";

/**
 * Web 工具（agent-harness-v4.md §21.2.2，D2）：web_search / web_fetch。
 * 经 registerAgentTool 同接缝自举注册（§14.4：与插件/MCP 同一条入表路径，无特判）。
 * readonly = 不改工作区（plan 模式可调研网络）；permissionClass=session（首次询问可记住）。
 * 安全：仅 http/https；禁本机/私网/链路本机地址（防提示注入探测内网）；
 * 免钥搜索走 DuckDuckGo HTML 端点，可能限流——结果不可靠时提示改用 web_fetch 直读。
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 GitterAgent/1.0";
const FETCH_TIMEOUT_MS = 20_000;
const DOWNLOAD_CAP = 1_000_000; // 单页最多取 1MB，防超大响应
const MAX_CHARS_DEFAULT = 32_000;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true;
  }
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (isBlockedHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

/** HTML → 正文文本：去 script/style/noscript、剥标签、压缩空白。 */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

async function fetchUrl(url: string, envSignal: AbortSignal): Promise<{ body: string; contentType: string; finalUrl: string; status: number }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => ac.abort();
  envSignal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (/^(image|video|audio)\//.test(contentType) || /octet-stream/.test(contentType)) {
      throw new Error(`内容为二进制（${contentType.split(";")[0]}），不支持读取`);
    }
    const buf = await res.arrayBuffer();
    const body = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, DOWNLOAD_CAP));
    return { body, contentType, finalUrl: res.url || url, status: res.status };
  } finally {
    clearTimeout(timer);
    envSignal.removeEventListener("abort", onAbort);
  }
}

// ---- web_fetch ----

registerAgentTool({
  name: "web_fetch",
  description:
    "读取指定 URL 的网页/接口内容并转为纯文本（HTML 自动剥标签，JSON/纯文本原样）。用于查阅文档、issue、报错页、API 响应。仅 http/https，禁止本机与内网地址；内容可能过期，判断以页面为准。",
  parametersSchema: z.object({
    url: z.string().describe("完整 URL（http/https）"),
    maxChars: z.number().int().optional().describe("返回正文最大字符数，默认 32000，上限 64000"),
  }),
  permissionClass: "session",
  source: "builtin",
  readonly: true,
  async execute(_env, args) {
    const url = parseUrl(String(args.url ?? ""));
    if (!url) return "错误：URL 非法（仅支持 http/https，且禁止本机/内网地址）";
    const maxChars = Math.min(64_000, Math.max(500, Number(args.maxChars) || MAX_CHARS_DEFAULT));
    try {
      const { body, contentType, finalUrl, status } = await fetchUrl(url.toString(), _env.signal);
      const text = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body) ? htmlToText(body) : body;
      const clipped = text.length > maxChars
        ? text.slice(0, maxChars) + `\n…（已截断，正文共 ${text.length} 字符；可调大 maxChars 或换更具体的页面）`
        : text || "（页面无正文）";
      return `# ${finalUrl}\n（HTTP ${status} · ${contentType.split(";")[0] || "未知类型"}）\n\n${clipped}`;
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? `超时（${FETCH_TIMEOUT_MS / 1000}s）或被中断` : (e as Error).message;
      return `错误：读取失败（${msg}）。可稍后重试，或改用其他来源。`;
    }
  },
});

// ---- web_search ----

interface SearchHit { title: string; url: string; snippet: string }

function decodeDdgHref(href: string): string {
  // DuckDuckGo 结果链接是 //duckduckgo.com/l/?uddg=<encoded> 跳转；解码取真实 URL
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  if (href.startsWith("//")) return `https:${href}`;
  return href;
}

registerAgentTool({
  name: "web_search",
  description:
    "网络搜索（DuckDuckGo，免钥匙）：按关键词搜索，返回标题/URL/摘要列表（≤10 条）。用于查文档、报错信息、库用法、最新动态。结果可能过期或不全——重要结论用 web_fetch 读取页面确认。",
  parametersSchema: z.object({
    query: z.string().min(1).describe("搜索关键词"),
    maxResults: z.number().int().optional().describe("返回条数，默认 8，上限 10"),
  }),
  permissionClass: "session",
  source: "builtin",
  readonly: true,
  async execute(_env, args) {
    const q = String(args.query ?? "").trim();
    if (!q) return "错误：query 为空";
    const n = Math.min(10, Math.max(1, Number(args.maxResults) || 8));
    try {
      const { body } = await fetchUrl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, _env.signal);
      const hits: SearchHit[] = [];
      const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippets = [...body.matchAll(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => stripTags(m[1]));
      let si = 0;
      for (const m of body.matchAll(re)) {
        if (hits.length >= n) break;
        const url = decodeDdgHref(m[1]);
        if (!/^https?:\/\//.test(url)) continue;
        hits.push({ title: stripTags(m[2]), url, snippet: snippets[si++] ?? "" });
      }
      if (hits.length === 0) {
        return `未搜到结果（query: ${q}）。DuckDuckGo 可能限流或被拦截——可稍后重试，或用 web_fetch 直接读取已知 URL。`;
      }
      const lines = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet.slice(0, 200)}` : ""}`);
      return `搜索“${q}”共 ${hits.length} 条：\n\n${lines.join("\n")}\n\n（摘要仅供筛选取向，结论请用 web_fetch 读原文确认）`;
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? `超时（${FETCH_TIMEOUT_MS / 1000}s）或被中断` : (e as Error).message;
      return `错误：搜索失败（${msg}）。可稍后重试，或用 web_fetch 直接读取已知 URL。`;
    }
  },
});
