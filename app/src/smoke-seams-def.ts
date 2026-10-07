/**
 * D/E/G 阶段接缝无头烟雾（extension-system-v2.md §16.6）：
 * D = skills 数据接缝 + AgentLoop（mock LLM 端到端工具循环）+ registerAgentLoop
 * B 遗留 = mcpServers 外部 stdio 连接器（fixture MCP server）
 * E = statusbar 插槽；G = 脚手架生成器
 * 运行：npm run build && node dist/smoke-seams-def.js
 */
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { PackageStore } from "./services/extensions/store";
import { importGpkFile } from "./services/extensions/gpk";
import { ToolRegistry, builtinGitTools } from "./services/extensions/tools";
import { McpClientManager } from "./services/extensions/mcpClient";
import { bindToolRegistry, registerAgentLoop, registeredLoops, runRegisteredLoop } from "./services/extensions/agentLoop";
import { PluginHost } from "./services/extensions/host";
import { CommandRegistry, BUILTIN_COMMANDS } from "./services/extensions/commands";
import { EventBus } from "./services/extensions/events";
import { PluginStorage } from "./services/extensions/storage";
import { tryGit } from "./services/gitexec";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-def-smoke-"));
const userRoot = path.join(tmp, "packages");
fs.mkdirSync(userRoot, { recursive: true });

// fixture 外部 MCP server 脚本先生成（manifest 引用其绝对路径）
const mcpServerScript = path.join(tmp, "mcp-server.js");
// fixture 包：skill + mcpServers
const packDir = path.join(userRoot, "com.def.demo");
fs.mkdirSync(packDir, { recursive: true });
fs.writeFileSync(path.join(packDir, "manifest.json"), JSON.stringify({
  schemaVersion: 2, id: "com.def.demo", name: "DEF Demo", version: "1.0.0",
  contributes: {
    skills: [{
      id: "concise", name: "简洁回答", description: "保持三句以内",
      instructions: "回答必须以「按技能：」开头，且不超过三句话。", tools: [],
    }],
    emptyHints: [{ slot: "changes.empty", text: "工作区很干净——试试侧栏的插件面板？" }],
    mcpServers: [{ id: "echo", name: "Echo Server", transport: "stdio", command: process.execPath, args: [mcpServerScript], description: "回声服务器" }],
  },
}, null, 2));

// fixture 外部 MCP server 实现
fs.writeFileSync(mcpServerScript, [
  "let buf = '';",
  "process.stdin.on('data', (d) => {",
  "  buf += d.toString('utf8');",
  "  let i;",
  "  while ((i = buf.indexOf(" + JSON.stringify("\n") + ")) >= 0) {",
  "    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);",
  "    if (!line) continue;",
  "    let msg; try { msg = JSON.parse(line); } catch { continue; }",
  "    if (msg.id === undefined || msg.id === null) continue;",
  "    let result = {};",
  "    if (msg.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'echo' } };",
  "    else if (msg.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'echo back' }] };",
  "    else if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: 'echo:' + JSON.stringify(msg.params.arguments) }] };",
  "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + " + JSON.stringify("\n") + ");",
  "  }",
  "});",
  "",
].join(NL));

const store = new PackageStore([], [userRoot], "0.1.0", () => ({}) as never);
const tools = new ToolRegistry(builtinGitTools());
bindToolRegistry(tools);
const registry = new CommandRegistry(BUILTIN_COMMANDS);
const host = new PluginHost({
  registry, tools, events: new EventBus(),
  storage: new PluginStorage(path.join(tmp, "pd")),
  notify: () => {},
});

// fixture git 仓库 + mock LLM server
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
let serverSeenSystem = "";
let llmCallCount = 0;
const llm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    llmCallCount++;
    const parsed = JSON.parse(body);
    serverSeenSystem = parsed.messages?.[0]?.content ?? "";
    res.setHeader("Content-Type", "application/json");
    if ((req.url ?? "").endsWith("/v1/messages")) {
      // Anthropic 原生 tools 协议 + SSE 流式（D 完全收口）：tool_use 分片 → tool_result → text 分片
      res.setHeader("Content-Type", "text/event-stream");
      if (llmCallCount === 3) {
        const sse = (obj: unknown) => "data: " + JSON.stringify(obj) + "\n\n";
        res.write(sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
        res.write(sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "先查状态。" } }));
        res.write(sse({ type: "content_block_stop", index: 0 }));
        res.write(sse({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu1", name: "repo.status" } }));
        res.write(sse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } }));
        res.write(sse({ type: "content_block_stop", index: 1 }));
        res.write("data: [DONE]\n\n");

      } else {
        const sse2 = (obj: unknown) => "data: " + JSON.stringify(obj) + "\n\n";
        res.write(sse2({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
        for (const c of ["anthropic 流式", "最终回答：clean"]) {
          res.write(sse2({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: c } }));
        }
        res.write(sse2({ type: "content_block_stop", index: 0 }));
        res.write("data: [DONE]\n\n");
      }
      res.end();
      return;
    }
    if (llmCallCount === 1) {
      // SSE tool_call 分片（id/name → arguments 分两帧，验证流式组装）
      res.setHeader("Content-Type", "text/event-stream");
      res.write("data: " + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "repo.status", arguments: "" } }] } }] }) + "\n\n");
      res.write("data: " + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] }) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      // SSE 流式（D 残留收口验收）：delta 分片 + [DONE]
      res.setHeader("Content-Type", "text/event-stream");
      const chunks = ["最终", "回答：", "仓库状态已", "查询。"];
      for (const c of chunks) {
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: c } }] }) + "\n\n");
      }
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });
});

