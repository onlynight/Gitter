/**
 * A4 验收台闭环无头烟雾（agent-harness.md §十 A4）：
 * review_get_state 工具（有/无反馈两态）+ pickRepairTarget 修复轮目标优先级。
 * 运行：npm run build && node dist/smoke-a4.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildToolset, PERM } from "./services/agents/tools";
import { pickRepairTarget } from "./services/agents/session";
import type { AgentTaskRecord } from "./services/agents/types";
import { writeFeedback, readFeedback, clearFeedback } from "./services/feedback";
import { tryGit } from "./services/gitexec";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-a4-smoke-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });

function task(partial: Partial<AgentTaskRecord>): AgentTaskRecord {
  return {
    taskId: partial.taskId ?? "t",
    title: partial.title ?? "t",
    harnessFullId: "builtin/gitter-agent",
    worktreePath: repo,
    branch: "task/t",
    externalSessionId: null,
    baselineSha: "a".repeat(40),
    state: partial.state ?? "completed",
    exitCode: null,
    createdAt: partial.createdAt ?? "2026-10-06T00:00:00Z",
    lastActiveAt: partial.lastActiveAt ?? "2026-10-06T00:00:00Z",
    lastMessage: null,
    modelRef: null,
    taskType: null,
    archived: partial.archived ?? false,
  } as AgentTaskRecord;
}

async function main() {
  console.log(`== A4 验收台闭环无头烟雾 ==\nfixtures: ${tmp}\n`);
  await tryGit(repo, ["init"]);

  // ---- review_get_state：无反馈态 ----
  const deps = {
    worktreePath: repo,
    taskId: "smoke",
    requestPermission: async () => true,
  };
  const tools = buildToolset(deps);
  check("review_get_state 入列（PERM auto）", "review_get_state" in tools && PERM.review_get_state === "auto");
  const noneState = JSON.parse(await (tools.review_get_state as unknown as { execute: (a: never) => Promise<string> }).execute({} as never));
  check("无反馈 → no-feedback", noneState.state === "no-feedback" && noneState.note === null, JSON.stringify(noneState));

  // ---- review_get_state：有反馈态 ----
  writeFeedback(repo, "登录页未处理空输入，请修复", "src/login.ts");
  const fb = readFeedback(repo);
  check("feedback 读写往返", !!fb && fb.note.includes("空输入") && fb.path === "src/login.ts");
  const fbState = JSON.parse(await (tools.review_get_state as unknown as { execute: (a: never) => Promise<string> }).execute({} as never));
  check("有反馈 → feedback + 意见/文件", fbState.state === "feedback" && fbState.note.includes("空输入") && fbState.path === "src/login.ts",
    JSON.stringify(fbState));

  // 权限拒绝路径（requestPermission false 也能拿到文本拒绝）
  const deniedTools = buildToolset({ ...deps, requestPermission: async () => false });
  // auto 级不触授权卡 → 拒绝路径需要策略收紧才可达；此处验证 auto 直行语义即可
  const autoState = JSON.parse(await (deniedTools.review_get_state as unknown as { execute: (a: never) => Promise<string> }).execute({} as never));
  check("auto 级不受授权卡影响", autoState.state === "feedback");

  // ---- pickRepairTarget：优先级 + 忙态排除 + 归档排除 + 最近活跃 ----
  const t = (over: Partial<AgentTaskRecord> & { taskId: string }) => {
    const { taskId, ...rest } = over;
    return task({ taskId, ...rest });
  };
  check("空列表 → null", pickRepairTarget([]) === null);
  check("全忙态 → null", pickRepairTarget([
    t({ taskId: "w", state: "working" }),
    t({ taskId: "s", state: "starting" }),
    t({ taskId: "p", state: "awaiting-permission" }),
  ]) === null);
  check("归档不参与", pickRepairTarget([t({ taskId: "a", state: "awaiting-input", archived: true })]) === null);
  check("awaiting-input 优先于 completed", pickRepairTarget([
    t({ taskId: "done", state: "completed", lastActiveAt: "2026-10-06T10:00:00Z" }),
    t({ taskId: "wait", state: "awaiting-input", lastActiveAt: "2026-10-06T09:00:00Z" }),
  ])?.taskId === "wait");
  check("同级取最近活跃", pickRepairTarget([
    t({ taskId: "old", state: "interrupted", lastActiveAt: "2026-10-05T09:00:00Z" }),
    t({ taskId: "new", state: "interrupted", lastActiveAt: "2026-10-06T09:00:00Z" }),
  ])?.taskId === "new");
  check("completed 仍可作修复轮目标（resume 复活）", pickRepairTarget([
    t({ taskId: "c", state: "completed" }),
  ])?.taskId === "c");

  // ---- 清理 ----
  clearFeedback(repo);
  check("clearFeedback", readFeedback(repo) === null);

  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke 崩溃:", e);
  process.exit(1);
});
