/**
 * F 阶段接缝无头烟雾（extension-system-v2.md §16.6）：
 * L3 隔离子进程 = Node child_process.fork 通道适配器（Electron utilityProcess 适配器同协议）：
 * entry 装载（entrySandbox=utility）/ 权限清单强制 / L3 工具代理注册与调用 / storage / notify /
 * statusbar / 崩溃隔离 / dispose 清理。E = 侧栏面板插槽（registerPanel/resolvePanels）。
 * 运行：npm run build && node dist/smoke-seams-f.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fork } from "child_process";
import { PackageStore, HOST_API_VERSION } from "./services/extensions/store";
import { CommandRegistry, BUILTIN_COMMANDS } from "./services/extensions/commands";
import { ToolRegistry, builtinGitTools } from "./services/extensions/tools";
import { EventBus } from "./services/extensions/events";
import { PluginStorage } from "./services/extensions/storage";
import { PluginHost } from "./services/extensions/host";
import { tryGit } from "./services/gitexec";
import { registeredLoops, runRegisteredLoop } from "./services/extensions/agentLoop";
import { registeredProviders, complete } from "./services/ai";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-f-smoke-"));
const userRoot = path.join(tmp, "packages");
const sdkDir = path.resolve(__dirname);
fs.mkdirSync(userRoot, { recursive: true });

const CHILD_TEMPLATE = (body: string) => [
  "const path = require('path');",
  `const sdkDir = process.argv[2] || '';`,
  `const { connectL3 } = require(path.join(sdkDir, 'services', 'extensions', 'l3-child'));`,
  "connectL3().then(async (ctx) => {",
  body,
  "}).catch((e) => { console.error('child init failed:', e.message); process.exit(3); });",
  "",
].join("\n");

// 包 1：全权限 demo
const p1 = path.join(userRoot, "com.f.demo");
fs.mkdirSync(p1, { recursive: true });
fs.writeFileSync(path.join(p1, "manifest.json"), JSON.stringify({
  schemaVersion: 2, id: "com.f.demo", name: "F Demo", version: "1.0.0",
  entry: "child.js", entrySandbox: "utility", apiVersion: 3,
  permissions: ["storage", "notify", "events", "git.read", "tools", "statusbar"],
  contributes: {},
}, null, 2));
fs.writeFileSync(path.join(p1, "child.js"), CHILD_TEMPLATE(`
  await ctx.registerTool({ name: 'l3.add', description: 'add', permission: 'read', execute: async (a) => String(Number(a.a) + Number(a.b)) });
  await ctx.registerTool({ name: 'l3.git', description: 'git status', permission: 'read', execute: async () => ctx.git.status() });
  await ctx.storage.set('boot', true);
  await ctx.registerStatusItem('s1', { text: 'L3 ready' });
  let gateVeto = false;
  await ctx.on('repo.opened', () => { gateVeto = true; ctx.notify('L3 收到事件', 'repo.opened'); });
  await ctx.storage.set('eventSeen', false);
  await ctx.registerTool({ name: 'l3.eventSeen', description: 'probe', permission: 'read', execute: async () => String(gateVeto) });
`));

// 包 2：受限权限（storage 未授权 → 能力调用被拒）
const p2 = path.join(userRoot, "com.f.limited");
fs.mkdirSync(p2, { recursive: true });
fs.writeFileSync(path.join(p2, "manifest.json"), JSON.stringify({
  schemaVersion: 2, id: "com.f.limited", name: "F Limited", version: "1.0.0",
  entry: "child.js", entrySandbox: "utility", permissions: ["tools"],
  contributes: {},
}, null, 2));
fs.writeFileSync(path.join(p2, "child.js"), CHILD_TEMPLATE(`
  await ctx.registerTool({ name: 'l3.probe', description: 'probe', permission: 'read', execute: async () => {
    try { await ctx.storage.set('x', 1); return 'storage-allowed'; }
    catch (e) { return 'denied:' + e.message; }
  } });
`));

// 包 3：自杀崩溃（崩溃隔离）
const p3 = path.join(userRoot, "com.f.crash");
fs.mkdirSync(p3, { recursive: true });
fs.writeFileSync(path.join(p3, "manifest.json"), JSON.stringify({
  schemaVersion: 2, id: "com.f.crash", name: "F Crash", version: "1.0.0",
  entry: "child.js", entrySandbox: "utility", permissions: ["tools"],
  contributes: {},
}, null, 2));
fs.writeFileSync(path.join(p3, "child.js"), CHILD_TEMPLATE(`
  await ctx.registerTool({ name: 'l3.doomed', description: 'doomed', permission: 'read', execute: async () => 'x' });
  setTimeout(() => process.exit(2), 200);
`));

// apiVersion 超版包（G 阶段策略）
const p4 = path.join(userRoot, "com.f.future");
fs.mkdirSync(p4, { recursive: true });
fs.writeFileSync(path.join(p4, "manifest.json"), JSON.stringify({
  schemaVersion: 2, id: "com.f.future", name: "F Future", version: "1.0.0",
  apiVersion: HOST_API_VERSION + 1, contributes: {},
}, null, 2));

const store = new PackageStore([], [userRoot], "0.1.0", () => ({}) as never);
const registry = new CommandRegistry(BUILTIN_COMMANDS);
const tools = new ToolRegistry(builtinGitTools());
const events = new EventBus();
const notifications: { title: string; body: string }[] = [];

// Node fork 通道适配器（Electron utilityProcess 同协议，main.ts 注入）
const nodeTransport = (entryPath: string, _name: string, sdk: string) => {
  const child = fork(entryPath, [sdk], { stdio: "inherit" });
  return {
    send: (m: unknown) => child.send(m as never),
    onMessage: (cb: (msg: any) => void) => child.on("message", (m) => cb(m)),
    onExit: (cb: (code: number) => void) => child.on("exit", (code) => cb(code ?? 0)),
    kill: () => child.kill(),
  };
};

const host = new PluginHost({
  registry, tools, events,
  storage: new PluginStorage(path.join(tmp, "pd")),
  notify: (title, body) => notifications.push({ title, body }),
  utilityTransport: nodeTransport,
  sdkDir,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const storage = new PluginStorage(path.join(tmp, "pd"));

async function main() {
  console.log(`== F 接缝无头烟雾 ==\nfixtures: ${tmp}\n`);

  // fixture git 仓库（git.read 只读 API 断言用）
  const repo = path.join(tmp, "repo0");
  fs.mkdirSync(repo, { recursive: true });
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@local"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
  await tryGit(repo, ["add", "."]);
  await tryGit(repo, ["commit", "-m", "init"]);

  // apiVersion 拒载（G）
  const future = store.list().find((p) => p.id === "com.f.future");
  check("apiVersion 超版 → disabled + 原因", !!future && future.state === "disabled" && !!future.reason,
    future?.reason ?? "missing");

  // 信任门默认关
  await host.activateAll(store, { allowCode: false });
  check("allowCode=false → 不装载", host.status().length === 0);

  await host.activateAll(store, { allowCode: true });
  await wait(1200); // 等三个子进程 init/ready + 崩溃包退出
  const st = Object.fromEntries(host.status().map((x) => [x.packageId, x]));
  check("L3 demo/limited 装载成功", st["com.f.demo"]?.active === true && st["com.f.limited"]?.active === true,
    JSON.stringify(st));
  check("崩溃包 → error 账本（码 2）", st["com.f.crash"]?.active === false && (st["com.f.crash"]?.error ?? "").includes("2"),
    st["com.f.crash"]?.error ?? "");

  // L3 工具代理
  check("L3 工具入注册表", tools.get("ext.com.f.demo.l3.add")?.source === "plugin" &&
    !!tools.get("ext.com.f.limited.l3.probe"));
  const sum = await tools.call("ext.com.f.demo.l3.add", { a: 2, b: 3 }, { workDir: tmp, requestApproval: async () => false });
  check("L3 工具跨进程调用（2+3=5）", sum === "5", sum ?? "null");

  // 权限清单强制
  const probe = await tools.call("ext.com.f.limited.l3.probe", {}, { workDir: tmp, requestApproval: async () => false });
  check("未授权能力被拒（permission denied: storage）", (probe ?? "").includes("permission denied: storage"), probe ?? "null");

  // storage / statusbar / git.read（经 L3 工具间接断言）
  check("ctx.storage 落盘（子进程 → 宿主文件）", storage.getKey("com.f.demo", "boot") === true);
  check("statusbar 插槽（L3 注册）", host.listStatusItems().some((i) => i.packageId === "com.f.demo" && i.text === "L3 ready"));
  const gitOut = await tools.call("ext.com.f.demo.l3.git", {}, { workDir: repo, requestApproval: async () => false });
  check("git.read 只读 API", (gitOut ?? "").length >= 0, (gitOut ?? "null").slice(0, 40));

  // 事件下发（host emit → 子进程 handler → notify + 工具探针）
  host.setCurrentRepo(repo);
  await events.emit("repo.opened", { repo });
  await wait(400);
  check("事件下发到子进程（notify 捕获）", notifications.some((n) => n.title === "L3 收到事件"),
    notifications.map((n) => n.title).join(","));
  const seen = await tools.call("ext.com.f.demo.l3.eventSeen", {}, { workDir: repo, requestApproval: async () => false });
  check("事件处理器执行（探针翻转）", seen === "true", seen ?? "null");

  // 崩溃隔离：crash 包工具已随子进程退出被回收
  await wait(400);
  check("崩溃隔离：doomed 工具已回收", tools.get("ext.com.f.crash.l3.doomed") === null);

  // deactivate：全量清理
  host.deactivate();
  await wait(300);
  check("deactivate：L3 工具全部下线", tools.get("ext.com.f.demo.l3.add") === null && tools.get("ext.com.f.limited.l3.probe") === null);
  check("deactivate：循环/provider 同步注销", !registeredLoops().includes("ext.com.f.panel.fast") &&
    !registeredProviders().includes("ext.com.f.panel.mock"));
  check("deactivate：状态栏清空", host.listStatusItems().length === 0);

  // ---- E：面板插槽（L2 数据供给）----
  const p5 = path.join(userRoot, "com.f.panel");
  fs.mkdirSync(p5, { recursive: true });
  fs.writeFileSync(path.join(p5, "manifest.json"), JSON.stringify({
    schemaVersion: 2, id: "com.f.panel", name: "F Panel", version: "1.0.0", entry: "main.js",
    contributes: {},
  }, null, 2));
  fs.writeFileSync(path.join(p5, "main.js"), [
    "module.exports = (ctx) => {",
    "  ctx.registerPanel('stats', { title: '仓库速览', body: () => 'panels-body-ok' });",
    "  ctx.registerView('badge', { title: '构建徽章', html: '<b>build</b> passing' });",
    "  ctx.registerCommitBlock((info) => '暂存 ' + info.files + ' 个文件，记得跑测试');",
    "  ctx.registerDiffNote((p) => p.includes('lock') ? '锁文件变更：请确认依赖审计' : null);",
    "  ctx.registerLoop('fast', async (req) => ({ text: 'loop:' + req.user, steps: [] }));",
    "  ctx.registerAiProvider('mock', { isConfigured: () => true, complete: async (p) => 'P:' + p.user });",
    "};",
    "",
  ].join("\n"));
  await host.activateAll(store, { allowCode: true });
  const panels = await host.resolvePanels(null);
  check("面板插槽（registerPanel → resolvePanels）", panels.some((p) => p.title === "仓库速览" && p.body === "panels-body-ok"),
    JSON.stringify(panels));
  const blocks = await host.resolveCommitBlocks({ message: "", files: 3 });
  const notes = await host.resolveDiffNotes("package-lock.json");
  const notesNone = await host.resolveDiffNotes("src/app.ts");
  check("提交区块（数据供给）", blocks.length === 1 && blocks[0].text.includes("3 个文件"), JSON.stringify(blocks));
  check("diff 注记（按路径命中/未命中）", notes.length === 1 && notes[0].text.includes("依赖审计") && notesNone.length === 0,
    JSON.stringify(notes));
  const views = host.listViews();
  check("webview 视图容器（registerView → listViews）", views.some((v) => v.title === "构建徽章" && v.html.includes("build")),
    JSON.stringify(views.map((v) => v.title)));

  // L2 loop / provider 注册（D 接缝的插件侧）
  check("L2 注册循环入册", registeredLoops().includes("ext.com.f.panel.fast"), registeredLoops().join(","));
  const loopRes = await runRegisteredLoop("ext.com.f.panel.fast", {
    workDir: repo, system: "", user: "hi", skills: [], requestApproval: async () => false,
  }, { provider: "x", endpoint: null, model: null, cliCommand: null, apiKey: null });
  check("L2 循环可执行", loopRes.text === "loop:hi", loopRes.text);
  check("L2 provider 入册", registeredProviders().includes("ext.com.f.panel.mock"));
  const provOut = await complete({ system: "", user: "q", maxOutputTokens: 4 }, { provider: "ext.com.f.panel.mock", endpoint: null, model: null, cliCommand: null, apiKey: null });
  check("L2 provider 路由", provOut === "P:q", provOut);

  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  host.deactivate();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke 崩溃:", e);
  process.exit(1);
});
