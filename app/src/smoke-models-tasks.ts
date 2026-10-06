/**
 * 任务与模型模块无头验收（task-model-modules.md M1/M2/T1/T2）：
 * manifest schema（models/taskTypes 段）→ PackageStore kinds → 任务型编译（收紧校验）→
 * 工具集裁剪/策略收紧 → 档案解析链/快慢路由 → 旧配置迁移 → 账本 fork/归档/删除。
 * 运行：npm run build && node dist/smoke-models-tasks.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PackageStore } from "./services/extensions/store";
import { compileTaskTypes } from "./services/agents/taskTypes";
import { buildToolset, effectivePermissionClass } from "./services/agents/tools";
import { pickProfileRef, pickFastProfileRef } from "./services/agents/provider";
import { loadAgentTasks, saveAgentTasks, findTask } from "./services/agents/tasks";
import { AgentSessionManager } from "./services/agents/session";
import { SettingsStore } from "./services/settings";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-mt-smoke-"));

const PRESET_MANIFEST = {
  schemaVersion: 2,
  id: "gitui.agent-presets",
  name: "Agent 任务预设",
  version: "1.0.0",
  engines: { gitter: ">=0.1.0" },
  contributes: {
    taskTypes: [
      { id: "free", name: "自由任务", promptTemplate: "{input}" },
      { id: "code-review", name: "代码审查", promptTemplate: "请审查：{input}", tools: ["repo_status", "repo_diff", "repo_read_file"] },
      // 放宽违规：file_write 基线 auto，策略 session 收紧合法；但 git_commit → auto 是放宽，应拒
      { id: "loose", name: "越权预设", promptTemplate: "{input}", permissionPolicy: { git_commit: "auto" } },
      // push 覆盖违规
      { id: "pushy", name: "push 放宽", promptTemplate: "{input}", permissionPolicy: { git_push: "session" } },
      // 未知工具
      { id: "alien", name: "未知工具", promptTemplate: "{input}", tools: ["make_coffee"] },
    ],
  },
};

const MODEL_MANIFEST = {
  schemaVersion: 2,
  id: "gitui.models.deepseek",
  name: "DeepSeek 模型档案",
  version: "1.0.0",
  engines: { gitter: ">=0.1.0" },
  contributes: {
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", kind: "openai-compatible", baseURL: "https://api.deepseek.com/v1", modelId: "deepseek-chat", keyHint: "DeepSeek API Key", capabilities: { tools: true, streaming: true, contextTokens: 128000 }, tags: ["cloud", "fast"] },
      { id: "broken", name: "无工具模型", kind: "openai-compatible", baseURL: "https://x/v1", modelId: "x", capabilities: { tools: false, streaming: true } },
    ],
  },
};

async function main() {
  // ---- 1. schema/store：models/taskTypes kind 推导 ----
  const builtinRoot = path.join(tmp, "builtin");
  for (const [dir, manifest] of [
    ["gitui.agent-presets", PRESET_MANIFEST],
    ["gitui.models.deepseek", MODEL_MANIFEST],
  ] as const) {
    const d = path.join(builtinRoot, dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  const ledger: Record<string, { enabled?: boolean; kinds?: Record<string, boolean> }> = {};
  const store = new PackageStore([builtinRoot], [], "0.1.0", () => ledger);
  const listed = store.list();
  const presets = listed.find((p) => p.id === "gitui.agent-presets");
  const deep = listed.find((p) => p.id === "gitui.models.deepseek");
  check("store: taskTypes kind 推导", !!presets?.kinds.includes("taskTypes"), JSON.stringify(presets?.kinds));
  check("store: models kind 推导", !!deep?.kinds.includes("models"), JSON.stringify(deep?.kinds));

  // ---- 2. 任务型编译：合法入库，放宽/push覆盖/未知工具报错 ----
  const { entries, specs } = compileTaskTypes(store);
  check("taskTypes: 合法预设入库", !!specs.get("gitui.agent-presets/code-review"));
  check("taskTypes: 裁剪生效（只读三工具）", specs.get("gitui.agent-presets/code-review")?.tools?.length === 3);
  const loose = entries.find((e) => e.fullId === "gitui.agent-presets/loose");
  check("taskTypes: 放宽（git_commit→auto）拒载", loose?.error?.includes("收紧") === true, loose?.error ?? undefined);
  const pushy = entries.find((e) => e.fullId === "gitui.agent-presets/pushy");
  check("taskTypes: git_push 覆盖拒载", pushy?.error?.includes("each-time") === true, pushy?.error ?? undefined);
  const alien = entries.find((e) => e.fullId === "gitui.agent-presets/alien");
  check("taskTypes: 未知工具拒载", alien?.error?.includes("未知工具") === true, alien?.error ?? undefined);

  // ---- 3. 工具集：裁剪 + 策略收紧生效 ----
  const permsRequested: { tool: string; cls: string }[] = [];
  const tools = buildToolset(
    {
      worktreePath: tmp,
      taskId: "t",
      requestPermission: async (toolName, req) => {
        permsRequested.push({ tool: toolName, cls: req.permissionClass });
        return false;
      },
    },
    { allowedTools: ["repo_status", "file_write"], policy: { file_write: "each-time" } },
  );
  check("toolset: 白名单裁剪", Object.keys(tools).length === 2 && !!tools.repo_status && !!tools.file_write);
  const denied = await (tools.file_write as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    { path: "x.txt", content: "x" },
    { toolCallId: "t", messages: [] },
  );
  check("toolset: auto 工具被策略收紧为 each-time（拒绝文本）", denied.includes("用户拒绝"));
  check("toolset: 收紧后生效分级 each-time", permsRequested.some((p) => p.tool === "file_write" && p.cls === "each-time"));
  check("toolset: 基线 auto 在无策略时放行", effectivePermissionClass("repo_status") === "auto");
  check("toolset: push 恒 each-time", effectivePermissionClass("git_push", { git_push: "auto" }) === "each-time");

  // ---- 4. 档案解析链 + 快慢路由 ----
  const profiles = [
    { id: "user/a", enabled: true, capabilities: { tools: true } },
    { id: "user/b", enabled: true, capabilities: { tools: true } },
    { id: "user/nt", enabled: true, capabilities: { tools: false } }, // 无工具能力，链上被跳过
  ];
  check("链: preferred 命中", pickProfileRef(profiles, "user/b")?.id === "user/b");
  check("链: preferred 缺失 → default 首个可用", pickProfileRef(profiles, "user/nt")?.id === "user/a");
  check("链: 无 preferred → 首个", pickProfileRef(profiles, null)?.id === "user/a");
  check("链: 全不可用 → null", pickProfileRef([{ id: "x", enabled: true, capabilities: { tools: false } }], null) === null);
  check("fast: fastModelId 命中", pickFastProfileRef(profiles, "user/b", "user/a")?.id === "user/b");
  check("fast: fast 失效回落 default", pickFastProfileRef(profiles, "user/gone", "user/a")?.id === "user/a");

  // ---- 5. 旧配置一次性迁移 ----
  const legacyDir = path.join(tmp, "legacy-settings");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "settings.json"), JSON.stringify({
    aiProvider: "openai",
    aiEndpoint: "https://api.deepseek.com/v1",
    aiModel: "deepseek-chat",
    aiApiKeyProtected: "ENC",
  }));
  const legacySettings = new SettingsStore(legacyDir);
  const migrated = legacySettings.current.models[0];
  check("迁移: 旧四字段 → 首个档案", migrated?.id === "user/migrated" && migrated.baseURL === "https://api.deepseek.com/v1" && migrated.apiKeyProtected === "ENC");
  check("迁移: defaultModelId 指向", legacySettings.current.defaultModelId === "user/migrated");
  check("迁移: 幂等（已有档案不再迁）", (() => {
    legacySettings.update({ models: [...(legacySettings.current.models ?? [])] });
    const s2 = new SettingsStore(legacyDir);
    return s2.current.models.length === 1;
  })());

  // ---- 6. 账本 fork/归档/删除（SessionManager，模型 stub 不可用）----
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  await tryGitInit(repo);
  const settingsStore = new SettingsStore(path.join(tmp, "appdata"));
  const manager = new AgentSessionManager({
    repoOf: () => repo,
    store,
    settings: settingsStore,
    resolveModel: () => ({ ok: false as const, error: "smoke: 模型不可用" }),
    addUsage: () => {},
    send: () => {},
  });
  // 手工种一条已完成的源任务 + 会话历史
  const seed = {
    taskId: "t-src", title: "源任务", harnessFullId: "builtin/gitter-agent",
    worktreePath: repo, branch: "task/src", externalSessionId: null, baselineSha: "a",
    state: "completed" as const, exitCode: 0, createdAt: new Date().toISOString(),
    lastActiveAt: null, lastMessage: "完成", modelRef: null, taskType: "builtin/free", loopId: null, thinking: "medium" as const, archived: false,
  };
  const file = loadAgentTasks(repo);
  file.tasks.push(seed);
  saveAgentTasks(repo, file);
  fs.mkdirSync(path.join(repo, ".git", "gitter", "agent-sessions"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "gitter", "agent-sessions", "t-src.json"), JSON.stringify({ version: 1, taskId: "t-src", messages: [{ role: "user", content: "hi" }] }));

  const forked = manager.fork({ taskId: "t-src" });
  check("fork: 新任务复制历史", forked.title.startsWith("fork:") && forked.state === "awaiting-input");
  const forkedMsgs = JSON.parse(fs.readFileSync(path.join(repo, ".git", "gitter", "agent-sessions", `${forked.taskId}.json`), "utf8"));
  check("fork: 消息历史复制", forkedMsgs.messages.length === 1);
  check("fork: 源任务不动", findTask(loadAgentTasks(repo), "t-src")?.state === "completed");

  check("归档: 生效且列表默认过滤", (() => {
    manager.archive({ taskId: forked.taskId, archived: true });
    const all = manager.listTasks({ includeArchived: true });
    const visible = manager.listTasks();
    return all.find((t) => t.taskId === forked.taskId)?.archived === true && !visible.some((t) => t.taskId === forked.taskId);
  })());

  check("setModel: 不可用档案抛错", (() => {
    try { manager.setModel({ taskId: "t-src", model: "user/none" }); return false; } catch { return true; }
  })());

  check("删除: 账本+会话文件清除", (() => {
    manager.deleteTask({ taskId: forked.taskId });
    return findTask(loadAgentTasks(repo), forked.taskId) === undefined
      && !fs.existsSync(path.join(repo, ".git", "gitter", "agent-sessions", `${forked.taskId}.json`));
  })());

  // ---- 收尾 ----
  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

async function tryGitInit(repo: string): Promise<void> {
  const { tryGit } = await import("./services/gitexec");
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@test"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
}

void main();
