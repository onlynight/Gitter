/**
 * 插件系统 v2 无头烟雾（extension-system-v2.md P1/P2/P3 + §16.6 阶段 A 验收）：
 * 不起窗口，直接驱动 PackageStore / ThemeService / gpk / CommandRegistry / GrammarService
 * 及 A 阶段八条接缝（模板/when/确认/i18n/menus/keybindings/terminalProfiles/safetyRules）。
 * 运行：npm run build && node dist/smoke-extensions.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { zipSync, strToU8 } from "fflate";
import { PackageStore } from "./services/extensions/store";
import { ThemeService } from "./services/themes";
import { importGpkFile, uninstallPackageDir } from "./services/extensions/gpk";
import { BUILTIN_COMMANDS, CommandRegistry, evaluateWhen, interpolateString } from "./services/extensions/commands";
import { GrammarService, buildRawTheme } from "./services/extensions/grammar";
import { scanPackageRules } from "./services/safety";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-ext-smoke-"));
const builtinRoot = path.join(tmp, "builtin");
const userRoot = path.join(tmp, "user");
fs.mkdirSync(builtinRoot, { recursive: true });
fs.mkdirSync(userRoot, { recursive: true });

function writePack(root: string, dir: string, manifest: unknown, files: Record<string, string> = {}) {
  const p = path.join(root, dir);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(p, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
}

const APP_VERSION = "0.1.0";

// ---- 固件：内置 v1 主题 + 用户 v2 包（A 阶段全接缝）+ 损坏包 + engines 不满足包 ----
writePack(builtinRoot, "gitui.theme.dark", {
  schemaVersion: 1, id: "gitui.theme.dark", name: "深色", version: "1.0.0", kinds: ["theme"], theme: { base: "dark" },
}, {
  "theme/theme.json": JSON.stringify({
    id: "gitui.theme.dark", name: "深色", base: "dark", inherits: null,
    tokens: { Base: "#FF1E1F22" }, syntax: { keyword: "#569CD6", comment: "#6A9955" },
  }),
});
writePack(userRoot, "com.test.demo", {
  schemaVersion: 2, id: "com.test.demo", name: "Demo 包", version: "1.0.0",
  contributes: {
    grammars: [{ language: "demolang", extensions: [".demolang"], path: "grammars/demo.json" }],
    configuration: [{ key: "level", type: "string", default: "stable", title: "等级" }],
    commands: [
      { id: "ping", title: "%cmd.ping%", action: "terminal.run", args: { command: "echo hi" } },
      { id: "bad", title: "Bad Action", action: "fs.writeFile" },
      { id: "guarded", title: "Guarded", action: "terminal.run", args: { command: "echo guarded" } },
      { id: "templated", title: "Templated", when: "repoOpen config:level", action: "terminal.run", args: { command: "echo ${config.level} @ ${repo.path}" } },
      { id: "fileMenu", title: "File Cmd", when: "fileSelected", action: "shell.reveal", args: { path: "${file.path}" } },
    ],
    menus: [{ command: "ping", location: "logRow", order: 50 }],
    keybindings: [{ command: "ping", key: "Ctrl+Alt+9" }],
    terminalProfiles: [{ id: "nushell", name: "Nushell", command: "nu.exe", args: ["-l"] }],
    safetyRules: [{ id: "no-wip", pattern: "WIP: 放弃", flags: "", message: "发现 WIP 残留", fileExts: [".txt"] }],
  },
}, {
  "grammars/demo.json": JSON.stringify({
    scopeName: "source.demolang", name: "demolang",
    patterns: [
      { name: "comment.line.demolang", match: "#.*$" },
      { name: "string.quoted.double.demolang", match: "\"[^\"]*\"" },
    ],
  }),
  "i18n/zh-Hans.json": JSON.stringify({ "cmd.ping": "演示命令（中文）" }),
  "i18n/en.json": JSON.stringify({ "cmd.ping": "Demo Ping (en)" }),
});
writePack(userRoot, "com.test.broken", { id: "not-reverse-domain", name: "坏包" });
writePack(userRoot, "com.test.neednewer", {
  schemaVersion: 2, id: "com.test.neednewer", name: "需要新版本", version: "1.0.0",
  engines: { gitter: ">=99.0.0" }, contributes: {},
});
// 遮蔽测试：用户根放同 id 的 v2 包覆盖内置 v1 主题
writePack(userRoot, "gitui.theme.dark", {
  schemaVersion: 2, id: "gitui.theme.dark", name: "深色（用户覆盖版）", version: "2.0.0",
  contributes: { themes: [{ path: "theme/theme.json", base: "dark" }] },
}, {
  "theme/theme.json": JSON.stringify({
    id: "gitui.theme.dark", name: "深色（用户覆盖版）", base: "dark",
    tokens: { Base: "#FF101010" },
    tokenColors: [
      { scope: ["comment"], settings: { foreground: "#7F848E" } },
      { scope: ["keyword"], settings: { foreground: "#C678DD" } },
    ],
  }),
});

function makeStore(ledger: Record<string, unknown>) {
  return new PackageStore([builtinRoot], [userRoot], APP_VERSION, () => ledger as never);
}

async function main() {
  console.log(`== 插件系统 v2 无头烟雾 ==\nfixtures: ${tmp}\n`);

  // ---- P1：PackageStore ----
  const store = makeStore({});
  const list = store.list();
  check("扫描出 4 个包（含遮蔽与损坏）", list.length === 4, list.map((p) => p.id).join(", "));
  const demo = list.find((p) => p.id === "com.test.demo");
  check("v2 包 active + kinds 推导（含 A 阶段四 kind）", !!demo && demo.state === "active" &&
    ["commands", "configuration", "grammar", "menus", "keybindings", "terminalProfiles", "safetyRules"].every((k) => demo.kinds.includes(k)),
    demo ? demo.kinds.join("/") : "missing");
  const broken = list.find((p) => p.id?.startsWith("(损坏包)"));
  check("损坏包 → error + 原因", !!broken && broken.state === "error" && !!broken.reason, broken?.reason ?? "missing");
  const newer = list.find((p) => p.id === "com.test.neednewer");
  check("engines 不满足 → disabled + 原因", !!newer && newer.state === "disabled" && !!newer.reason, newer?.reason ?? "missing");
  const shadowed = list.find((p) => p.id === "gitui.theme.dark");
  check("用户包遮蔽内置包（同 id）", !!shadowed && shadowed.name === "深色（用户覆盖版）" && !shadowed.isBuiltIn, shadowed?.name ?? "missing");

  // ---- 账本 / 配置 ----
  const ledgerStore = makeStore({ "com.test.demo": { enabled: false } });
  const demoOff = ledgerStore.list().find((p) => p.id === "com.test.demo");
  check("账本整体禁用", !!demoOff && demoOff.state === "disabled", demoOff?.state);
  const kindLedger = makeStore({ "com.test.demo": { kinds: { grammar: false } } });
  const demoKind = kindLedger.list().find((p) => p.id === "com.test.demo");
  check("按 kind 禁用（grammar=false）", !!demoKind && demoKind.kindStates.grammar === false && demoKind.kindStates.commands === true,
    JSON.stringify(demoKind?.kindStates));
  check("kindEnabled 查询", kindLedger.kindEnabled("com.test.demo", "commands") === true &&
    kindLedger.kindEnabled("com.test.demo", "grammar") === false);
  check("configOf 缺省值", (makeStore({}).configOf("com.test.demo") as { level?: string }).level === "stable");
  check("configOf 账本覆盖", (makeStore({ "com.test.demo": { config: { level: "beta" } } }).configOf("com.test.demo") as { level?: string }).level === "beta");

  // ---- P1：ThemeService ----
  const themes = new ThemeService(store);
  const themeList = themes.list();
  check("主题列表（v1 内置被遮蔽 → 用户覆盖版）", themeList.length === 1 && themeList[0].name === "深色（用户覆盖版）" && !themeList[0].isBuiltIn,
    themeList.map((t) => t.name).join(", "));
  const resolved = themes.resolve("gitui.theme.dark", "dark");
  check("resolve 合并 tokens + tokenColors", resolved.tokens.Base === "#FF101010" &&
    resolved.tokenColors?.length === 2 && resolved.activeId === "gitui.theme.dark",
    `Base=${resolved.tokens.Base} tokenColors=${resolved.tokenColors?.length}`);
  const disabledThemes = new ThemeService(makeStore({ "gitui.theme.dark": { enabled: false } }));
  const fallback = disabledThemes.resolve("gitui.theme.dark", "light");
  check("主题禁用 → 内置兜底（activeId=null，base=回退）", fallback.activeId === null && fallback.base === "light",
    `activeId=${fallback.activeId} base=${fallback.base}`);

  // ---- P1：gpk 导入/卸载 ----
  const gpkUserRoot = path.join(tmp, "gpk-user");
  fs.mkdirSync(gpkUserRoot, { recursive: true });
  const gpkBytes = zipSync({
    "manifest.json": strToU8(JSON.stringify({
      schemaVersion: 2, id: "com.gpk.imported", name: "GPK 导入包", version: "1.0.0",
      contributes: { commands: [{ id: "hi", title: "Say hi", action: "terminal.run", args: { command: "hi" } }] },
    })),
    "preview.txt": strToU8("hello"),
    "../evil.txt": strToU8("zip-slip"),
  });
  const gpkPath = path.join(tmp, "com.gpk.imported.gpk");
  fs.writeFileSync(gpkPath, gpkBytes);
  const imported = importGpkFile(gpkPath, gpkUserRoot);
  check("gpk 导入成功", imported.id === "com.gpk.imported", JSON.stringify(imported));
  check("gpk 解包落盘", fs.existsSync(path.join(gpkUserRoot, "com.gpk.imported", "preview.txt")));
  check("zip-slip 条目被拒", !fs.existsSync(path.join(gpkUserRoot, "evil.txt")) &&
    !fs.existsSync(path.join(gpkUserRoot, "com.gpk.imported", "..", "evil.txt")));
  const badGpk = path.join(tmp, "bad.gpk");
  fs.writeFileSync(badGpk, zipSync({ "readme.txt": strToU8("no manifest") }));
  let threw = false;
  try { importGpkFile(badGpk, gpkUserRoot); } catch { threw = true; }
  check("缺 manifest 的 gpk 拒载", threw);
  const gpkStore = new PackageStore([], [gpkUserRoot], APP_VERSION, () => ({}) as never);
  check("导入后可扫描", gpkStore.list().some((p) => p.id === "com.gpk.imported" && p.kindStates.commands === true));
  uninstallPackageDir(path.join(gpkUserRoot, "com.gpk.imported"));
  check("卸载删除目录", !fs.existsSync(path.join(gpkUserRoot, "com.gpk.imported")));

  // ---- P3 + 阶段 A：CommandRegistry ----
  const cmdStore = makeStore({});
  const reg = new CommandRegistry(BUILTIN_COMMANDS);
  check("内置命令自举（25 条）", reg.list().length === 25, `实际 ${reg.list().length}`);
  reg.registerPackageCommands(cmdStore);
  const ids = reg.list().map((c) => c.id);
  check("包命令注册（带 ext.<pkg>. 前缀）", ids.includes("ext.com.test.demo.ping") && ids.includes("ext.com.test.demo.bad"),
    ids.filter((i) => i.startsWith("ext.")).join(", "));

  // A：i18n %key% 解析
  const zhList = reg.list({ lang: "zh-Hans" });
  const enList = reg.list({ lang: "en" });
  const zhPing = zhList.find((c) => c.id === "ext.com.test.demo.ping");
  const enPing = enList.find((c) => c.id === "ext.com.test.demo.ping");
  check("包 i18n %key% 解析（zh/en）", zhPing?.title === "演示命令（中文）" && enPing?.title === "Demo Ping (en)",
    `${zhPing?.title} / ${enPing?.title}`);

  // A：when 表达式（宿主求值 enabled）
  const noCtx = reg.list({ repoOpen: false, fileSelected: false });
  const repoCtx = reg.list({ repoOpen: true, fileSelected: false });
  const fileCtx = reg.list({ repoOpen: true, fileSelected: true });
  const fileCmd = (l: typeof noCtx) => l.find((c) => c.id === "ext.com.test.demo.fileMenu");
  const openIn = (l: typeof noCtx) => l.find((c) => c.id === "file.openInEditor");
  check("when=fileSelected 宿主求值", fileCmd(noCtx)?.enabled === false && fileCtx.find((c) => c.id === "ext.com.test.demo.fileMenu")?.enabled === true);
  check("when=repoOpen+config:level 求值", repoCtx.find((c) => c.id === "ext.com.test.demo.templated")?.enabled === true);
  check("内置文件命令同样走 when 接缝（自举）", openIn(noCtx)?.enabled === false && fileCtx.find((c) => c.id === "file.openInEditor")?.enabled === true);
  check("evaluateWhen 否定/未知 token", evaluateWhen("!repoOpen", { repoOpen: true, fileSelected: false }) === false &&
    evaluateWhen("config:nope", { repoOpen: true, fileSelected: false }, "com.test.demo") === false &&
    evaluateWhen("unknownToken", { repoOpen: true, fileSelected: false }) === false);

  // A：模板插值（config.* 自动合并 + 执行期 vars）
  check("interpolateString", interpolateString("a ${repo.path} b ${config.level} c ${nope}", { "repo.path": "D:/x", "config.level": "beta" }) === "a D:/x b beta c ");

  // A：确认流 + 执行
  let executed: { action: string; args: unknown } | null = null;
  const exec = async (action: string, args: unknown) => { executed = { action, args }; };
  const pingResult = await reg.execute("ext.com.test.demo.ping", exec, { confirmed: true, vars: { "repo.path": "D:/r" } });
  check("terminal.run 类命令缺省 confirm 标记", reg.list().find((c) => c.id === "ext.com.test.demo.ping")?.confirm === true);
  check("L1 白名单命令执行", pingResult.status === "ok" && (executed as { action: string } | null)?.action === "terminal.run");
  const guardedFirst = await reg.execute("ext.com.test.demo.guarded", exec);
  check("terminal.run 缺省首跑确认", guardedFirst.status === "confirm-required", JSON.stringify(guardedFirst));
  const confirmedIds: string[] = [];
  const guardedOk = await reg.execute("ext.com.test.demo.guarded", exec, {
    confirmed: true, markConfirmed: (id) => confirmedIds.push(id),
  });
  check("确认后执行 + 记录账本回调", guardedOk.status === "ok" && confirmedIds.includes("ext.com.test.demo.guarded"));
  let forbidden = false;
  try { await reg.execute("ext.com.test.demo.bad", exec); } catch { forbidden = true; }
  check("非白名单动作被拒", forbidden);

  // A：模板命令执行（config.* 由 registry 合并）
  let tplArgs: unknown = null;
  await reg.execute("ext.com.test.demo.templated", async (_a, args) => { tplArgs = args; }, { confirmed: true, vars: { "repo.path": "D:/repo" } });
  check("模板插值执行（config + repo）", JSON.stringify(tplArgs) === JSON.stringify({ command: "echo stable @ D:/repo" }), JSON.stringify(tplArgs));

  // A：menus 接缝（内置自举 + 包贡献）
  const fileMenus = reg.menusList("changesFile", { fileSelected: true });
  const logMenus = reg.menusList("logRow", { lang: "zh-Hans", repoOpen: true });
  check("内置菜单走接缝（changesFile 两项）", fileMenus.some((m) => m.command === "file.openInEditor") &&
    fileMenus.some((m) => m.command === "file.revealInExplorer"), fileMenus.map((m) => m.command).join(","));
  check("包菜单注册（logRow）", logMenus.some((m) => m.id === "ext.com.test.demo.ping" && m.title === "演示命令（中文）" && m.packageId === "com.test.demo"),
    logMenus.map((m) => m.id).join(","));

  // A：keybindings 接缝
  const kb = zhList.find((c) => c.id === "ext.com.test.demo.ping")?.keyHint;
  check("包键位附加 keyHint", kb === "Ctrl+Alt+9", kb ?? "无");

  // 禁用包的派生全消失
  const offReg = new CommandRegistry(BUILTIN_COMMANDS);
  offReg.registerPackageCommands(makeStore({ "com.test.demo": { enabled: false } }));
  check("禁用包的命令/菜单全下线", !offReg.list().some((c) => c.id.startsWith("ext.")) &&
    !offReg.menusList("logRow", {}).some((m) => m.packageId === "com.test.demo"));

  // ---- A：terminalProfiles 接缝 ----
  const profiles = cmdStore.terminalProfiles();
  check("终端档位注册（ext.<pkg>.<id>）", profiles.length === 1 && profiles[0].id === "ext.com.test.demo.nushell" && profiles[0].command === "nu.exe",
    JSON.stringify(profiles));
  const offProfiles = makeStore({ "com.test.demo": { kinds: { terminalProfiles: false } } }).terminalProfiles();
  check("档位 kind 禁用 → 下线", offProfiles.length === 0);

  // ---- A：safetyRules 接缝（warn-only）----
  const rules = cmdStore.safetyRules();
  check("安全网规则包编译", rules.length === 1 && rules[0].id === "pkg.com.test.demo.no-wip", JSON.stringify(rules.map((r) => r.id)));
  const findings = scanPackageRules(
    [{ path: "a.txt", patch: "@@ -1,2 +1,3 @@\n ok\n+WIP: 放弃\n+done", isBinary: false, isNew: false, addedLines: 2, deletedLines: 0 },
     { path: "b.ts", patch: "@@ -1 +1,2 @@\n+WIP: 放弃", isBinary: false, isNew: false, addedLines: 1, deletedLines: 0 }],
    rules,
  );
  check("规则包扫描命中（.txt 命中 / .ts 跳过）", findings.length === 1 && findings[0].severity === "warning" &&
    findings[0].line === 2 && findings[0].filePath === "a.txt", JSON.stringify(findings));
  check("包规则无否决权（恒 warning）", findings.every((f) => f.severity !== "blocked"));

  // ---- P2：GrammarService ----
  const grammarRoot = tryResolve("tm-grammars/grammars/typescript.json");
  const onigWasm = tryResolve("vscode-oniguruma/release/onig.wasm");
  if (!grammarRoot || !onigWasm) {
    check("TextMate 数据可用（tm-grammars/oniguruma）", false, "npm 数据包缺失");
  } else {
    const grammarSvc = new GrammarService(cmdStore, path.dirname(grammarRoot), onigWasm);
    grammarSvc.registerUserGrammars();
    const tsSrc = "const x = 1; // trailing comment";
    const built = buildRawTheme({ activeId: "gitui.theme.dark", syntax: { keyword: "#569CD6", comment: "#6A9955", number: "#B5CEA8" }, tokenColors: null });
    const tsResult = await grammarSvc.highlight("src/app.ts", tsSrc, built);
    check("TextMate 分词 TypeScript", !!tsResult && tsResult.language === "typescript", tsResult ? `${tsResult.lines[0]?.length} runs` : "null");
    const colorsSeen = new Set((tsResult?.lines[0] ?? []).filter((r) => r.color).map((r) => r.color?.toUpperCase()));
    check("语义配色命中（keyword=#569CD6 / comment=#6A9955）", colorsSeen.has("#569CD6") && colorsSeen.has("#6A9955"),
      [...colorsSeen].join(" "));
    check("TokenRun 边界覆盖整行", (() => {
      const runs = tsResult?.lines[0] ?? [];
      return runs.length > 0 && runs[0].start === 0 && runs[runs.length - 1].end === tsSrc.length;
    })());
    const demoResult = await grammarSvc.highlight("readme.demolang", "# a comment\n\"a string\"", built);
    check("用户包语法参与解析", !!demoResult && demoResult.language === "demolang",
      demoResult ? `line0 runs=${demoResult.lines[0]?.length}` : "null");
    const unknown = await grammarSvc.highlight("data.xyzzy", "hello", built);
    check("无语法匹配 → null（降级链）", unknown === null);
    const multi = await grammarSvc.highlight("t.ts", "`line1\nline2`;", built);
    check("跨行块状态（StackElement）", !!multi && multi.lines.length === 2, multi ? `lines=${multi.lines.length}` : "null");
  }

  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

function tryResolve(spec: string): string | null {
  try {
    return require.resolve(spec);
  } catch {
    return null;
  }
}

void main().catch((e) => {
  console.error("smoke 崩溃:", e);
  process.exit(1);
});
