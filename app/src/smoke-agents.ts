/**
 * Agent 宿主无头烟雾（agent-harness-codex.md v2.0 P1 + C1 验收）：
 * 不起窗口，直接驱动 PackageStore(harness kind) / events 求值器 / catalog 编译+探测 /
 * checkpoint / 任务账本 / cli-json 传输端到端（node 伪装 codex 发 JSONL）。
 * 运行：npm run build && node dist/smoke-agents.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PackageStore } from "./services/extensions/store";
import type { Manifest } from "./services/extensions/schema";
import { compileHarness } from "./services/agents/catalog";
import { detectHarness } from "./services/agents/catalog";
import { compileWhen, compileEventMap, mapFrame } from "./services/agents/events";
import { commitCheckpoint, headSha } from "./services/agents/checkpoint";
import { loadAgentTasks, saveAgentTasks, markInterrupted, upsertTask, findTask } from "./services/agents/tasks";
import { composeTaskPrompt, composeFeedbackPrompt } from "./services/agents/prompts";
import { launchCliJson } from "./services/agents/transports/clijson";
import { tryGit } from "./services/gitexec";
import type { AgentSessionEvent } from "./services/agents/types";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-agent-smoke-"));

// ---- 固件：codex 采样帧（exec --json 线程事件形状，字段以实测为准的映射快照）----
const CODEX_FRAMES: unknown[] = [
  { type: "thread.started", thread_id: "th_123" },
  { type: "turn.started" },
  { type: "item.started", item: { item_type: "command_execution", command: "dotnet test" } },
  { type: "item.completed", item: { item_type: "file_change", changes: [{ path: "src/a.ts", kind: "add" }, { path: "src/b.ts", kind: "delete" }] } },
  { type: "item.completed", item: { item_type: "agent_message", text: "已完成修复" } },
  { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 50 } },
  { type: "unknown.future.frame", data: 1 },
  { type: "thread.completed" },
];

const HARNESS_MANIFEST = (node: string): Manifest => ({
  schemaVersion: 2,
  id: "com.openai.codex",
  name: "OpenAI Codex CLI",
  version: "0.2.0",
  description: "smoke fixture",
  engines: { gitter: ">=0.1.0" },
  entry: null,
  entrySandbox: null,
  permissions: [],
  apiVersion: null,
    contributes: {
    themes: [],
    grammars: [],
    commands: [],
    configuration: [],
    menus: [],
    keybindings: [],
    terminalProfiles: [],
    safetyRules: [],
    skills: [],
    mcpServers: [],
    emptyHints: [],
    pages: [],
    models: [],
    taskTypes: [],
    harnesses: [
      {
        id: "codex",
        transport: "cli-json",
        fallback: "cli-pty",
        detect: { command: node, args: ["-e", "console.log('codex-cli 0.2.0')"], versionPattern: "codex-cli\\s+\\d+\\.\\d+" },
        spawn: {
          command: node,
          args: [
            "-e",
            [
              `const lines=[`,
              `JSON.stringify({type:'thread.started',thread_id:'th_123'}),`,
              `JSON.stringify({type:'item.started',item:{item_type:'command_execution',command:'dotnet test'}}),`,
              `JSON.stringify({type:'item.completed',item:{item_type:'file_change',changes:[{path:'src/a.ts',kind:'add'},{path:'src/b.ts',kind:'delete'}]}}),`,
              `JSON.stringify({type:'item.completed',item:{item_type:'agent_message',text:'已完成修复'}}),`,
              `JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:50}}),`,
              `JSON.stringify({type:'thread.completed'})`,
              `];for(const l of lines)console.log(l);`,
            ].join(""),
          ],
          promptStdin: true,
          env: { GITUI_HARNESS: "com.openai.codex" },
        },
        resume: { args: ["-e", "console.log(JSON.stringify({type:'thread.started',thread_id:'th_123'}))"], promptStdin: true },
        stop: { mode: "kill" },
        capabilities: ["structured-events", "file-watch", "feedback-channel", "resume", "prompt-submission"],
        submissionMode: "next-turn",
        hostServices: ["host-checkpoints"],
        identity: { assistedBy: "codex" },
        permissions: { gitWrite: ["repo.stage", "repo.commit"], outsideWorktree: false, network: "model-endpoint" },
        promptTemplates: { preamble: "【宿主约定】只在 worktree 内工作。", feedback: "审查反馈：{feedback}" },
        events: {
          lineFormat: "jsonl",
          externalId: "$.thread_id",
          unmatched: "log",
          rules: [
            { when: "$.type == 'thread.started'", emit: { kind: "session-meta", externalId: "$.thread_id" } },
            { when: "$.type == 'turn.started'", emit: { kind: "status", "phase": "thinking" } },
            { when: "$.type == 'item.started' && $.item.item_type == 'command_execution'", emit: { kind: "status", phase: "running-command", summary: "$.item.command" } },
            { when: "$.type == 'item.completed' && $.item.item_type == 'agent_message'", emit: { kind: "output", stream: "assistant", text: "$.item.text", capture: "lastMessage" } },
            { when: "$.type == 'item.completed' && $.item.item_type == 'file_change'", emit: { kind: "file-change", from: "$.item.changes[*]", path: "$.path", changeKind: "$.kind" } },
            { when: "$.type == 'turn.completed'", emit: { kind: "turn-completed", usageIn: "$.usage.input_tokens", usageOut: "$.usage.output_tokens" } },
            { when: "$.type == 'thread.completed'", emit: { kind: "completed" } },
          ],
        },
      },
    ],
  },
});

async function main() {
  // ---- 1. PackageStore：harness kind 推导与按 kind 启停 ----
  const builtinRoot = path.join(tmp, "builtin");
  const pkgDir = path.join(builtinRoot, "com.openai.codex");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "manifest.json"), JSON.stringify(HARNESS_MANIFEST(process.execPath), null, 2));
  const ledger: Record<string, { enabled?: boolean; kinds?: Record<string, boolean>; config?: Record<string, unknown> }> = {};
  const store = new PackageStore([builtinRoot], [], "0.1.0", () => ledger);
  const listed = store.list();
  check("store: harness kind 由 contributes 推导", listed.length === 1 && listed[0].kinds.includes("harness"), JSON.stringify(listed[0]?.kinds));
  check("store: kind 启停账本", store.kindEnabled("com.openai.codex", "harness") === true);
  ledger["com.openai.codex"] = { kinds: { harness: false } };
  check("store: 按 kind 禁用", store.kindEnabled("com.openai.codex", "harness") === false);
  ledger["com.openai.codex"] = { config: { "agents.codex.sandbox": "read-only" } };
  check("store: 包配置读取（sandbox）", store.configOf("com.openai.codex")["agents.codex.sandbox"] === "read-only");

  // ---- 2. events：when 表达式黄金用例 ----
  const frame = CODEX_FRAMES[2];
  check("when: 相等+路径", compileWhen("$.type == 'item.started'")(frame) === true);
  check("when: 不等", compileWhen("$.type != 'turn.started'")(frame) === true);
  check("when: &&", compileWhen("$.type == 'item.started' && $.item.item_type == 'command_execution'")(frame) === true);
  check("when: && 短路不匹配", compileWhen("$.type == 'item.started' && $.item.item_type == 'file_change'")(frame) === false);
  check("when: ||", compileWhen("$.type == 'x' || $.item.item_type == 'command_execution'")(frame) === true);
  check("when: 括号", compileWhen("($.type == 'x' || $.type == 'item.started') && $.item.item_type != 'y'")(frame) === true);
  check("when: 缺失路径 != 字面量", compileWhen("$.item.missing != 'z'")(frame) === true);
  check("when: 非法表达式抛错", (() => { try { compileWhen("$.type =="); return false; } catch { return true; } })());

  // ---- 3. events：codex 采样帧映射快照 ----
  const manifestHarness = HARNESS_MANIFEST(process.execPath).contributes.harnesses[0];
  const cm = compileEventMap(manifestHarness.events);
  check("events: 映射编译非空", cm !== null);
  const all: AgentSessionEvent[] = [];
  let externalId: string | null = null;
  let lastMessage: string | null = null;
  let turnCompleted = false;
  let completed: string | null = null;
  let unmatchedLogged = false;
  for (const f of CODEX_FRAMES) {
    const r = mapFrame(cm!, f);
    all.push(...r.events);
    if (r.externalId) externalId = r.externalId;
    if (r.lastMessage) lastMessage = r.lastMessage;
    if (r.turnCompleted) turnCompleted = true;
    if (r.completed) completed = r.completed;
    if (r.events.some((e) => e.type === "log" && e.text.startsWith("unmatched:"))) unmatchedLogged = true;
  }
  check("events: session-meta 捕获 thread id", externalId === "th_123");
  check("events: status(running-command) 带命令摘要", all.some((e) => e.type === "status" && e.phase === "running-command" && e.summary === "dotnet test"));
  check("events: file_change 数组展开 ×2（add/delete 归一）", all.filter((e) => e.type === "file-change").length === 2
    && all.some((e) => e.type === "file-change" && e.path === "src/a.ts" && e.kind === "added")
    && all.some((e) => e.type === "file-change" && e.path === "src/b.ts" && e.kind === "deleted"));
  check("events: lastMessage 捕获", lastMessage === "已完成修复");
  check("events: turn.completed 用量", turnCompleted && all.some((e) => e.type === "turn-completed" && e.usage?.input === 100 && e.usage?.output === 50));
  check("events: 未知帧 unmatched→log", unmatchedLogged);
  check("events: 终态 completed", completed === "completed");

  // ---- 4. catalog：LaunchSpec 编译（合法/占位符错误/when 错误）----
  const okCompile = compileHarness("com.openai.codex", "OpenAI Codex CLI", manifestHarness);
  check("catalog: 合法编译", okCompile.spec !== null && okCompile.spec.fullId === "com.openai.codex/codex");
  check("catalog: 事件映射已编译", okCompile.spec?.eventMap !== null);
  const badPh = JSON.parse(JSON.stringify(manifestHarness));
  badPh.spawn.args = ["--cd", "{worktree}", "--bogus", "{whoami}"];
  check("catalog: 未知占位符拒编译", compileHarness("p", "p", badPh).error !== null);
  const badWhen = JSON.parse(JSON.stringify(manifestHarness));
  badWhen.events.rules[0].when = "$.type ==";
  check("catalog: when 错误拒编译", compileHarness("p", "p", badWhen).error !== null);

  // ---- 5. detect：命令探测 + versionPattern 门 ----
  const det = await detectHarness(manifestHarness, "com.openai.codex/codex");
  check("detect: versionPattern 匹配", det.available === true && (det.version ?? "").startsWith("codex-cli 0.2"));
  const badManifest = JSON.parse(JSON.stringify(manifestHarness));
  badManifest.detect.versionPattern = "codex-cli\\s+9\\.";
  const detBad = await detectHarness(badManifest, "com.openai.codex/codex-bad");
  check("detect: 版本不匹配置灰", detBad.available === false && detBad.reason !== null);

  // ---- 6. checkpoint：trailer 代打 + 干净跳过 ----
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@test"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
  await tryGit(repo, ["add", "-A"]);
  await tryGit(repo, ["commit", "-m", "init"]);
  const baseline = await headSha(repo);
  check("checkpoint: 基线 HEAD", !!baseline);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello world\n");
  const cp = await commitCheckpoint(repo, { summary: "修复解析崩溃", assistedBy: "codex", sessionId: "t-1" });
  check("checkpoint: 代打提交", !!cp.sha && !cp.skipped);
  const msg = (await tryGit(repo, ["log", "-1", "--format=%B"])).stdout;
  check("checkpoint: trailer 齐全", msg.includes("checkpoint: 修复解析崩溃") && msg.includes("Assisted-by: codex") && msg.includes("Gitter-Session: t-1"));
  const cp2 = await commitCheckpoint(repo, { summary: "空", assistedBy: "codex", sessionId: "t-1" });
  check("checkpoint: 干净工作区跳过", cp2.skipped === true && cp2.sha === null);

  // ---- 7. 任务账本：往返 + interrupted 标记 ----
  const taskFile = { version: 1 as const, tasks: [] as never[] };
  const rec = {
    taskId: "t-1", title: "修复", harnessFullId: "com.openai.codex/codex", worktreePath: repo, branch: "task/x",
    externalSessionId: null, baselineSha: baseline ?? "", state: "working" as const, exitCode: null,
    createdAt: new Date().toISOString(), lastActiveAt: null, lastMessage: null,
  };
  upsertTask(taskFile, rec as never);
  saveAgentTasks(repo, taskFile);
  const loaded = loadAgentTasks(repo);
  check("账本: 往返", loaded.tasks.length === 1 && findTask(loaded, "t-1")?.title === "修复");
  markInterrupted(loaded, new Set());
  check("账本: 非终态标 interrupted", loaded.tasks[0].state === "interrupted");
  markInterrupted(loaded, new Set(["t-1"]));

  // ---- 8. prompts：模板组装 ----
  const fakeSpec = okCompile.spec!;
  check("prompts: preamble 前置", composeTaskPrompt(fakeSpec, "修复 X").startsWith("【宿主约定】只在 worktree 内工作。"));
  check("prompts: 反馈模板注入", composeFeedbackPrompt(fakeSpec, "不要动 Y").includes("审查反馈：不要动 Y"));

  // ---- 9. cli-json 端到端：node 伪装 codex 发 JSONL ----
  const endToEnd = await new Promise<{ events: AgentSessionEvent[]; exit: number | null; externalId: string | null; lastMessage: string | null }>((resolve) => {
    const events: AgentSessionEvent[] = [];
    let externalId: string | null = null;
    let lastMessage: string | null = null;
    const proc = launchCliJson(
      {
        spec: fakeSpec,
        worktreePath: repo,
        taskId: "t-e2e",
        prompt: "修复 X",
        sandbox: "read-only",
        externalSessionId: null,
        envDenylist: [],
      },
      {
        onFrameResult: (r) => {
          if (r.externalId) externalId = r.externalId;
          if (r.lastMessage) lastMessage = r.lastMessage;
        },
        onEvent: (ev) => events.push(ev),
        onExit: (code) => {
          // 退出后微等，确保事件流已冲刷
          setTimeout(() => resolve({ events, exit: code, externalId, lastMessage }), 30);
        },
      },
    );
    check("cli-json: 进程已启动", proc.pid !== undefined);
  });
  check("cli-json: 端到端 session-meta", endToEnd.externalId === "th_123");
  check("cli-json: 端到端事件序列完整",
    endToEnd.events.some((e) => e.type === "status" && e.phase === "running-command")
    && endToEnd.events.filter((e) => e.type === "file-change").length === 2
    && endToEnd.events.some((e) => e.type === "turn-completed")
    && endToEnd.events.some((e) => e.type === "completed" && e.outcome === "completed"));
  check("cli-json: lastMessage 透传", endToEnd.lastMessage === "已完成修复");
  check("cli-json: 退出码 0", endToEnd.exit === 0);

  // ---- 收尾 ----
  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
