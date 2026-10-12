import { safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { OAuthManager } from "./services/oauth";
import { PackageStore } from "./services/extensions/store";
import { resourcePaths } from "./services/i18n";
import { SettingsStore } from "./services/settings";
import { looksLikeRepo } from "./services/gitexec";
import { pickProfileRef, resolveProfileModel } from "./services/agents/provider";
import { AgentSessionManager } from "./services/agents/session";
import type { AgentSessionEvent } from "./services/agents/types";
import type { ThinkingLevel } from "./shared/types";

/**
 * Headless 运行模式（M1.5 harness-mainline-roadmap.md）：
 *   electron . run --repo <path> -p "<prompt>" [--yolo] [--mode plan|default|yolo]
 *                 [--model <profileId>] [--thinking off|low|medium|high]
 *                 [--task-type <fullId>] [--json] [--timeout-sec N]
 * 复用 GUI 完全相同的 agents 核心（引擎不复制）；无确认通道 → 交互事件按策略自动裁决
 * （--yolo 放行授权；ask_user 取首个选项；plan 自动批准——全部在事件流中显式标注）。
 * 退出码：0=completed / 1=failed / 2=interrupted|stopped / 3=用法错误。
 * 注：CLI 子进程形态（无 Electron 依赖的 core 拆包）为本路线 M3 后续项。
 */

export interface HeadlessArgs {
  repo: string;
  prompt: string;
  mode: "plan" | "default" | "yolo";
  model: string | null;
  thinking: ThinkingLevel | null;
  taskType: string | null;
  json: boolean;
  timeoutSec: number;
}

export function parseHeadlessArgs(argv: string[], usageFail: (msg: string) => never): HeadlessArgs {
  let repo = "";
  let prompt = "";
  let mode: HeadlessArgs["mode"] = "default";
  let model: string | null = null;
  let thinking: ThinkingLevel | null = null;
  let taskType: string | null = null;
  let json = false;
  let timeoutSec = 1800;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (!v) usageFail(`参数 ${a} 缺少值`);
      return v;
    };
    if (a === "--repo") repo = next();
    else if (a === "-p" || a === "--prompt") prompt = next();
    else if (a === "--mode") mode = parseMode(next(), usageFail);
    else if (a === "--yolo") mode = "yolo";
    else if (a === "--plan") mode = "plan";
    else if (a === "--model") model = next();
    else if (a === "--thinking") thinking = next() as ThinkingLevel;
    else if (a === "--task-type") taskType = next();
    else if (a === "--json") json = true;
    else if (a === "--timeout-sec") timeoutSec = Math.max(10, Number(next()) || 1800);
    else usageFail(`未知参数：${a}`);
  }
  if (!repo) usageFail("缺少 --repo <仓库路径>");
  const full = path.resolve(repo);
  if (!fs.existsSync(full) || !looksLikeRepo(full)) usageFail(`不是有效的 git 仓库：${full}`);
  return { repo: full, prompt, mode, model, thinking, taskType, json, timeoutSec };
}

function parseMode(v: string, usageFail: (msg: string) => never): HeadlessArgs["mode"] {
  if (v === "plan" || v === "default" || v === "yolo") return v;
  usageFail(`--mode 只支持 plan|default|yolo，得到：${v}`);
}

