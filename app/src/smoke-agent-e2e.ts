/**
 * Agent v4 编排端到端烟雾（agent-harness-v4.md §十七：假 provider 脚本化 tool-call 流）：
 * 真实 AgentSessionManager + 真实 git 临时仓库 + 脚本化 LanguageModel——
 * 覆盖：E1 历史回写（P0）/ E2 读→patch 写链 / E3 前缀规则门 / E4 ask_user 回传 /
 * E5 plan 批准自动续执行轮 / E6 子代理结果回传 / E7 排队投递注入 / E8 journal+会话落盘 / E9 图片输入（D1）/
 * E10 前缀缓存稳定性（§二十二：系统提示词冻结 / 工具面确定性 / cacheGuard 尾部注入）。
 * 运行：node dist/smoke-agent-e2e.js（app/ 下，先 npm run build）
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { simulateReadableStream, type LanguageModel } from "ai";
import { tryGit } from "./services/gitexec";
import { SettingsStore } from "./services/settings";
import { PackageStore } from "./services/extensions/store";
import { AgentSessionManager } from "./services/agents/session";
import "./services/agents/builtinTools";
import type { AgentSessionEvent } from "./services/agents/types";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 脚本化模型（LanguageModelV3 形状）----

type Chunk = Record<string, unknown>;
const STREAM_START: Chunk = { type: "stream-start", warnings: [] };
const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const FIN_STOP: Chunk = { type: "finish", usage: USAGE, finishReason: { unified: "stop", raw: "stop" } };
const FIN_TOOL: Chunk = { type: "finish", usage: USAGE, finishReason: { unified: "tool-calls", raw: "tool-calls" } };

function textChunks(text: string): Chunk[] {
  return [STREAM_START, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: text }, { type: "text-end", id: "t1" }, FIN_STOP];
}
function toolChunks(name: string, input: unknown, callId = "call1"): Chunk[] {
  return [STREAM_START, { type: "tool-call", toolCallId: callId, toolName: name, input: JSON.stringify(input) }, FIN_TOOL];
}

interface CallCapture {
  prompts: string[];
  tools: string[];
}

function scriptedModel(script: Chunk[][], initialDelays: number[] = [], calls?: CallCapture): LanguageModel {
  let i = 0;
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "scripted",
    supportedUrls: async () => ({}),
    doStream: async (params: { prompt?: unknown; tools?: unknown }) => {
      if (calls) {
        calls.prompts.push(JSON.stringify((params as { prompt?: unknown }).prompt ?? null));
        calls.tools.push(JSON.stringify((params as { tools?: unknown }).tools ?? null));
      }
      const idx = Math.min(i, script.length - 1);
      const chunks = script[idx] ?? [STREAM_START, FIN_STOP];
      i++;
      return {
        stream: simulateReadableStream({ chunks: chunks as never, initialDelayInMs: initialDelays[idx] ?? 0, chunkDelayInMs: 2 }),
      } as never;
    },
  } as unknown as LanguageModel;
}

// ---- 场景环境（真 git 临时仓库 + 真 SettingsStore/SessionManager）----

interface Env {
  repo: string;
  tmp: string;
  agents: AgentSessionManager;
  events: { taskId: string; event: AgentSessionEvent }[];
  settings: SettingsStore;
  calls: CallCapture;
}

async function makeEnv(script: Chunk[][], opts?: { rules?: unknown[]; initialDelays?: number[] }): Promise<Env> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-e2e-"));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@local"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\nworld\n", "utf8");
  await tryGit(repo, ["add", "."]);
  await tryGit(repo, ["commit", "-m", "init"]);

  const settings = new SettingsStore(path.join(tmp, "cfg"));
  if (opts?.rules) settings.update({ agentRules: opts.rules as never });

  // §20.7 拔除测试语义：builtinRoots 指向真实内置包根——agent.builtin.presets/prompts 经真实包链路生效；
  // 若要验证空载内核，把 builtinRoots 置空即可（预设/段落消失，会话仍可跑通）。
  const builtinRoot = path.join(__dirname, "..", "resources", "packages");
  const store = new PackageStore([builtinRoot], [path.join(tmp, "pkgs")], "0.1.0", () => ({}) as never);
  const events: { taskId: string; event: AgentSessionEvent }[] = [];
  // 模型对象每个环境一份（生产语义：档案解析返回同一 LanguageModel，跨轮复用脚本指针）
  const calls: CallCapture = { prompts: [], tools: [] };
  const model = scriptedModel(script, opts?.initialDelays, calls);
  const agents = new AgentSessionManager({
    repoOf: () => repo,
    store,
    settings,
    resolveModel: () => ({ ok: true as const, model, profileRef: "mock/m1", contextWindow: 128_000 }),
    addUsage: () => {},
    send: (method, params) => {
      if (method === "agent.event") events.push(params as { taskId: string; event: AgentSessionEvent });
    },
  });
  return { repo, tmp, agents, events, settings, calls };
}

async function waitFor(label: string, fn: () => unknown | Promise<unknown>, timeoutMs = 20_000): Promise<unknown> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) {
      check(label, false, "超时");
      throw new Error(`timeout: ${label}`);
    }
    await sleep(100);
  }
}

function lastMessageContent(messages: import("ai").ModelMessage[], role: "tool" | "assistant"): string {
  const list = messages.filter((m) => m.role === role);
  const last = list[list.length - 1];
  if (!last) return "";
  const c = last.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (typeof p !== "object" || !p) return "";
        if ("text" in p) return String((p as { text?: string }).text ?? "");
        if ((p as { type?: string }).type === "tool-result") {
          const out = (p as { output?: unknown }).output;
          if (typeof out === "string") return out;
          if (typeof out === "object" && out && "value" in out) return String((out as { value?: unknown }).value ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

async function scenario(label: string, fn: () => Promise<void>) {
  console.log(`\n== ${label} ==`);
  try {
    await fn();
  } catch (e) {
    check(label, false, (e as Error).message);
  }
}

async function main() {
  console.log("== Agent v4 编排端到端 ==\n");

  // ---- E1 历史回写（P0）+ checkpoint + journal 落盘 ----
  await scenario("E1 历史回写", async () => {
    const env = await makeEnv([toolChunks("repo_read_file", { path: "a.txt" }), textChunks("读完 a.txt：hello world")]);
    const record = await env.agents.createTask({ prompt: "读一下 a.txt" });
    await waitFor("E1 turn end", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    const hist = env.agents.taskHistory({ taskId: record.taskId });
    // 轮末钩子（todo 防腐/cacheGuard）在 awaiting-input 之后异步注入 reminder → 角色断言过滤之（§22.6）
    const roles = hist.messages
      .filter((m) => !(m.role === "user" && JSON.stringify(m.content).includes("<system-reminder>")))
      .map((m) => m.role)
      .join(",");
    check("E1 消息序列 user→assistant→tool→assistant", roles === "user,assistant,tool,assistant", roles);
    check("E1 tool 结果含文件内容", lastMessageContent(hist.messages, "tool").includes("hello"));
    check("E1 assistant 终文持久", lastMessageContent(hist.messages, "assistant").includes("读完 a.txt"));
    // 只读轮工作区干净 → checkpoint 正确跳过（写轮的 checkpoint 断言见 E2）
    env.agents.dispose();
    await sleep(400); // 防抖保存窗口（250ms）
    const sfDisk = JSON.parse(
      fs.readFileSync(path.join(env.repo, ".git", "gitter", "agent-sessions", `${record.taskId}.json`), "utf8"),
    ) as { messages?: unknown[] };
    check(
      "E1 会话文件 messages 持久化（别名修复 §22.4）",
      Array.isArray(sfDisk.messages) && sfDisk.messages.length >= 4,
      `messages=${sfDisk.messages?.length}`,
    );
    check(
      "E1 会话文件+journal 落盘",
      fs.existsSync(path.join(env.repo, ".git", "gitter", "agent-sessions", `${record.taskId}.json`)) &&
        fs.existsSync(path.join(env.repo, ".git", "gitter", "agent-sessions", record.taskId, "journal-0.json")),
    );
  });

  // ---- E2 读 → patch 写链（写前读校验放行；改动落在任务 worktree）----
  await scenario("E2 读→patch 写链", async () => {
    const env = await makeEnv([
      toolChunks("repo_read_file", { path: "a.txt" }),
      toolChunks("file_patch", { path: "a.txt", edits: [{ oldString: "world", newString: "WORLD" }] }),
      textChunks("已把 world 改成 WORLD"),
    ]);
    const record = await env.agents.createTask({ prompt: "把 world 改成 WORLD" });
    await waitFor("E2 turn end", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    check("E2 worktree 文件已修改", fs.readFileSync(path.join(record.worktreePath, "a.txt"), "utf8").includes("WORLD"));
    // checkpoint 在状态切 awaiting-input 后异步落盘 → 轮询等待
    await waitFor("E2 checkpoint 落盘", async () => (await env.agents.taskCheckpoints({ taskId: record.taskId })).length === 1);
  });

  // ---- E3 前缀规则门（deny 命中 → 错误文本回模型，无授权卡）----
  await scenario("E3 前缀规则门", async () => {
    const env = await makeEnv([toolChunks("terminal_run", { command: "npm test" }), textChunks("已改用其他方式验证")], {
      rules: [{ id: "r1", tool: "terminal_run", pattern: "npm", effect: "deny", scope: "global", createdAt: "" }],
    });
    await env.agents.createTask({ prompt: "跑测试" });
    await waitFor("E3 turn end", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    const hist = env.agents.taskHistory({ taskId: env.agents.listTasks()[0]!.taskId });
    check("E3 规则拒绝文本回给模型", lastMessageContent(hist.messages, "tool").includes("被权限规则拒绝"));
    check("E3 无授权卡弹出", env.events.every((e) => e.event.type !== "permission"));
  });

  // ---- E4 ask_user 选项回传 ----
  await scenario("E4 ask_user", async () => {
    const env = await makeEnv([toolChunks("ask_user", { question: "用 A 还是 B？", options: ["A", "B"] }), textChunks("按 B 执行")]);
    await env.agents.createTask({ prompt: "问我选哪个" });
    const q = await waitFor("E4 question 事件", () => {
      const found = [...env.events].reverse().find((e) => e.event.type === "question");
      return found ?? undefined;
    }) as unknown as { event: Extract<AgentSessionEvent, { type: "question" }> };
    env.agents.replyPermission({ requestId: q.event.requestId, ok: true, answer: "B" });
    await waitFor("E4 turn end", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    const hist = env.agents.taskHistory({ taskId: env.agents.listTasks()[0]!.taskId });
    check("E4 回答进入工具结果", lastMessageContent(hist.messages, "tool").includes("用户回答：B"));
  });

  // ---- E5 plan 批准 → 自动续执行轮（default 工具面）----
  await scenario("E5 plan 流转", async () => {
    const env = await makeEnv([
      toolChunks("plan_submit", { plan: "# 计划\n## 步骤\n1. 写 out.txt（验证方式：文件存在）" }),
      textChunks("计划已提交，等待批准"),
      toolChunks("todo_write", { todos: [{ content: "写 out.txt", status: "in_progress" }] }),
      toolChunks("file_write", { path: "out.txt", content: "执行产物" }),
      textChunks("执行完成，todo 完成一条"),
    ]);
    const record = await env.agents.createTask({ prompt: "规划并执行", mode: "plan" });
    const plan = (await waitFor("E5 plan 事件", () => {
      const found = [...env.events].reverse().find((e) => e.event.type === "plan");
      return found ?? undefined;
    })) as unknown as { event: Extract<AgentSessionEvent, { type: "plan" }> };
    env.agents.replyPermission({ requestId: plan.event.requestId, ok: true });
    await waitFor("E5 执行轮结束", () => env.agents.listTasks()[0]?.state === "awaiting-input" && fs.existsSync(path.join(record.worktreePath, "out.txt")));
    const after = env.agents.listTasks()[0]!;
    check("E5 批准后模式切 default", after.permissionMode === "default");
    check("E5 planHistory 记录批准", (after.planHistory ?? []).length === 1 && after.planHistory![0].decision === "approved");
    check("E5 执行轮写出文件", fs.readFileSync(path.join(record.worktreePath, "out.txt"), "utf8") === "执行产物");
    check("E5 todo 持久", (after.todoState ?? []).length === 1);
    check("E5 规划轮只读工具面（未弹授权卡）", env.events.every((e) => e.event.type !== "permission"));
  });

  // ---- E6 子代理结果回传 ----
  await scenario("E6 子代理", async () => {
    const env = await makeEnv([
      toolChunks("task", { name: "调研", prompt: "找出 hello 所在位置", mode: "explore" }),
      textChunks("子结论：hello 在 a.txt 第 1 行"),
      textChunks("父总结：调研完成，hello 在 a.txt:1"),
    ]);
    await env.agents.createTask({ prompt: "派子代理调研 hello" });
    await waitFor("E6 turn end", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    const hist = env.agents.taskHistory({ taskId: env.agents.listTasks()[0]!.taskId });
    check("E6 子代理结论回传父", lastMessageContent(hist.messages, "tool").includes("子结论"));
    const subs = env.events.filter((e) => e.event.type === "subtask");
    const states = subs.map((s) => (s.event as { state?: string }).state ?? "?");
    check("E6 subtask running+completed 事件", subs.length === 2 && states[1] === "completed", states.join(","));
  });

  // ---- E7 排队投递（working 中补充 → 轮边界注入续轮）----
  await scenario("E7 排队投递", async () => {
    const env = await makeEnv([textChunks("轮一完成"), textChunks("轮二已处理补充：也看了 b.txt")], { initialDelays: [800, 0] });
    const record = await env.agents.createTask({ prompt: "开始任务" });
    await sleep(200);
    check("E7 运行中可排队", env.agents.listTasks()[0]?.state === "working" || env.agents.listTasks()[0]?.state === "starting");
    env.agents.queueTask({ taskId: record.taskId, prompt: "补充：也看看 b.txt" });
    await waitFor("E7 续轮结束", () => env.agents.listTasks()[0]?.state === "awaiting-input" && env.agents.listTasks()[0]?.lastMessage === "轮二已处理补充：也看了 b.txt");
    check("E7 队列清空", (env.agents.listTasks()[0]?.queued ?? []).length === 0);
    const hist = env.agents.taskHistory({ taskId: record.taskId });
    check("E7 排队消息注入历史", hist.messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("也看看 b.txt")));
  });

  // ---- E8 post-turn 钩子（§20.3.6：产物以 system-reminder 注入下一轮消息）----
  await scenario("E8 post-turn 钩子", async () => {
    const { registerTurnHook, unregisterTurnHooksByPackage } = await import("./services/agents/seams");
    registerTurnHook({
      id: "smoke.hook", order: 10, source: "package", packageId: "smoke",
      hook: (info) => `钩子看到 outcome=${info.outcome}，总结=${(info.lastMessage ?? "").slice(0, 20)}`,
    });
    const env = await makeEnv([textChunks("第一轮完成")]);
    const record = await env.agents.createTask({ prompt: "跑一轮" });
    // 钩子在状态切 awaiting-input 之后异步注入 → 直接轮询消息条件
    await waitFor("E8 钩子产物注入", () =>
      env.agents.taskHistory({ taskId: record.taskId }).messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("钩子看到 outcome=completed")),
    );
    check("E8 钩子产物注入消息历史", true);
    unregisterTurnHooksByPackage("smoke");
  });

  // ---- E9 图片输入（D1 §21.2.1：vision 门控 + 多段消息 + 附件落盘 + read-image 事件）----
  await scenario("E9 图片输入", async () => {
    const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const mkProfile = (vision: boolean) => ({
      id: "mock/m1", name: "m", kind: "openai-compatible" as const, baseURL: "http://x", modelId: "m",
      apiKeyProtected: null, capabilities: { tools: true, streaming: true, ...(vision ? { vision: true } : {}) }, tags: [],
    });
    const env = await makeEnv([textChunks("看到图了")]);
    env.settings.update({ models: [mkProfile(false)], defaultModelId: "mock/m1" } as never);
    const record = await env.agents.createTask({ prompt: "图片任务" });
    await waitFor("E9 首轮结束", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    await sleep(1500); // 首轮收尾（checkpoint/钩子/abort 清理）完成窗口
    let rejected = "";
    try {
      await env.agents.resumeTask({ taskId: record.taskId, prompt: "看图", attachments: [{ name: "a.png", dataBase64: PNG_1PX }] });
    } catch (e) { rejected = (e as Error).message; }
    check("E9 非 vision 拒绝", rejected.includes("vision"), "rejected=" + rejected.slice(0, 100));
    env.settings.update({ models: [mkProfile(true)], defaultModelId: "mock/m1" } as never);
    await env.agents.resumeTask({ taskId: record.taskId, prompt: "再看图", attachments: [{ name: "shot.png", dataBase64: PNG_1PX }] });
    await waitFor("E9 续轮结束", () => env.agents.listTasks()[0]?.lastMessage === "看到图了");
    const hist = env.agents.taskHistory({ taskId: record.taskId });
    const imgMsg = hist.messages.find((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((pt) => (pt as { type?: string }).type === "image"));
    check("E9 image part 进模型消息", !!imgMsg && JSON.stringify(imgMsg.content).includes("看图"));
    const onDisk = fs.existsSync(env.repo) && fs.existsSync(path.join(env.repo, ".git", "gitter", "agent-sessions", record.taskId, "attachments"));
    check("E9 附件落盘（主仓库 gitdir）", onDisk);
    check("E9 read-image 事件", env.events.some((e) => e.event.type === "file-change" && (e.event as { kind?: string }).kind === "read-image"));
  });

  // ---- E10 前缀缓存稳定性（§二十二：cacheGuard 尾部注入 + 提示词冻结 + 工具面确定性）----
  await scenario("E10 前缀缓存稳定性", async () => {
    const { cacheGuardReset } = await import("./services/agents/cacheGuard");
    cacheGuardReset();
    // 三轮：轮1建 sub/b.txt（顶层新增目录）、轮2建 c.txt（顶层新增文件）、轮3无改动 → 共 5 次模型调用
    const env = await makeEnv([
      toolChunks("file_write", { path: "sub/b.txt", content: "x" }),
      textChunks("第一轮完成：已创建 sub/b.txt"),
      toolChunks("file_write", { path: "c.txt", content: "y" }),
      textChunks("第二轮完成：已创建 c.txt"),
      textChunks("第三轮完成：无改动"),
    ]);
    const record = await env.agents.createTask({ prompt: "建 sub/b.txt" });
    await waitFor("E10 第一轮结束", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    await waitFor("E10 基线注入", () =>
      env.agents.taskHistory({ taskId: record.taskId }).messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("仓库状态基线")),
    );
    await env.agents.resumeTask({ taskId: record.taskId, prompt: "再建 c.txt" });
    await waitFor("E10 第二轮结束", () => env.agents.listTasks()[0]?.lastMessage === "第二轮完成：已创建 c.txt");
    await waitFor("E10 更新注入", () =>
      env.agents.taskHistory({ taskId: record.taskId }).messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("仓库状态更新")),
    );
    await env.agents.resumeTask({ taskId: record.taskId, prompt: "收尾" });
    await waitFor("E10 第三轮结束", () => env.agents.listTasks()[0]?.lastMessage === "第三轮完成：无改动");
    await sleep(300); // 轮末钩子注入窗口

    const prompts = env.calls.prompts;
    check("E10 共 5 次模型调用", prompts.length === 5, String(prompts.length));
    if (prompts.length === 5) {
      const sysOf = (i: number) => JSON.stringify((JSON.parse(prompts[i]) as { role: string }[]).filter((m) => m.role === "system"));
      check(
        "E10 系统提示词五次调用字节一致（冻结+无易变采集器）",
        sysOf(0) === sysOf(1) && sysOf(0) === sysOf(2) && sysOf(0) === sysOf(3) && sysOf(0) === sysOf(4),
      );
      const t0 = env.calls.tools[0];
      check("E10 工具面定义跨调用一致（确定性序列化）", env.calls.tools.every((t) => t === t0));
      // append-only 结构断言：第 3 次调用（轮2首请求）的 prompt 是第 5 次的前缀
      const p2 = JSON.parse(prompts[2]) as unknown[];
      const p4 = JSON.parse(prompts[4]) as unknown[];
      const prefixOk = p2.length <= p4.length && p2.every((m, i) => JSON.stringify(m) === JSON.stringify(p4[i]));
      check("E10 消息前缀包含（append-only）", prefixOk, `p2=${p2.length} p4=${p4.length}`);
      check("E10 基线提醒进入第二轮请求", prompts[2].includes("仓库状态基线"));
      check("E10 变更提醒（顶层新增 c.txt）进入第三轮请求", prompts[4].includes("仓库状态更新") && prompts[4].includes("c.txt"));
      check("E10 基线全程恰一次", (prompts[4].match(/仓库状态基线/g) ?? []).length === 1);
      check("E10 易变状态未进系统提示词", !sysOf(0).includes("仓库状态") && !sysOf(0).includes("顶层条目"));
    }
  });
  console.log(`\n${failures === 0 ? "全部通过 ✔" : `${failures} 项失败 ✘`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
