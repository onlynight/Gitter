/**
 * Agent 循环无头验收（agent-harness.md v3.0 A1/A2）：
 * 本地假 OpenAI 兼容 SSE 服务器脚本化"工具调用 → 最终答复"，端到端穿
 * @ai-sdk/openai-compatible → runLoop → buildToolset（含路径越界/授权门/file_patch）。
 * 运行：npm run build && node dist/smoke-agent-loop.js
 */
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveProfileModel } from "./services/agents/provider";
import { runLoop } from "./services/agents/loop";
import { buildToolset, resolveSafe } from "./services/agents/tools";
import { composeSystemPrompt, collectRepoContext } from "./services/agents/prompts";
import { deriveSlug, dedupeSlug } from "./services/agents/session";
import { tryGit } from "./services/gitexec";
import type { AgentSessionEvent } from "./services/agents/types";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

/** 假 OpenAI 兼容 chat completions：第 1 次请求回 tool_call(repo_status)，之后回最终文本。 */
function fakeServer(): Promise<{ port: number; close: () => void; calls: () => number; lastBody: () => string }> {
  let calls = 0;
  let lastBody = "";
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      calls++;
      lastBody = body;
      const sawToolResult = body.includes('"role":"tool"');
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const sse = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const chunk = (delta: Record<string, unknown>, finish: string | null, usage?: unknown) =>
        sse({ id: "c1", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });
      if (!sawToolResult) {
        chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "repo_status", arguments: "{}" } }] }, null);
        chunk({}, "tool_calls");
      } else {
        chunk({ role: "assistant", content: "分析完成" }, null);
        chunk({}, "stop", { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ port: addr.port, close: () => server.close(), calls: () => calls, lastBody: () => lastBody });
    });
  });
}

