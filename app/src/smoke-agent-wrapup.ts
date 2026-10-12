/**
 * 任务收尾闭环 + 列表管理 无头烟雾（task-page-wrapup-and-list-design.md §七 验收）：
 * merge.ts 纯 git 层（ahead/behind / 冲突预检 / diffstat）/ squashMerge + no-ff + trailer /
 * 编排层 mergeCheck（NO_WORKTREE、ahead=0 拒绝）/ mergeTask squash+清理（wrapup、归档、worktree/分支删除、
 * Log 页 trailer）/ rename / delete cleanup / awaitKind 生命周期（question/plan → 回复清空）。
 * 运行：node dist/smoke-agent-wrapup.js（app/ 下，先 npm run build）
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { simulateReadableStream, type LanguageModel } from "ai";
import { tryGit } from "./services/gitexec";
import { mergeBranch, squashMerge } from "./services/gitbranches";
import { aheadBehind, collectMergeInfo, currentBranch, detectConflicts, diffStat, isDirty } from "./services/agents/merge";
import { createTaskWorktree } from "./services/worktrees";
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

// ---- 脚本化模型（同 smoke-agent-e2e）----

type Chunk = Record<string, unknown>;
const STREAM_START: Chunk = { type: "stream-start", warnings: [] };
const USAGE = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const FIN_STOP: Chunk = { type: "finish", usage: USAGE, finishReason: { unified: "stop", raw: "stop" } };
const FIN_TOOL: Chunk = { type: "finish", usage: USAGE, finishReason: { unified: "tool-calls", raw: "tool-calls" } };

function textChunks(text: string): Chunk[] {
  return [STREAM_START, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: text }, { type: "text-end", id: "t1" }, FIN_STOP];
}
function toolChunks(name: string, input: unknown, callId = "call1"): Chunk[] {
  return [STREAM_START, { type: "tool-call", toolCallId: callId, toolName: name, input: JSON.stringify(input) }, FIN_TOOL];
}

function scriptedModel(script: (Chunk[] | null)[]): LanguageModel {
  let i = 0;
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "scripted",
    supportedUrls: async () => ({}),
    doStream: async () => {
      const chunks = script[Math.min(i++, script.length - 1)] ?? textChunks("（脚本耗尽）");
      return { stream: simulateReadableStream({ chunks, initialDelayInMs: 50, chunkDelayInMs: 10 }) } as never;
    },
  } as never;
}

// ---- 编排环境（真实 AgentSessionManager + 真实 git 临时仓库）----

interface Env {
  repo: string;
  tmp: string;
  agents: AgentSessionManager;
  events: { taskId: string; event: AgentSessionEvent }[];
  settings: SettingsStore;
}

async function makeEnv(script: (Chunk[] | null)[]): Promise<Env> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-wrapup-"));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@local"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\nworld\n", "utf8");
  await tryGit(repo, ["add", "."]);
  await tryGit(repo, ["commit", "-m", "init"]);

  const settings = new SettingsStore(path.join(tmp, "cfg"));
  const builtinRoot = path.join(__dirname, "..", "resources", "packages");
  const store = new PackageStore([builtinRoot], [path.join(tmp, "pkgs")], "0.1.0", () => ({}) as never);
  const events: { taskId: string; event: AgentSessionEvent }[] = [];
  const model = scriptedModel(script);
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
  return { repo, tmp, agents, events, settings };
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

async function scenario(label: string, fn: () => Promise<void>) {
  console.log(`\n== ${label} ==`);
  try {
    await fn();
  } catch (e) {
    check(label, false, (e as Error).message);
  }
}

/** 纯 git 层测试仓库：基线（默认分支）+ task/* worktree，可注入 base 前进与任务改动。 */
async function makeGitRepo(): Promise<{ repo: string; tmp: string; base: string; wt: string; branch: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-gitm-"));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@local"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  // 4 行内容：任务改第 2 行、基线改第 4 行——中间留无改动行，避免相邻行 hunk 天然冲突（diff3 语义）
  fs.writeFileSync(path.join(repo, "a.txt"), "l1\nl2\nl3\nl4\n", "utf8");
  await tryGit(repo, ["add", "."]);
  await tryGit(repo, ["commit", "-m", "init"]);
  const base = (await currentBranch(repo)) ?? "master";
  const wt = await createTaskWorktree(repo, "smoke");
  return { repo, tmp, base, wt: wt.path, branch: wt.branch };
}

