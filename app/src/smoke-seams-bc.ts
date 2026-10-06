/**
 * B/C 阶段接缝无头烟雾（extension-system-v2.md §16.6）：
 * B = ToolRegistry（内置 git 工具 + mcp 管道宿主自举）+ ai provider 注册表
 * C = L2 宿主（entry 装载/卸载/信任门）+ 事件总线 + 门禁 + log.decorators + preview + 扫描器 + storage + notify
 * 运行：npm run build && node dist/smoke-seams-bc.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PackageStore } from "./services/extensions/store";
import { CommandRegistry, BUILTIN_COMMANDS } from "./services/extensions/commands";
import { ToolRegistry, builtinGitTools, TOOL_DENIED } from "./services/extensions/tools";
import { EventBus } from "./services/extensions/events";
import { PluginStorage } from "./services/extensions/storage";
import { PluginHost } from "./services/extensions/host";
import { McpPipeHost } from "./services/mcp";
import { registerAiProvider, complete, registeredProviders, AiGatewayError } from "./services/ai";
import { tryGit } from "./services/gitexec";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-bc-smoke-"));
const userRoot = path.join(tmp, "packages");
fs.mkdirSync(userRoot, { recursive: true });

// ---- L2 fixture 包：entry main.js（CJS）----
const packDir = path.join(userRoot, "com.bc.demo");
fs.mkdirSync(packDir, { recursive: true });
fs.writeFileSync(path.join(packDir, "manifest.json"), JSON.stringify({
  schemaVersion: 2, id: "com.bc.demo", name: "BC Demo", version: "1.0.0", entry: "main.js",
  contributes: {},
}, null, 2));
fs.writeFileSync(path.join(packDir, "main.js"), `
module.exports = function activate(ctx) {
  ctx.storage.set("activated", true);
  ctx.registerLogDecorator((c) => [{ text: "B:" + String(c.sha).slice(0, 3) }]);
  ctx.registerGate("commit", (info) => String(info.message || "").includes("坏") ? "包含敏感词" : null);
  ctx.registerScanner((f) => String(f.patch || "").includes("+hacked")
    ? [{ ruleId: "pkg.demo.hack", severity: "warning", filePath: f.path, line: null, message: "hacked" }]
    : null);
  ctx.registerTool({ name: "demo.upper", description: "upper", permission: "read", execute: async (a) => String(a.text || "").toUpperCase() });
  ctx.on("repo.opened", (p) => { ctx.storage.set("lastRepo", String(p.repo || "")); ctx.notify("插件已激活", String(p.repo || "")); });
  return () => { ctx.storage.set("disposed", true); };
};
`);
// 坏 entry 包：抛错 → error 账本，宿主存活
const badDir = path.join(userRoot, "com.bc.bad");
fs.mkdirSync(badDir, { recursive: true });
fs.writeFileSync(path.join(badDir, "manifest.json"), JSON.stringify({
  schemaVersion: 2, id: "com.bc.bad", name: "BC Bad", version: "1.0.0", entry: "main.js", contributes: {},
}, null, 2));
fs.writeFileSync(path.join(badDir, "main.js"), "throw new Error('boom');");

// fixture git 仓库（工具链路用）
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
const ledger: Record<string, unknown> = { allowCodeProbe: {} };
const store = new PackageStore([], [userRoot], "0.1.0", () => ledger as never);
const registry = new CommandRegistry(BUILTIN_COMMANDS);
const tools = new ToolRegistry(builtinGitTools());
const events = new EventBus();
const notifications: { title: string; body: string }[] = [];
const host = new PluginHost({
  registry,
  tools,
  events,
  storage: new PluginStorage(path.join(tmp, "plugin-data")),
  notify: (title, body) => notifications.push({ title, body }),
});

async function main() {
  console.log(`== B/C 接缝无头烟雾 ==\nfixtures: ${tmp}\n`);

  // fixture git 仓库（工具链路用）
  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@local"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
  await tryGit(repo, ["add", "."]);
  await tryGit(repo, ["commit", "-m", "init"]);

  // ---- B：ToolRegistry 内置工具 ----
  const infos = tools.list();
  check("内置工具自举（8 个，来源 builtin）", infos.length === 8 && infos.every((t) => t.source === "builtin"),
    infos.map((t) => t.name).join(","));
  const status = await tools.call("repo.status", {}, { workDir: repo, requestApproval: async () => false });
  check("repo.status 真实仓库调用", status !== null && !status.includes("__"), (status ?? "null").slice(0, 60));
  const denied = await tools.call("repo.stage", { paths: ["a.txt"] }, { workDir: repo, requestApproval: async () => false });
  check("写工具人审拒绝 → DENIED 文案", denied === TOOL_DENIED);
  const approved = await tools.call("repo.stage", { paths: ["a.txt"] }, { workDir: repo, requestApproval: async () => true });
  check("人审通过 → 执行", approved === "staged 1 file(s)", approved ?? "null");
  check("未知工具 → null", (await tools.call("nope.tool", {}, { workDir: repo, requestApproval: async () => false })) === null);

  // ---- B：mcp 管道宿主自举（协议层走注册表）----
  const sink = { send: () => {} };
  const mcp = new McpPipeHost(repo, sink, { allowWrites: false, tools });
  const proto = mcp as unknown as { handleLine(line: string): Promise<string | null> };
  const listResp = JSON.parse((await proto.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }))) ?? "{}");
  check("tools/list 走注册表（8 工具）", (listResp.result?.tools?.length ?? 0) === 8, `${listResp.result?.tools?.length}`);
  const callResp = JSON.parse((await proto.handleLine(JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "repo.log", arguments: { limit: 5 } },
  }))) ?? "{}");
  const logText = callResp.result?.content?.[0]?.text ?? "";
  check("tools/call repo.log（经注册表执行）", logText.includes("init"), logText.slice(0, 60));
  const unknownResp = JSON.parse((await proto.handleLine(JSON.stringify({
    jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope", arguments: {} },
  }))) ?? "{}");
  check("未知工具 → MCP 协议错误", !!unknownResp.error, JSON.stringify(unknownResp.error ?? {}).slice(0, 60));

  // ---- B：ai provider 注册表 ----
  check("内置三传输自举注册", ["openai", "anthropic", "cli"].every((p) => registeredProviders().includes(p)),
    registeredProviders().join(","));
  registerAiProvider("test.demo", {
    isConfigured: () => true,
    complete: async (prompt) => `echo:${prompt.user}`,
  });
  const out = await complete({ system: "", user: "hi", maxOutputTokens: 8 }, { provider: "test.demo", endpoint: null, model: null, cliCommand: null, apiKey: null });
  check("自定义 provider 注册 + complete 路由", out === "echo:hi", out);
  let threw = false;
  try { await complete({ system: "", user: "x", maxOutputTokens: 1 }, { provider: "nope", endpoint: null, model: null, cliCommand: null, apiKey: null }); }
  catch (e) { threw = e instanceof AiGatewayError; }
  check("未注册 provider → 未配置错误", threw);

  // ---- C：L2 宿主 ----
  // 信任门默认关
  await host.activateAll(store, { allowCode: false });
  check("allowCode=false → 不装载", host.status().length === 0, JSON.stringify(host.status()));
  await host.activateAll(store, { allowCode: true });
  const st = Object.fromEntries(host.status().map((x) => [x.packageId, x]));
  check("allowCode=true → demo 装载成功", st["com.bc.demo"]?.active === true, JSON.stringify(st));
  check("坏 entry → error 账本且宿主存活", st["com.bc.bad"]?.active === false && !!st["com.bc.bad"]?.error,
    st["com.bc.bad"]?.error ?? "");

  // 事件（ctx.on + storage + notify 链）
  await events.emit("repo.opened", { repo: "D:/demo-repo" });
  check("事件订阅链（ctx.on → storage/notify）", host && notifications.some((n) => n.title === "插件已激活"),
    notifications.map((n) => n.title).join(","));
  const storage = new PluginStorage(path.join(tmp, "plugin-data"));
  check("ctx.storage 落盘", storage.getKey("com.bc.demo", "activated") === true && storage.getKey("com.bc.demo", "lastRepo") === "D:/demo-repo");

  // 门禁：只能否决
  const veto = await host.runGates("commit", { message: "坏消息" });
  const pass = await host.runGates("commit", { message: "好消息" });
  check("commit 门禁（可否决/放行）", veto.length === 1 && veto[0].includes("com.bc.demo") && pass.length === 0,
    veto.join("|"));

  // 装饰器
  const commits: { sha: string; subject: string; author: string; body: string; decorations?: { text: string; color?: string }[] }[] = [
    { sha: "abcdef1234", subject: "s", author: "a", body: "" },
  ];
  host.applyDecorations(commits);
  check("log.decorators 只读徽章", (commits[0].decorations ?? []).some((d) => d.text === "B:abc"),
    JSON.stringify(commits[0].decorations));

  // L2 扫描器（可 blocked，此处 warning）
  const findings = host.runScanners([
    { path: "x.js", patch: "+hacked()", isBinary: false, isNew: true, addedLines: 1, deletedLines: 0 },
    { path: "y.js", patch: "+fine", isBinary: false, isNew: true, addedLines: 1, deletedLines: 0 },
  ]);
  check("L2 扫描器合并", findings.length === 1 && findings[0].ruleId === "pkg.demo.hack", JSON.stringify(findings));

  // L2 插件工具
  check("L2 工具入注册表（source=plugin）", tools.get("demo.upper")?.source === "plugin");
  const up = await tools.call("demo.upper", { text: "abc" }, { workDir: repo, requestApproval: async () => false });
  check("L2 工具可执行", up === "ABC", up ?? "null");

  // 卸载：注册面全部回收 + dispose 回调执行
  host.deactivate();
  check("deactivate：工具下线 / 装饰器清空 / 事件解绑", tools.get("demo.upper") === null &&
    (host.runScanners([{ path: "x.js", patch: "+hacked", isBinary: false, isNew: true, addedLines: 1, deletedLines: 0 }])).length === 0 &&
    events.handlerCount() === 0);
  check("dispose 回调执行（storage.disposed）", storage.getKey("com.bc.demo", "disposed") === true);

  // 运行时命令（host ctx.registerCommand）
  registry.registerRuntimeCommand({ id: "ext.com.bc.demo.rt", title: "RT", action: "repo.refresh", packageId: "com.bc.demo", runtime: true });
  registry.registerPackageCommands(store); // manifest 重载不得清 runtime
  check("runtime 命令在 manifest 重载后存活", registry.list().some((c) => c.id === "ext.com.bc.demo.rt"));
  registry.unregisterCommand("ext.com.bc.demo.rt");

  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke 崩溃:", e);
  process.exit(1);
});