async function main() {
  console.log(`== D/E/G 接缝无头烟雾 ==\nfixtures: ${tmp}\n`);
  await new Promise<void>((r) => llm.listen(0, r));
  const addr = llm.address() as { port: number };

  await tryGit(repo, ["init"]);
  await tryGit(repo, ["config", "user.email", "smoke@local"]);
  await tryGit(repo, ["config", "user.name", "smoke"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hi\n");
  await tryGit(repo, ["add", "."]);
  await tryGit(repo, ["commit", "-m", "init"]);

  // ---- D：skills 数据接缝 ----
  const skills = store.skillsOf();
  check("技能包列举（ext.<pkg>.<id>）", skills.length === 1 && skills[0].id === "ext.com.def.demo.concise" &&
    skills[0].instructions.includes("按技能"), JSON.stringify(skills.map((s) => s.id)));
  const hints = store.emptyHintsOf("changes.empty");
  check("空状态提示接缝（changes.empty）", hints.length === 1 && hints[0].text.includes("插件面板") &&
    store.emptyHintsOf("log.empty").length === 0, JSON.stringify(hints));

  // ---- B 遗留：mcpServers 外部连接器 ----
  const cfgs = store.mcpServersOf();
  check("mcpServers 列举（mcp.<pkg>.<id>）", cfgs.length === 1 && cfgs[0].id === "mcp.com.def.demo.echo", JSON.stringify(cfgs.map((c) => c.id)));
  const mgr = new McpClientManager();
  const conn = await mgr.connect(cfgs[0], tools);
  check("外部 server 连接 + 工具入注册表", conn.error === null && conn.toolCount === 1 &&
    tools.get("mcp.com.def.demo.echo.echo")?.source === "mcp", JSON.stringify(conn));
  const echoed = await tools.call("mcp.com.def.demo.echo.echo", { x: 1 }, { workDir: repo, requestApproval: async () => false });
  check("外部工具经注册表调用", echoed === 'echo:{"x":1}', echoed ?? "null");
  check("connected 账本", mgr.connected().includes("mcp.com.def.demo.echo"));
  mgr.disconnectAll();
  check("断开后工具仍在注册表（来源标记供清理策略用）", !!tools.get("mcp.com.def.demo.echo.echo"));

  // ---- D：AgentLoop（mock LLM 端到端：工具循环 + 技能注入）----
  check("内置循环自举注册", registeredLoops().includes("builtin.tools"));
  registerAgentLoop("test.echo", async (req) => ({ text: "echo:" + req.user, steps: [] }));
  const echoRes = await runRegisteredLoop("test.echo", {
    workDir: repo, system: "", user: "ping", skills: [], requestApproval: async () => false,
  }, { provider: "x", endpoint: null, model: null, cliCommand: null, apiKey: null });
  check("registerAgentLoop 自定义循环", echoRes.text === "echo:ping");

  console.log("loop 前计数:", llmCallCount);
  const deltas: string[] = [];
  const result = await runRegisteredLoop("builtin.tools", {
    workDir: repo,
    system: "You are a git assistant.",
    user: "检查仓库状态",
    skills: skills.map((k) => ({ name: k.name, instructions: k.instructions })),
    maxSteps: 6,
    requestApproval: async () => false,
    onDelta: (d) => deltas.push(d),
  }, { provider: "openai", endpoint: `http://127.0.0.1:${addr.port}`, model: "mock", cliCommand: null, apiKey: null });
  check("工具循环端到端（tool_call → 执行 → 终答）", result.text.includes("最终回答") && result.steps.length === 2 &&
    result.steps[0].kind === "tool" && result.steps[0].tool === "repo.status" && (result.steps[0].result ?? "").includes("clean"),
    JSON.stringify(result.steps.map((s) => s.kind)));
  console.log("loop 后计数:", llmCallCount, "| result.text:", JSON.stringify(result.text.slice(0, 40)));
  check("SSE 流式（delta 透传 + 终文一致）", deltas.join("") === result.text && deltas.length === 4,
    `deltas=${deltas.length} joined=${deltas.join("")}`);
  check("技能注入系统提示", serverSeenSystem.includes("按技能") && serverSeenSystem.includes("简洁回答"),
    serverSeenSystem.slice(0, 60));

  // ---- E：statusbar 插槽 ----
  const mainJs = path.join(userRoot, "com.def.demo", "main.js");
  fs.writeFileSync(mainJs, [
    "module.exports = function activate(ctx) {",
    "  ctx.registerStatusItem('flag', { text: '🏳 D/E', tooltip: 'demo', command: 'repo.refresh' });",
    "};",
    "",
  ].join(NL));
  // 给包补 entry 再激活（直接改 manifest）
  const manifest = JSON.parse(fs.readFileSync(path.join(packDir, "manifest.json"), "utf8"));
  manifest.entry = "main.js";
  fs.writeFileSync(path.join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await host.activateAll(store, { allowCode: true });
  const items = host.listStatusItems();
  check("statusbar 插槽（L2 注册）", items.length === 1 && items[0].text === "🏳 D/E" && items[0].command === "repo.refresh",
    JSON.stringify(items));
  host.deactivate();
  check("deactivate 清空状态栏插槽", host.listStatusItems().length === 0);

  // ---- G：脚手架生成器 ----
  const scaffoldDir = path.join(tmp, "scaffold");
  execFileSync(process.execPath, [path.resolve(__dirname, "../../scripts/gen-plugin-scaffold.mjs"), scaffoldDir, "com.scaffold.test"], { stdio: "pipe" });
  const scaffoldManifest = JSON.parse(fs.readFileSync(path.join(scaffoldDir, "manifest.json"), "utf8"));
  check("脚手架产物（manifest 合法形状）", scaffoldManifest.schemaVersion === 2 && scaffoldManifest.id === "com.scaffold.test" &&
    fs.existsSync(path.join(scaffoldDir, "main.js")) && fs.existsSync(path.join(scaffoldDir, "i18n", "zh-Hans.json")));

  // 坏包目录（catalog error 路径）
  const badPack = path.join(userRoot, "com.def.broken");
  fs.mkdirSync(badPack, { recursive: true });
  fs.writeFileSync(path.join(badPack, "manifest.json"), "{ not json");

  // Anthropic 原生 tools 协议循环
  const aDeltas: string[] = [];
  const aResult = await runRegisteredLoop("builtin.tools.anthropic", {
    workDir: repo,
    system: "You are a git assistant.",
    user: "检查仓库状态",
    skills: [],
    maxSteps: 6,
    requestApproval: async () => false,
    onDelta: (d) => aDeltas.push(d),
  }, { provider: "anthropic", endpoint: `http://127.0.0.1:${addr.port}`, model: "mock", cliCommand: null, apiKey: null });
  check("Anthropic 原生 tools 循环（tool_use → tool_result → 终答）", aResult.text.includes("anthropic 流式最终回答：clean") &&
    aResult.steps.length === 2 && aResult.steps[0].tool === "repo.status",
    JSON.stringify(aResult.steps.map((x) => x.kind)));
  check("Anthropic SSE 流式（text_delta 透传）", aDeltas.filter((d) => d.includes("流式")).length === 1 &&
    aDeltas.join("").includes("最终回答"), aDeltas.join("|"));

  // G 收口：本地目录服务端到端
  const { spawn: spawnNode } = await import("child_process");
  const catPort = 17998;
  const serveProc = spawnNode(process.execPath, [path.resolve(__dirname, "../../scripts/serve-catalog.mjs"), userRoot, String(catPort)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
  try {
    const catResp = await fetch(`http://127.0.0.1:${catPort}/catalog.json`);
    const catJson = (await catResp.json()) as { packages: { id?: string; dir: string; state: string }[] };
    check("目录服务 catalog.json", catResp.ok && (catJson.packages ?? []).some((x: { id?: string }) => x.id === "com.def.demo"),
      JSON.stringify((catJson.packages ?? []).map((x: { id?: string; dir: string }) => x.id ?? x.dir)));
    const gpkResp = await fetch(`http://127.0.0.1:${catPort}/packs/com.def.demo.gpk`);
    check("目录服务 .gpk 下载", gpkResp.ok && (gpkResp.headers.get("content-disposition") ?? "").includes(".gpk"));
    const tmpGpk = path.join(tmp, "served.gpk");
    fs.writeFileSync(tmpGpk, Buffer.from(await gpkResp.arrayBuffer()));
    const servedImport = importGpkFile(tmpGpk, path.join(tmp, "served-install"));
    check("下载包经 importGpk 落地", servedImport.id === "com.def.demo", JSON.stringify(servedImport));
  } finally {
    serveProc.kill();
  }

  // G：catalog 生成器（宿主侧目录清单）
  const catalogPath = path.join(tmp, "catalog.json");
  execFileSync(process.execPath, [path.resolve(__dirname, "../../scripts/gen-catalog.mjs"), userRoot, catalogPath], { stdio: "pipe" });
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as { packages: { id?: string; dir: string; state: string; kinds?: string[]; checksum?: string }[] };
  const demoEntry = (catalog.packages ?? []).find((x) => x.id === "com.def.demo");
  check("catalog 生成器（宿主同源校验 + checksum）", !!demoEntry && demoEntry.state === "ok" &&
    (demoEntry.kinds ?? []).includes("skills") && String(demoEntry.checksum).startsWith("sha256:") &&
    (catalog.packages ?? []).some((x) => x.state === "error"),
    JSON.stringify(catalog.packages?.map((x) => [x.id ?? x.dir, x.state])));

  llm.close();
  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke 崩溃:", e);
  process.exit(1);
});
