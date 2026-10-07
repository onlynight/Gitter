import { spawn } from "child_process";

// AI 网关（C# AiGateway 的 TS 移植，ai-native-redesign.md §8.1）：
// OpenAI 兼容 / Anthropic / 命令行桥三种传输，零 SDK 依赖。
// provider 由用户自配；隐私分级在 prompt 构造层执行（metadataOnly 不出 diff）。

export interface AiPrompt {
  system: string;
  user: string;
  maxOutputTokens: number;
}

export class AiGatewayError extends Error {}

export interface AiConfig {
  /** 内置 off|openai|anthropic|cli；扩展 provider 经 registerAiProvider（B 阶段接缝） */
  provider: string;
  endpoint: string | null;
  model: string | null;
  cliCommand: string | null;
  apiKey: string | null;
  timeoutSeconds?: number;
}

// ---- provider 注册表（extension-system-v2.md §16.6 B 阶段：三传输自举收编；D 阶段 AgentLoop 消费同一注册）----

type ProviderImpl = {
  isConfigured(c: AiConfig): boolean;
  complete(prompt: AiPrompt, c: AiConfig, timeoutMs: number): Promise<string>;
};

const PROVIDERS = new Map<string, ProviderImpl>();

/** 注册 AI provider（L2 插件经 host ctx 注册；内置三传输自举见下方 registerAiProvider 调用）。 */
export function registerAiProvider(name: string, impl: ProviderImpl): void {
  PROVIDERS.set(name, impl);
}

export function registeredProviders(): string[] {
  return [...PROVIDERS.keys()];
}

export function unregisterAiProvider(name: string): void {
  PROVIDERS.delete(name);
}

registerAiProvider("openai", {
  isConfigured: (c) => !!c.endpoint && !!c.model,
  complete: (p, c, t) => openAiComplete(p, c, t),
});
registerAiProvider("anthropic", {
  isConfigured: (c) => !!c.endpoint && !!c.model,
  complete: (p, c, t) => anthropicComplete(p, c, t),
});
registerAiProvider("cli", {
  isConfigured: (c) => !!c.cliCommand,
  complete: (p, c, t) => cliComplete(p, c, t),
});

export function isConfigured(c: AiConfig): boolean {
  return PROVIDERS.get(c.provider)?.isConfigured(c) ?? false;
}

export async function complete(prompt: AiPrompt, config: AiConfig): Promise<string> {
  const impl = PROVIDERS.get(config.provider);
  if (!impl || !impl.isConfigured(config)) throw new AiGatewayError("AI provider 未配置");
  const timeout = (config.timeoutSeconds ?? 60) * 1000;
  return impl.complete(prompt, config, timeout);
}

// ---- OpenAI 兼容 /chat/completions（覆盖 OpenAI/DeepSeek/Ollama /v1 等）----

async function openAiComplete(prompt: AiPrompt, config: AiConfig, timeoutMs: number): Promise<string> {
  const baseUri = config.endpoint!.replace(/\/+$/, "");
  const res = await fetchWithTimeout(baseUri + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: prompt.maxOutputTokens,
      stream: false,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
    timeoutMs,
  });
  const json = (await res.json().catch(() => null)) as any;
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new AiGatewayError(`OpenAI 兼容端点返回了意外结构: ${truncate(JSON.stringify(json))}`);
  }
  return text;
}

// ---- Anthropic /v1/messages ----