async function main() {
  // ---- 临时仓库 ----
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-loop-smoke-"));
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@test"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  await tryGit(repo, ["add", "-A"]);
  await tryGit(repo, ["commit", "-m", "init"]);

  // ---- 假服务器 + provider ----
  const server = await fakeServer();
  // 经 provider.resolveProfileModel 构建（含思考深度硬通道注入），而非裸 createOpenAICompatible
  const rr = resolveProfileModel({ kind: "openai-compatible", baseURL: `http://127.0.0.1:${server.port}/v1`, modelId: "fake-model", apiKey: "smoke", thinking: "high" });
  check("模型解析: 档案可用", rr.ok);
  const model = rr.ok ? rr.model : undefined as never;

  // ---- 事件收集 + 工具集 ----
  const events: AgentSessionEvent[] = [];
  const requestedPerms: string[] = [];
  const tools = buildToolset({
    worktreePath: repo,
    taskId: "t-smoke",
    requestPermission: async (toolName) => {
      requestedPerms.push(toolName);
      return toolName !== "git_push"; // push 模拟被拒
    },
    onFileChange: (p, kind) => events.push({ type: "file-change", path: p, kind }),
  });

  const ctx = await collectRepoContext(repo);
  check("上下文: 分支/状态采集", ctx.branch !== null && ctx.statusSummary.length > 0);
  const sys = composeSystemPrompt(ctx, repo);
  check("系统提示词: 边界+上下文", sys.includes(repo) && sys.includes("git 写操作（stage/commit/push）与命令执行需要人类"));

  // ---- 对话式派活：slug 派生与去重（agent-harness.md v3.0 任务流）----
  check("slug: ASCII 标题派生", deriveSlug("Fix LogFilter parsing crash") === "Fix-LogFilter-parsing-crash");
  check("slug: 截断 30", deriveSlug("a".repeat(50)) === "a".repeat(30));
  check("slug: 纯中文回退时间戳", /^task-\d{4}-\d{4}$/.test(deriveSlug("修复解析崩溃", new Date(2026, 9, 5, 9, 14))));
  check("slug: 去重追加 -2", dedupeSlug("fix", new Set(["task/fix", "task/other"])) === "fix-2");
  check("slug: 无冲突原样", dedupeSlug("fix", new Set(["task/other"])) === "fix");

  // ---- A1：循环端到端（只读工具 + 流式文本）----
  const result = await runLoop({
    thinking: "high",
    model,
    system: sys,
    messages: [{ role: "user", content: "分析这个仓库的状态" }],
    tools,
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });
  check("循环: outcome completed", result.outcome === "completed", result.error);
  check("循环: lastMessage 透传", result.lastMessage === "分析完成");
  check("循环: 用量归一", result.usage !== null && (result.usage.input ?? 0) >= 12);
  const toolCallEv = events.find((e) => e.type === "status" && e.summary?.includes("repo_status"));
  const toolDoneEv = events.find((e) => e.type === "log" && e.text.includes("repo_status 完成"));
  const textEv = events.find((e) => e.type === "output" && e.text.includes("分析完成"));
  const turnEv = events.find((e) => e.type === "turn-completed");
  check("循环: 工具调用可视化为 status", !!toolCallEv);
  check("循环: 工具结果回灌 log", !!toolDoneEv);
  check("循环: 流式文本事件", !!textEv);
  check("循环: turn-completed 事件", !!turnEv);
  check("循环: 工具真实执行（repo_status 读了仓库）", server.calls() === 2);
  const reqBody = server.lastBody();
  check("思考深度: reasoning_effort 硬通道", reqBody.includes('"reasoning_effort":"high"'));
  check("思考深度: 系统提示词软通道", reqBody.includes("思考深度：高"));

  // ---- A2：写工具 ----
  const exec = (name: string, input: unknown) =>
    (tools as unknown as Record<string, { execute: (input: unknown, o: unknown) => Promise<unknown> }>)[name]
      .execute(input, { toolCallId: "t", messages: [] }) as Promise<string>;

  const w = await exec("file_write", { path: "src/new.ts", content: "export const x = 1;\n" });
  check("file_write: 落盘", w.includes("已写入") && fs.readFileSync(path.join(repo, "src", "new.ts"), "utf8").includes("export const x"));
  check("file_write: file-change 事件", events.some((e) => e.type === "file-change" && e.path === "src/new.ts" && e.kind === "added"));

  const outside = path.join(os.tmpdir(), "outside.txt");
  try {
    await exec("file_write", { path: outside, content: "x" });
    check("路径越界: 拒绝", false);
  } catch (e) {
    check("路径越界: 拒绝", String((e as Error).message).includes("越出 worktree 边界"));
  }
  check("路径越界: 未落盘", !fs.existsSync(outside));

  await exec("file_write", { path: "dup.txt", content: "AAA" });
  const dup = await exec("file_patch", { path: "dup.txt", oldString: "AAA", newString: "BBB" });
  check("file_patch: 唯一替换", dup.includes("已编辑") && fs.readFileSync(path.join(repo, "dup.txt"), "utf8") === "BBB");
  const missing = await exec("file_patch", { path: "dup.txt", oldString: "CCC", newString: "D" });
  check("file_patch: 旧串缺失→错误文本", missing.startsWith("错误："));

  // ---- 授权门：session 类可批可拒 ----
  fs.writeFileSync(path.join(repo, "b.txt"), "x\n");
  const stageOk = await exec("git_stage", { paths: ["b.txt"] });
  check("授权门: 批准后执行", stageOk.includes("已暂存"));
  const pushDenied = await exec("git_push", {});
  check("授权门: each-time 被拒→文本回给模型", pushDenied.includes("用户拒绝"));
  check("授权门: 授权请求被记录", requestedPerms.includes("git_push"));

  // ---- resolveSafe 直测 ----
  try {
    resolveSafe(repo, path.join(repo, "..", "escape.txt"));
    check("resolveSafe: 相对越界拒绝", false);
  } catch {
    check("resolveSafe: 相对越界拒绝", true);
  }

  server.close();
  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
