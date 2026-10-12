import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

/**
 * M 系列主线冒烟（harness-mainline-roadmap.md M1/M2/M3 落地回归）：
 * - M1.2 pre/post-tool 钩子（拦截 / 注记 / 总开关）
 * - M1.3 用量聚合（账本 + 单价 → 按天/模型/任务/费用）
 * - M1.4 冲突闭环（rebase/merge 冲突检测 → abort；operationState）
 * - M1.1 OAuth 纯函数与令牌仓（PKCE / 授权 URL / ensure / 登出）
 * - M2.2 风险信号（路径/内容/规模/密钥规则）
 * - M2.4 审查三态（review_get_state 读宿主审查结论 + 记录归一）
 * - M3.3 外部 harness 任务（假 CLI 全链路：创建 → 事件直通 → 退出落账 + checkpoint）
 * - M3.4 驾驶舱注册表（register / allTasks / unregister）
 */

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`[PASS] ${name}`);
  else {
    failures++;
    console.log(`[FAIL] ${name} — ${JSON.stringify(detail ?? "")}`);
  }
}

function git(dir: string, args: string[], opts?: { allowFail?: boolean }): string {
  try {
    return execFileSync("git", ["-c", "user.email=smoke@test", "-c", "user.name=smoke", ...args], {
      cwd: dir, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    if (opts?.allowFail) return "";
    throw e;
  }
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function main(): Promise<void> {
  // ============ M1.2 pre/post-tool 钩子 ============
  {
    const { registerAgentTool, buildToolset } = await import("./services/agents/registry");
    const { registerToolHook, unregisterToolHooksByPackage } = await import("./services/agents/seams");

    registerAgentTool({
      name: "smoke.ping",
      description: "smoke",
      parametersSchema: (await import("zod")).z.object({}),
      permissionClass: "auto",
      source: "builtin" as const,
      readonly: true,
      async execute() { return "pong"; },
    });
    registerToolHook({
      id: "smoke.hook.blockenv", when: "pre-tool", order: 0, source: "builtin",
      hook: (info) => (info.toolName === "smoke.ping" && info.argsSummary.includes("\"block\":true")
        ? { block: true, reason: "禁止 ping block" } : null),
    });
    registerToolHook({
      id: "smoke.hook.note", when: "post-tool", order: 0, source: "builtin",
      hook: () => "后置注记：一切正常",
    });

    type ToolEnvT = import("./services/agents/registry").ToolEnv;
    const env = (over: Partial<ToolEnvT> = {}): ToolEnvT => ({
      worktreePath: process.cwd(), taskId: "t", mode: "yolo",
      signal: new AbortController().signal,
      emit: () => {}, requestPermission: async () => true,
      readLog: new Map(), noteFileChange: () => {},
      askUser: async () => "", submitPlan: async () => ({ status: "approved" }),
      setTodos: () => {}, spawnSubtask: async () => "s", subtaskPresets: () => [],
      shells: new Map(), ...over,
    });
    const toolset = buildToolset(env(), { mode: "yolo" });
    // biome-ignore lint: 测试集索引
    const ping = toolset["smoke.ping"] as unknown as { execute(a: unknown): Promise<string> };
    const r1 = await ping.execute({ block: true });
    check("M1.2 pre-hook 拦截", r1.includes("被钩子拦截") && r1.includes("禁止 ping block"), r1);
    const r2 = await ping.execute({});
    check("M1.2 post-hook 注记 + 放行", r2.includes("pong") && r2.includes("后置注记"), r2);
    const toolset2 = buildToolset(env({ hooksEnabled: false }), { mode: "yolo" });
    const ping2 = toolset2["smoke.ping"] as unknown as { execute(a: unknown): Promise<string> };
    const r3 = await ping2.execute({ block: true });
    check("M1.2 钩子总开关关闭", r3 === "pong", r3);
    unregisterToolHooksByPackage("builtin");
    // 审计视图带 toolHooks 键
    const { auditSeams } = await import("./services/agents/seams");
    check("M1.2 审计含 toolHooks", Array.isArray(auditSeams().toolHooks));
  }

  // ============ M2.2 风险信号 ============
  {
    const { scanRiskSignals } = await import("./services/risk");
    const rep = scanRiskSignals([
      { path: ".env.production", patch: "+DB_PASS=xxxx\n", added: 1, deleted: 0 },
      { path: "db/migration.sql", patch: "+DROP TABLE users;\n", added: 1, deleted: 0 },
      { path: "src/big.ts", patch: Array.from({ length: 600 }, (_, i) => `+line ${i}`).join("\n"), added: 600, deleted: 0 },
      { path: "src/ok.ts", patch: "+const a = 1;\n", added: 1, deleted: 0 },
      { path: "creds/user.pem", patch: null, added: 0, deleted: 3 },
    ]);
    check("M2.2 高风险计数 ≥3（.env/DROP/pem）", rep.counts.high >= 3, rep.counts);
    check("M2.2 规模信号（600 行）", rep.files.find((f) => f.path === "src/big.ts")?.signals.some((s) => s.kind === "size.large") === true, rep.files);
    check("M2.2 低风险文件无信号", (rep.files.find((f) => f.path === "src/ok.ts")?.signals.length ?? 1) === 0);
    check("M2.2 排序高风险在前", rep.files[0].signals[0]?.level === "high", rep.files[0]);
  }

  // ============ M2.4 审查三态：review_get_state 读宿主结论 + normalizeRecord ============
  {
    const { normalizeRecord } = await import("./services/agents/tasks");
    const nr = normalizeRecord({ taskId: "t" } as never);
    check("M2.4 normalizeRecord 补 review=null", nr.review === null);
    await import("./services/agents/builtinTools");
    const { agentToolCatalog } = await import("./services/agents/registry");
    const tool = agentToolCatalog().find((t) => t.name === "review_get_state")!;
    const out = await tool.execute({
      worktreePath: process.cwd(), taskId: "t", mode: "yolo", signal: new AbortController().signal,
      emit: () => {}, requestPermission: async () => true, readLog: new Map(), noteFileChange: () => {},
      askUser: async () => "", submitPlan: async () => ({ status: "approved" }), setTodos: () => {},
      spawnSubtask: async () => "s", subtaskPresets: () => [], shells: new Map(),
      getReview: () => ({ status: "rejected", comment: "修一下 TODO", at: new Date().toISOString() }),
    } as never, {});
    const parsed = JSON.parse(out) as { review?: { status: string }; note?: string };
    check("M2.4 review_get_state 读任务审查结论", parsed.review?.status === "rejected" && parsed.note === "修一下 TODO", out);
  }

  // ============ M1.3 用量聚合 ============
  {
    const repo = tmpDir("gitter-usage-");
    fs.mkdirSync(path.join(repo, ".git", "gitter", "agent-sessions", "task-1"), { recursive: true });
    const ledger = { version: 1, tasks: [{ taskId: "task-1", title: "任务一", state: "awaiting-input", modelRef: "user/m1", lastActiveAt: "2026-10-12T10:00:00Z" }] };
    fs.writeFileSync(path.join(repo, ".git", "gitter", "agent-tasks.json"), JSON.stringify(ledger));
    const sf = { version: 2, taskId: "task-1", messages: [], compactions: [], usageHistory: [
      { ts: "2026-10-11T09:00:00Z", input: 1000, output: 500, cacheRead: 400 },
      { ts: "2026-10-12T10:00:00Z", input: 2000, output: 800, cacheRead: 1500 },
    ] };
    fs.writeFileSync(path.join(repo, ".git", "gitter", "agent-sessions", "task-1.json"), JSON.stringify(sf));
    const { aggregateUsage } = await import("./services/agents/usage");
    const rep = aggregateUsage([repo], [{ id: "user/m1", pricing: { inputPerM: 1, outputPerM: 2 } } as never]);
    check("M1.3 汇总 token", rep.totals.inputTokens === 3000 && rep.totals.outputTokens === 1300, rep.totals);
    check("M1.3 费用估算", rep.totals.cost !== null && Math.abs(rep.totals.cost - (3000 / 1e6 * 1 + 1300 / 1e6 * 2)) < 1e-9, rep.totals.cost);
    check("M1.3 按天两行", rep.byDay.length === 2 && rep.byDay.some((d) => d.day === "2026-10-11"), rep.byDay);
    check("M1.3 按模型归组", rep.byModel[0]?.modelRef === "user/m1" && rep.byModel[0].turns === 2, rep.byModel);
    check("M1.3 空仓库标记", rep.emptyRepos.length === 0, rep.emptyRepos);
    const rep2 = aggregateUsage([path.join(repo, "nonexistent")], []);
    check("M1.3 缺账本仓库进 emptyRepos", rep2.emptyRepos.length === 1 && rep2.totals.turns === 0);
  }

  // ============ M1.4 冲突闭环（rebase / merge 状态机 + abort）============
  {
    const repo = tmpDir("gitter-gitops-");
    git(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "base\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "base"]);
    git(repo, ["checkout", "-b", "feature"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "feature\n");
    git(repo, ["commit", "-am", "feature"]);
    git(repo, ["checkout", "main"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "main\n");
    git(repo, ["commit", "-am", "main"]);
    const { operationState, rebaseAbort, mergeAbort, rebaseContinue } = await import("./services/gitops");
    let st = await operationState(repo);
    check("M1.4 初始无进行中操作", st.kind === null, st);
    git(repo, ["rebase", "feature"], { allowFail: true });
    st = await operationState(repo);
    check("M1.4 rebase 冲突态检测", st.kind === "rebase", st);
    await rebaseAbort(repo);
    st = await operationState(repo);
    check("M1.4 rebase abort 复原", st.kind === null, st);
    git(repo, ["merge", "feature"], { allowFail: true });
    st = await operationState(repo);
    check("M1.4 merge 冲突态检测", st.kind === "merge", st);
    await mergeAbort(repo);
    st = await operationState(repo);
    check("M1.4 merge abort 复原", st.kind === null, st);
    void rebaseContinue;
  }

  // ============ M1.1 OAuth：PKCE / 授权 URL / 令牌仓 ============
  {
    const { OAuthManager, pkceVerifier, pkceChallenge, buildAuthorizeUrl } = await import("./services/oauth");
    const v = pkceVerifier();
    const c = pkceChallenge(v);
    check("M1.1 PKCE 形状", v.length >= 43 && c.length === 43 && c !== v, { v: v.length, c: c.length });
    const cfg = { authorizeUrl: "https://example.com/oauth/authorize", tokenUrl: "https://example.com/token", clientId: "cid", scopes: "a b" };
    const url = buildAuthorizeUrl(cfg, "http://127.0.0.1:9/callback", "st", c);
    check("M1.1 授权 URL 组装", url.includes("response_type=code") && url.includes("client_id=cid") && url.includes("code_challenge_method=S256") && url.includes("redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2Fcallback"), url);
    const dir = tmpDir("gitter-oauth-");
    const passthrough = { encrypt: (p: string) => Buffer.from(p, "utf8").toString("base64"), decrypt: (b: string) => Buffer.from(b, "base64").toString("utf8") };
    const mgr = new OAuthManager(dir, passthrough);
    check("M1.1 未登录态", mgr.status("p1").loggedIn === false);
    mgr.putTokensForTest("p1", { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });
    check("M1.1 登录态 + 过期时间", mgr.status("p1").loggedIn === true && mgr.status("p1").expiresAt !== null);
    const tok = await mgr.ensureToken("p1", cfg);
    check("M1.1 未过期直取", tok === "at", tok);
    mgr.logout("p1");
    check("M1.1 登出", mgr.status("p1").loggedIn === false);
    let threw = false;
    try { await mgr.ensureToken("p1", cfg); } catch { threw = true; }
    check("M1.1 无令牌 ensureToken 抛错", threw);
    // 持久化：新实例读回（加密往返）
    mgr.putTokensForTest("p2", { accessToken: "x", refreshToken: null, expiresAt: Date.now() + 60_000 });
    const mgr2 = new OAuthManager(dir, passthrough);
    check("M1.1 令牌落盘回读", mgr2.status("p2").loggedIn === true);
    check("M1.1 oauth.json 不含明文", !fs.readFileSync(path.join(dir, "oauth.json"), "utf8").includes("accessToken"));
  }

  // ============ M3.1 自动更新：更新源解析 ============
  {
    const { resolveFeed } = await import("./services/updater");
    const gh = resolveFeed("https://github.com/acme/gitter/releases");
    check("M3.1 GitHub 源识别", gh !== null && gh.provider === "github" && gh.owner === "acme" && gh.repo === "gitter", gh);
    const g1 = resolveFeed("https://updates.example.com/gitter/");
    check("M3.1 generic 源（目录）", g1 !== null && g1.provider === "generic" && g1.url === "https://updates.example.com/gitter", g1);
    const g2 = resolveFeed("https://updates.example.com/gitter/latest.yml");
    check("M3.1 generic 源（latest.yml 全路径取目录）", g2 !== null && g2.provider === "generic" && g2.url === "https://updates.example.com/gitter", g2);
    check("M3.1 非法源拒绝", resolveFeed("not-a-url") === null && resolveFeed("") === null);
  }

  // ============ M3.4 驾驶舱注册表 ============
  {
    const { CockpitRegistry } = await import("./services/cockpit");
    const reg = new CockpitRegistry();
    reg.register("b1", { repoPath: "D:/work/a", listTasks: () => [
      { taskId: "t1", title: "A 任务", state: "working", branch: "main", modelRef: null, lastMessage: null, lastActiveAt: "2026-10-12T10:00:00Z", archived: false, review: { status: "approved", comment: null, at: "2026-10-12T10:00:00Z" } },
      { taskId: "t2", title: "归档", state: "working", branch: "main", modelRef: null, lastMessage: null, lastActiveAt: null, archived: true, review: null },
    ] as never });
    reg.register("b2", { repoPath: null, listTasks: () => [] });
    const rows = reg.allTasks();
    check("M3.4 聚合 + 过滤归档 + 跳过空仓库会话", rows.length === 1 && rows[0].repoName === "a" && rows[0].review?.status === "approved", rows);
    reg.unregister("b1");
    check("M3.4 注销", reg.allTasks().length === 0);
  }

  // ============ M3.3 外部 harness 任务（假 CLI 全链路）============
  {
    const repo = tmpDir("gitter-ext-");
    git(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "1\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "init"]);
    // 假 CLI：输出一行 assistant 事件 JSON + exit 0（无事件映射 → 退化输出，退出合成终态）
    const fakeCli = tmpDir("gitter-extcli-");
    const cliJs = path.join(fakeCli, "cli.js");
    fs.writeFileSync(cliJs, "console.log(JSON.stringify({type:'assistant',text:'外部完成'}));\nprocess.exit(0);\n");
    // 手写一个最小 manifest 的包让 listHarnesses 能发现——直接走 store 不现实（需 PackageStore 装载），
    // 这里直测 transport 语义：launchCliJson 无事件映射时的退化闭环
    const { launchCliJson } = await import("./services/agents/transports/clijson");
    const events: unknown[] = [];
    let exitCode: number | null | undefined;
    const proc = launchCliJson(
      { spec: { fullId: "x/y", packageId: "x", harnessId: "y", displayName: "Y", descriptor: { fullId: "x/y", packageId: "x", harnessId: "y", displayName: "Y", transport: "cli-json", fallback: null, capabilities: [], submissionMode: "none", identity: { assistedBy: "ext" }, versionPattern: null }, spawn: { command: process.execPath, args: [cliJs], promptStdin: false, env: {} }, resume: null, stopMode: "kill", hostServices: [], permissions: { gitWrite: [], outsideWorktree: false, network: "deny" }, promptTemplates: { preamble: null, feedback: null }, eventMap: null }, worktreePath: repo, taskId: "ext-1", prompt: "hi", sandbox: null, externalSessionId: null, envDenylist: [] },
      {
        onFrameResult: () => {},
        onEvent: (ev) => events.push(ev),
        onExit: (c) => { exitCode = c; },
      },
    );
    await new Promise((r) => setTimeout(r, 800));
    check("M3.3 假 CLI 退出码 0", exitCode === 0, exitCode);
    const completed = events.find((e) => (e as { type: string }).type === "completed") as { outcome?: string } | undefined;
    check("M3.3 退出合成 completed 终态", completed?.outcome === "completed", events);
    check("M3.3 kill 通道存在", typeof proc.kill === "function");
  }

  console.log(failures === 0 ? "\n全部通过 ✔" : `\n${failures} 项失败 ✘`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