async function main() {
  console.log("== 任务收尾闭环 无头烟雾 ==\n");

  // ---- M1 merge.ts 纯 git 层：ahead/behind、冲突预检（干净/冲突）、diffstat ----
  await scenario("M1 merge 预检纯 git 层", async () => {
    const g = await makeGitRepo();
    // 任务侧两个提交（改第 2 行 + 新增文件）；基线前进改第 4 行——不同 hunk，可自动合并
    fs.writeFileSync(path.join(g.wt, "a.txt"), "l1\nTASK\nl3\nl4\n", "utf8");
    await tryGit(g.wt, ["add", "."]);
    await tryGit(g.wt, ["commit", "-m", "task change 1"]);
    fs.writeFileSync(path.join(g.wt, "b.txt"), "task file\n", "utf8");
    await tryGit(g.wt, ["add", "."]);
    await tryGit(g.wt, ["commit", "-m", "task change 2"]);
    fs.writeFileSync(path.join(g.repo, "a.txt"), "l1\nl2\nl3\nBASE\n", "utf8");
    await tryGit(g.repo, ["add", "."]);
    await tryGit(g.repo, ["commit", "-m", "base forward"]);

    const ab = await aheadBehind(g.repo, g.base, g.branch);
    check("M1 ahead/behind 计数", ab.ahead === 2 && ab.behind === 1, `ahead=${ab.ahead} behind=${ab.behind}`);
    check("M1 干净合并冲突为空", JSON.stringify(await detectConflicts(g.repo, g.base, g.branch)) === JSON.stringify({ available: true, conflicts: [] }));
    const stat = await diffStat(g.repo, g.base, g.branch);
    check("M1 diffstat 含两个文件", stat.includes("a.txt") && stat.includes("b.txt"), stat.split("\n")[0] ?? "");

    // 冲突：基线改与任务同一行（第 2 行）
    fs.writeFileSync(path.join(g.repo, "a.txt"), "l1\nBASE-TOO\nl3\nl4\n", "utf8");
    await tryGit(g.repo, ["add", "."]);
    await tryGit(g.repo, ["commit", "-m", "base conflict"]);
    const c = await detectConflicts(g.repo, g.base, g.branch);
    check("M1 冲突预检命中 a.txt（剔除提示行）", c.available && Array.isArray(c.conflicts) && c.conflicts.length === 1 && c.conflicts[0] === "a.txt", JSON.stringify(c));
    check("M1 collectMergeInfo 汇总", (await collectMergeInfo(g.repo, g.wt, g.branch, null)).behind >= 2);
    check("M1 isDirty 探测", (await isDirty(g.wt)) === false);
    fs.writeFileSync(path.join(g.wt, "dirty.txt"), "x", "utf8");
    check("M1 isDirty 探测（脏）", (await isDirty(g.wt)) === true);
  });

  // ---- M2 squashMerge + no-ff（消息 trailer 落实到提交）----
  await scenario("M2 squash 与 no-ff 合并", async () => {
    const g = await makeGitRepo();
    fs.writeFileSync(path.join(g.wt, "b.txt"), "x\n", "utf8");
    await tryGit(g.wt, ["add", "."]);
    await tryGit(g.wt, ["commit", "-m", "task c1"]);
    const msg = "任务标题\n\nAssisted-by: gitter-agent\nGitter-Session: tid-1234";
    await squashMerge(g.repo, g.branch, msg, g.base);
    const body = (await tryGit(g.repo, ["log", "-1", "--format=%B"])).stdout;
    check("M2 squash 单提交消息含 trailer", body.includes("Assisted-by: gitter-agent") && body.includes("Gitter-Session: tid-1234"), body.split("\n")[0]);
    // squash 不移动任务分支——断言合入内容落在基线（分支清理发生在编排层 deleteTask/mergeTask）
    check("M2 squash 内容已落基线", fs.readFileSync(path.join(g.repo, "b.txt"), "utf8").trim() === "x");

    // no-ff：merge 节点
    const g2 = await makeGitRepo();
    fs.writeFileSync(path.join(g2.wt, "c.txt"), "y\n", "utf8");
    await tryGit(g2.wt, ["add", "."]);
    await tryGit(g2.wt, ["commit", "-m", "task c2"]);
    await mergeBranch(g2.repo, g2.branch, true, "merge: 标题\n\nGitter-Session: tid-5678", g2.base);
    const merges = (await tryGit(g2.repo, ["rev-list", "--count", "--merges", "HEAD"])).stdout.trim();
    check("M2 no-ff 产生 merge 节点", merges === "1", `merges=${merges}`);
    const body2 = (await tryGit(g2.repo, ["log", "-1", "--format=%B"])).stdout;
    check("M2 no-ff 消息含 trailer", body2.includes("Gitter-Session: tid-5678"));
  });

  // ---- M3 编排层 mergeCheck：主 worktree 拒绝 + ahead=0 拒绝 + 正常预检；M4 mergeTask 清理 ----
  await scenario("M3/M4 mergeCheck 与 mergeTask", async () => {
    const env = await makeEnv([textChunks("完成"), toolChunks("file_write", { path: "out.txt", content: "任务产出" }), textChunks("已写 out.txt")]);
    // 当前分支模式（主 worktree）→ NO_WORKTREE
    const mainTask = await env.agents.createTask({ prompt: "主 worktree 任务" });
    await waitFor("M3 主 worktree 轮结束", () => env.agents.listTasks()[0]?.state === "awaiting-input");
    const mcMain = await env.agents.mergeCheck({ taskId: mainTask.taskId });
    check("M3 主 worktree 返回 NO_WORKTREE", !mcMain.ok && mcMain.reason === "NO_WORKTREE", mcMain.reason);

    // worktree 模式：脚本写 out.txt（真实产出 → 轮末自动 checkpoint）
    env.settings.update({ agentsTaskWorktree: true });
    const task = await env.agents.createTask({ prompt: "写 out.txt 的任务" });
    await waitFor("M3 worktree 轮结束", () => env.agents.listTasks({ includeArchived: true })[0]?.state === "awaiting-input");
    // 轮末 checkpoint/abort 置空在状态切换后异步收尾——留出窗口再碰合并面（isRunning 竞态）
    await waitFor("M3 checkpoint 落账", async () => (await env.agents.taskCheckpoints({ taskId: task.taskId })).length >= 1);
    await sleep(600);
    check("M3 worktree 任务 baseBranch 已记录", !!task.baseBranch, task.baseBranch ?? "null");
    check("M3 产出文件在 worktree", fs.readFileSync(path.join(task.worktreePath, "out.txt"), "utf8") === "任务产出");

    let mc0 = await env.agents.mergeCheck({ taskId: task.taskId });
    check("M3 预检 ahead=1 且无冲突", mc0.ok && mc0.ahead === 1 && (mc0.conflicts ?? []).length === 0, JSON.stringify({ ahead: mc0.ahead, c: mc0.conflicts }));
    check("M3 预检目标分支 = 记录的 baseBranch", mc0.baseBranch === task.baseBranch, `${mc0.baseBranch} vs ${task.baseBranch}`);

    // ---- M4 mergeTask：squash + 清理 + 账本 wrapup + 归档 ----
    const r = await env.agents.mergeTask({ taskId: task.taskId, strategy: "squash", cleanup: true });
    check("M4 合并成功且产 sha", r.ok && !!r.mergeSha, r.mergeSha?.slice(0, 8));
    check("M4 worktree 与分支已清理", r.cleanup?.worktreeRemoved === true && r.cleanup?.branchDeleted === true, JSON.stringify(r.cleanup));
    check("M4 worktree 目录已删除", !fs.existsSync(task.worktreePath));
    const branches = (await tryGit(env.repo, ["branch", "--list", "task/*"])).stdout.trim();
    check("M4 task/* 分支已删", branches === "", branches);
    const body = (await tryGit(env.repo, ["log", "-1", "--format=%B"])).stdout;
    check("M4 合并提交含 Gitter-Session trailer（Log 页归组）", body.includes(`Gitter-Session: ${task.taskId}`));
    check("M4 合并内容落在基线", fs.readFileSync(path.join(env.repo, "out.txt"), "utf8") === "任务产出");
    const after = env.agents.listTasks({ includeArchived: true }).find((x) => x.taskId === task.taskId);
    check("M4 账本 wrapup + 归档", !!after?.wrapup && after.wrapup.mergeSha === r.mergeSha && after.archived === true, JSON.stringify(after?.wrapup));
    env.agents.dispose();
  });

  // ---- M5 rename / delete cleanup ----
  await scenario("M5 重命名与删除清理", async () => {
    const env = await makeEnv([textChunks("完成")]);
    env.settings.update({ agentsTaskWorktree: true });
    const task = await env.agents.createTask({ prompt: "将被重命名与删除的任务" });
    await waitFor("M5 轮结束", () => env.agents.listTasks({ includeArchived: true })[0]?.state === "awaiting-input");
    await sleep(600); // 轮末收尾窗口（isRunning 竞态）

    const renamed = await env.agents.rename({ taskId: task.taskId, title: "新标题（重命名后）" });
    check("M5 重命名生效", renamed?.title === "新标题（重命名后）");
    const back = await env.agents.rename({ taskId: task.taskId, title: task.title });
    check("M5 重命名还原", back?.title === task.title);

    await env.agents.deleteTask({ taskId: task.taskId, cleanup: true });
    check("M5 删除后账本为空", env.agents.listTasks({ includeArchived: true }).length === 0);
    check("M5 会话文件删除", !fs.existsSync(path.join(env.repo, ".git", "gitter", "agent-sessions", `${task.taskId}.json`)));
    check("M5 journal 目录删除", !fs.existsSync(path.join(env.repo, ".git", "gitter", "agent-sessions", task.taskId)));
    check("M5 worktree 目录删除", !fs.existsSync(task.worktreePath));
    const branches = (await tryGit(env.repo, ["branch", "--list", "task/*"])).stdout.trim();
    check("M5 task/* 分支删除", branches === "", branches);
    env.agents.dispose();
  });

  // ---- M6 awaitKind：ask_user → question、plan_submit → plan，回复/收尾清空 ----
  await scenario("M6 awaitKind 生命周期", async () => {
    const env = await makeEnv([toolChunks("ask_user", { question: "A 还是 B？", options: ["A", "B"] }), textChunks("按 B 执行")]);
    await env.agents.createTask({ prompt: "问我" });
    const q = await waitFor("M6 question 事件", () => [...env.events].reverse().find((e) => e.event.type === "question") ?? undefined) as unknown as { event: Extract<AgentSessionEvent, { type: "question" }> };
    let rec = env.agents.listTasks({ includeArchived: true })[0]!;
    check("M6 ask_user → awaitKind=question", rec.state === "awaiting-input" && rec.awaitKind === "question", `${rec.state}/${rec.awaitKind}`);
    env.agents.replyPermission({ requestId: q.event.requestId, ok: true, answer: "B" });
    // lastMessage 随流式实时更新（session.ts onEvent）——必须连 state 一起断言才是「轮已结束」
    await waitFor("M6 轮结束", () => {
      const t = env.agents.listTasks({ includeArchived: true })[0];
      return t?.state === "awaiting-input" && t.lastMessage === "按 B 执行" ? t : undefined;
    });
    rec = env.agents.listTasks({ includeArchived: true })[0]!;
    check("M6 自然收尾 awaitKind=null", rec.state === "awaiting-input" && !rec.awaitKind, `${rec.state}/${rec.awaitKind}`);

    // plan 分支
    const env2 = await makeEnv([toolChunks("plan_submit", { plan: "# 计划\n1. x" }), textChunks("计划已提交")]);
    await env2.agents.createTask({ prompt: "规划", mode: "plan" });
    const p = await waitFor("M6 plan 事件", () => [...env2.events].reverse().find((e) => e.event.type === "plan") ?? undefined) as unknown as { event: Extract<AgentSessionEvent, { type: "plan" }> };
    const rec2 = env2.agents.listTasks({ includeArchived: true })[0]!;
    check("M6 plan_submit → awaitKind=plan", rec2.state === "awaiting-input" && rec2.awaitKind === "plan", `${rec2.state}/${rec2.awaitKind}`);
    env2.agents.replyPermission({ requestId: p.event.requestId, ok: true });
    await waitFor("M6 执行轮结束", () => {
      const t = env2.agents.listTasks({ includeArchived: true })[0];
      return t?.state === "awaiting-input" && t.lastMessage === "计划已提交" ? t : undefined;
    });
    const rec3 = env2.agents.listTasks({ includeArchived: true })[0]!;
    check("M6 批准后续轮 awaitKind=null", rec3.awaitKind == null, String(rec3.awaitKind));
    env.agents.dispose();
    env2.agents.dispose();
  });

  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