async function anthropicComplete(prompt: AiPrompt, config: AiConfig, timeoutMs: number): Promise<string> {
  let baseUri = config.endpoint!.replace(/\/+$/, "");
  if (!baseUri.endsWith("/v1")) baseUri += "/v1";
  const res = await fetchWithTimeout(baseUri + "/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: prompt.maxOutputTokens,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    }),
    timeoutMs,
  });
  const json = (await res.json().catch(() => null)) as any;
  const text = json?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new AiGatewayError(`Anthropic 端点返回了意外结构: ${truncate(JSON.stringify(json))}`);
  }
  return text;
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiGatewayError(`AI 端点返回 ${res.status}: ${truncate(body)}`);
    }
    return res;
  } catch (e) {
    if (e instanceof AiGatewayError) throw e;
    if ((e as Error).name === "AbortError") throw new AiGatewayError(`AI 请求超时（${Math.round(init.timeoutMs / 1000)}s）`);
    throw new AiGatewayError(`AI 请求失败: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---- 命令行桥（prompt 经 stdin 给用户自配 CLI，stdout 取结果——复用用户已有订阅）----

function cliComplete(prompt: AiPrompt, config: AiConfig, timeoutMs: number): Promise<string> {
  const [exe, args] = parseCliCommand(config.cliCommand!);
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      shell: false,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new AiGatewayError(`AI CLI 超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new AiGatewayError(`AI CLI 启动失败: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new AiGatewayError(`AI CLI 退出码 ${code}: ${truncate(stderr)}`));
        return;
      }
      const out = stdout.trim();
      if (!out) {
        reject(new AiGatewayError("AI CLI 返回空输出"));
        return;
      }
      resolve(out);
    });
    child.stdin.write(prompt.user, "utf8");
    child.stdin.end();
  });
}

/** 命令行解析（对齐 C# ParseCliCommand）：引号段可含空格；引号内无转义嵌套。 */
export function parseCliCommand(command: string): [string, string[]] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of command) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === " " && !inQuotes) {
      if (current) tokens.push(current);
      current = "";
    } else current += ch;
  }
  if (current) tokens.push(current);
  if (tokens.length === 0) throw new AiGatewayError("AI CLI 命令为空");
  return [tokens[0], tokens.slice(1)];
}

// ---- prompt 构造（CommitMessagePromptBuilder / ExplainPromptBuilder 移植）----

export const DIFF_BUDGET_CHARS = 12_000;
const MAX_FEW_SHOT = 20;

export type AiPrivacy = "metadataOnly" | "fullDiff" | "disabled";

export interface CommitMessageInput {
  recentSubjects: string[];
  files: { path: string; added: number; deleted: number }[];
  diffText: string | null;
}

export function buildCommitMessagePrompt(input: CommitMessageInput, privacy: AiPrivacy): AiPrompt {
  const sys: string[] = [
    "You are a commit message assistant inside a git client.",
    "Write ONE conventional-commit style message for the staged changes described below.",
    'Rules:',
    '- Output ONLY the message subject line (optionally a short body after a blank line). No quotes, no code fences, no explanations.',
    '- Prefer format "type: subject" (type = feat|fix|docs|test|build|chore|refactor) unless the examples below suggest otherwise.',
    "- Subject <= 72 characters, imperative mood, no trailing period.",
  ];
  if (input.recentSubjects.length > 0) {
    sys.push("", "Match the language and style of these recent commit messages from the same repository:");
    for (const s of input.recentSubjects.slice(0, MAX_FEW_SHOT)) sys.push("- " + s.replace(/\r?\n/g, " "));
  }

  const user: string[] = ["Staged files (path, +added, -deleted):"];
  for (const f of input.files) user.push(`- ${f.path} (+${f.added}, -${f.deleted})`);
  if (privacy === "fullDiff" && input.diffText) {
    user.push("", "Diff (may be truncated):", "```diff");
    const diff = input.diffText.length > DIFF_BUDGET_CHARS
      ? input.diffText.slice(0, DIFF_BUDGET_CHARS) + "\n… (truncated)"
      : input.diffText;
    user.push(diff, "```");
  }
  user.push("", "Write the commit message now.");
  return { system: sys.join("\n"), user: user.join("\n"), maxOutputTokens: 300 };
}

export type ExplainIntent = "explain" | "review";

export function buildExplainPrompt(
  files: { path: string; added: number; deleted: number }[],
  diffText: string | null,
  privacy: AiPrivacy,
  intent: ExplainIntent,
): AiPrompt {
  const system = intent === "review"
    ? "You are a precise code review assistant. Point out risks, bugs and suspicious patterns in the described changes. Be concrete and terse; reference files by path. Answer in the same language the diff content uses. Output plain text, no markdown headings."
    : "You are a precise code explanation assistant. Explain what the described changes do and why they might be made. Be concrete and terse; reference files by path. Answer in the same language the diff content uses. Output plain text, no markdown headings.";
  const user: string[] = [intent === "review" ? "Review these changes:" : "Explain these changes:", "", "Files (path, +added, -deleted):"];
  for (const f of files) user.push(`- ${f.path} (+${f.added}, -${f.deleted})`);
  if (privacy === "fullDiff" && diffText) {
    user.push("", "Diff (may be truncated):", "```diff");
    const d = diffText.length > DIFF_BUDGET_CHARS ? diffText.slice(0, DIFF_BUDGET_CHARS) + "\n… (truncated)" : diffText;
    user.push(d, "```");
  }
  return { system, user: user.join("\n"), maxOutputTokens: 600 };
}

/** 清理模型输出草稿：去代码围栏/包裹引号/空行（CleanDraft 移植）。 */
export function cleanDraft(draft: string): string {
  const lines = draft
    .trim()
    .replace(/^`+|`+$/g, "")
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("```"));
  if (lines.length === 0) return "";
  let subject = lines[0];
  if (subject.length >= 2 && (subject[0] === '"' || subject[0] === "'") && subject[subject.length - 1] === subject[0]) {
    subject = subject.slice(1, -1);
  }
  lines[0] = subject;
  return lines.join("\n");
}

function truncate(s: string): string {
  return s.length <= 300 ? s : s.slice(0, 300) + "…";
}

/** 隐私档位对 DTO 的适配（宽松形状：FileMetaDTO/FileStatusDTO 均可）。 */
export function filesOf(meta: { path: string; added: number | null; deleted: number | null }[]): { path: string; added: number; deleted: number }[] {
  return meta.map((f) => ({ path: f.path, added: f.added ?? 0, deleted: f.deleted ?? 0 }));
}