export async function runHeadless(args: HeadlessArgs, appPath: string, userDataDir: string): Promise<number> {
  const out = (line: string): void => {
    process.stdout.write(line + "\n");
  };
  const outEvent = (ev: AgentSessionEvent, taskId: string): void => {
    if (args.json) {
      out(JSON.stringify({ ts: new Date().toISOString(), taskId, event: ev }));
      return;
    }
    humanPrintEvent(out, ev);
  };

  const res = resourcePaths(process.env.GITTER_RESOURCES ?? appPath);
  const settings = new SettingsStore(userDataDir);
  const pkgStore = new PackageStore(
    [res.themesRoot, res.packagesRoot],
    [path.join(userDataDir, "packages"), path.join(userDataDir, "themes")],
    "0.0.0-headless",
    () => settings.current.packages ?? {},
  );
  const oauth = new OAuthManager(userDataDir, {
    encrypt: (plain) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString("base64") : null),
    decrypt: (blob) => {
      try {
        return safeStorage.decryptString(Buffer.from(blob, "base64"));
      } catch {
        return null;
      }
    },
  });

  const resolveModel = (profileRef: string | null, thinking?: ThinkingLevel | null) => {
    const s = settings.current;
    const p = pickProfileRef(s.models ?? [], profileRef);
    if (!p) return { ok: false as const, error: "没有可用的模型档案：请先在 GUI 设置 → 模型档案 配置" };
    const key = p.apiKeyProtected && safeStorage.isEncryptionAvailable()
      ? (() => { try { return safeStorage.decryptString(Buffer.from(p.apiKeyProtected!, "base64")); } catch { return null; } })()
      : null;
    const r = resolveProfileModel({
      kind: p.kind, baseURL: p.baseURL, modelId: p.modelId, apiKey: key,
      params: p.params, thinking: (thinking ?? p.thinking ?? "medium") as ThinkingLevel,
      stripHistoryReasoning: p.capabilities?.stripHistoryReasoning,
    });
    return r.ok
      ? { ok: true as const, model: r.model, profileRef: p.id, contextWindow: p.capabilities?.contextTokens ?? 128_000 }
      : { ok: false as const, error: r.error };
  };
  // headless 不做降级链（故障快速失败，stderr 可见）
  void oauth;

  const agents = new AgentSessionManager({
    repoOf: () => args.repo,
    store: pkgStore,
    settings,
    resolveModel: (ref, thinking2) => Promise.resolve(resolveModel(ref, thinking2 ?? null)),
    addUsage: () => { /* headless 不累计 GUI 用量表 */ },
    send: (method, params) => {
      const p = params as { taskId?: string; event?: AgentSessionEvent };
      if (method === "agent.event" && p.event && p.taskId) {
        outEvent(p.event, p.taskId);
        headlessAutoRespond(agents, p.event, args.mode, out);
      }
    },
  });

  let task;
  try {
    task = await agents.createTask({
      prompt: args.prompt || "(空任务)",
      mode: args.mode,
      model: args.model ?? undefined,
      thinking: args.thinking ?? undefined,
      taskType: args.taskType ?? undefined,
    });
  } catch (e) {
    process.stderr.write(`[gitter] 任务创建失败：${(e as Error).message}\n`);
    return 3;
  }
  out(`[gitter] 任务 ${shortId(task.taskId)} 已下发（mode=${args.mode}）`);

  const deadline = Date.now() + args.timeoutSec * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    const rec = agents.listTasks({ includeArchived: true }).find((t) => t.taskId === task.taskId);
    if (!rec) return 1;
    if (rec.state === "completed" || (rec.state === "awaiting-input" && !rec.awaitKind)) {
      out(`[gitter] 完成：${(rec.lastMessage ?? "").slice(0, 400)}`);
      return 0;
    }
    if (rec.state === "failed") {
      process.stderr.write(`[gitter] 失败：${(rec.lastMessage ?? "").slice(0, 400)}\n`);
      return 1;
    }
    if (rec.state === "interrupted" || rec.state === "stopped") {
      process.stderr.write(`[gitter] ${rec.state === "stopped" ? "已停止" : "被中断"}：${(rec.lastMessage ?? "").slice(0, 200)}\n`);
      return 2;
    }
    if (Date.now() > deadline) {
      try {
        agents.stopTask({ taskId: task.taskId });
      } catch {
        /* 已终止 */
      }
      process.stderr.write(`[gitter] 超时（${args.timeoutSec}s），任务已停止\n`);
      return 2;
    }
  }
}

/** 无确认通道的自动裁决：授权按模式（yolo 放行/其余拒绝）、提问取首选项、计划自动批准。 */
function headlessAutoRespond(agents: AgentSessionManager, ev: AgentSessionEvent, mode: string, out: (s: string) => void): void {
  if (ev.type === "permission") {
    const ok = mode === "yolo";
    agents.replyPermission({ requestId: ev.requestId, ok });
    if (!ok) process.stderr.write(`[gitter] 权限请求被拒（headless 无确认通道，--yolo 可放行）：${ev.title} ${ev.detail.slice(0, 120)}\n`);
    else out(`[gitter] 权限自动放行（--yolo）：${ev.title}`);
  } else if (ev.type === "question") {
    const answer = ev.options[0] ?? "继续";
    agents.replyPermission({ requestId: ev.requestId, ok: true, answer });
    out(`[gitter] 提问自动应答（取首个选项）：${answer}`);
  } else if (ev.type === "plan") {
    agents.replyPermission({ requestId: ev.requestId, ok: true });
    out("[gitter] 计划自动批准（headless）");
  }
}

function humanPrintEvent(out: (s: string) => void, ev: AgentSessionEvent): void {
  switch (ev.type) {
    case "status":
      out(`▸ ${ev.summary ?? ev.phase}`);
      break;
    case "output":
      if (ev.stream === "assistant" && ev.text.trim()) out(ev.text);
      else if (ev.stream === "thinking" && ev.text.trim()) out(`  〔思〕${ev.text.trim().slice(0, 160)}`);
      break;
    case "tool":
      if (ev.phase === "start") out(`⚙ ${ev.name} ${safeArgs(ev.args)}`);
      else out(`${ev.isError ? "✗" : "✓"} ${ev.name}${ev.durationMs !== undefined ? ` (${ev.durationMs}ms)` : ""}`);
      break;
    case "permission":
      out(`⏸ 权限请求：${ev.title} ${ev.detail.slice(0, 160)}`);
      break;
    case "question":
      out(`? 提问：${ev.question} [${ev.options.join(" | ")}]`);
      break;
    case "plan":
      out("⏸ 计划已提交（见 journal）");
      break;
    case "checkpoint":
      out(`◆ checkpoint ${ev.commitSha.slice(0, 8)} ${ev.summary.slice(0, 80)}`);
      break;
    case "file-change":
      out(`  ${ev.kind === "added" ? "+" : ev.kind === "deleted" ? "-" : "~"} ${ev.path}`);
      break;
    case "todo":
      out(`  ☑ todo ${ev.todos.filter((t) => t.status === "completed").length}/${ev.todos.length}`);
      break;
    case "subtask":
      out(`  ⇂ 子代理 ${ev.name} ${ev.state}`);
      break;
    case "turn-completed":
      if (ev.usage) out(`· 轮完成（in ${ev.usage.input ?? "?"} / out ${ev.usage.output ?? "?"} tok）`);
      break;
    case "log":
      out(`· [${ev.level}] ${ev.text}`);
      break;
    default:
      break;
  }
}

function safeArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    return (s ?? "").length > 120 ? s.slice(0, 117) + "…" : s ?? "";
  } catch {
    return "";
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
