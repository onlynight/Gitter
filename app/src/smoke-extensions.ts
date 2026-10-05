/**
 * 插件系统 v2 无头烟雾（extension-system-v2.md P1/P2/P3 验收）：
 * 不起窗口，直接驱动 PackageStore / ThemeService / gpk / CommandRegistry / GrammarService。
 * 运行：npm run build && node dist/smoke-extensions.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { zipSync, strToU8 } from "fflate";
import { PackageStore } from "./services/extensions/store";
import { ThemeService } from "./services/themes";
import { importGpkFile, uninstallPackageDir } from "./services/extensions/gpk";
import { CommandRegistry, BUILTIN_COMMANDS } from "./services/extensions/commands";
import { GrammarService, buildRawTheme } from "./services/extensions/grammar";

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

// ---- 固件：内置 v1 主题 + 用户 v2 语法/命令包 + 损坏包 + engines 不满足包 ----
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
    commands: [{ id: "ping", title: "Demo Ping", action: "terminal.run", args: { command: "echo hi" } },
               { id: "bad", title: "Bad Action", action: "fs.writeFile" }],
    configuration: [{ key: "level", type: "string", default: "stable", title: "等级" }],
  },
}, {
  "grammars/demo.json": JSON.stringify({
    scopeName: "source.demolang", name: "demolang",
    patterns: [
      { name: "comment.line.demolang", match: "#.*$" },
      { name: "string.quoted.double.demolang", match: "\"[^\"]*\"" },
    ],
  }),
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
  check("v2 包 active + kinds 推导", !!demo && demo.state === "active" &&
    JSON.stringify(demo.kinds.sort()) === JSON.stringify(["commands", "configuration", "grammar"]),
    demo ? demo.kinds.join("/") : "missing");
  const broken = list.find((p) => p.id?.startsWith("(损坏包)"));
  check("损坏包 → error + 原因", !!broken && broken.state === "error" && !!broken.reason,
    broken?.reason ?? "missing");
  const newer = list.find((p) => p.id === "com.test.neednewer");
  check("engines 不满足 → disabled + 原因", !!newer && newer.state === "disabled" && !!newer.reason,
    newer?.reason ?? "missing");
  const shadowed = list.find((p) => p.id === "gitui.theme.dark");
  check("用户包遮蔽内置包（同 id）", !!shadowed && shadowed.name === "深色（用户覆盖版）" && !shadowed.isBuiltIn,
    shadowed?.name ?? "missing");

  // 账本：整体禁用 + 按 kind 禁用
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

  // ---- P1：ThemeService（PackageStore 内核 + tokenColors）----
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

  // ---- P3：CommandRegistry ----
  const cmdStore = makeStore({});
  const reg = new CommandRegistry(BUILTIN_COMMANDS);
  check("内置命令自举（23 条）", reg.list().length === 23, `实际 ${reg.list().length}`);
  reg.registerPackageCommands(cmdStore);
  const ids = reg.list().map((c) => c.id);
  check("包命令注册（带 ext.<pkg>. 前缀）", ids.includes("ext.com.test.demo.ping") && ids.includes("ext.com.test.demo.bad"),
    ids.filter((i) => i.startsWith("ext.")).join(", "));
  let executed: string | null = null;
  await reg.execute("ext.com.test.demo.ping", async (action) => { executed = action; });
  check("L1 白名单命令执行", executed === "terminal.run", `executed=${executed}`);
  let forbidden = false;
  try { await reg.execute("ext.com.test.demo.bad", async () => {}); } catch { forbidden = true; }
  check("非白名单动作被拒", forbidden);
  // 禁用包的命令不注册
  const offReg = new CommandRegistry(BUILTIN_COMMANDS);
  offReg.registerPackageCommands(makeStore({ "com.test.demo": { enabled: false } }));
  check("禁用包命令不注册", !offReg.list().some((c) => c.id.startsWith("ext.")));

  // ---- P2：GrammarService（真实 WASM + tm-grammars + 用户语法）----
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
    const coloredRuns = tsResult?.lines[0]?.filter((r) => r.color && r.color.startsWith("#")) ?? [];
    check("tokenizeLine2 颜色解析（非零 foreground）", coloredRuns.length >= 2,
      coloredRuns.slice(0, 3).map((r) => r.color).join(" "));
    const colorsSeen = new Set(coloredRuns.map((r) => r.color?.toUpperCase()));
    check("语义配色命中（keyword=#569CD6 / comment=#6A9955）",
      colorsSeen.has("#569CD6") && colorsSeen.has("#6A9955"),
      [...colorsSeen].join(" "));
    check("TokenRun 边界覆盖整行", (() => {
      const runs = tsResult?.lines[0] ?? [];
      return runs.length > 0 && runs[0].start === 0 && runs[runs.length - 1].end === tsSrc.length;
    })());
    const demoSrc = "# a comment\n\"a string\"";
    const demoResult = await grammarSvc.highlight("readme.demolang", demoSrc, built);
    check("用户包语法参与解析", !!demoResult && demoResult.language === "demolang" &&
      (demoResult.lines[0]?.some((r) => r.color && r.color !== (demoResult.lines[1]?.[0]?.color ?? "")) ?? false),
      demoResult ? `line0 runs=${demoResult.lines[0]?.length}` : "null");
    // 未知扩展名 → null（降级链回退声明式）
    const unknown = await grammarSvc.highlight("data.xyzzy", "hello", built);
    check("无语法匹配 → null（降级链）", unknown === null);
    // 跨行块状态：JS 模板字符串跨行
    const multi = await grammarSvc.highlight("t.ts", "`line1\nline2`;", built);
    check("跨行块状态（StackElement）", !!multi && multi.lines.length === 2,
      multi ? `lines=${multi.lines.length}` : "null");
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

main().catch((e) => {
  console.error("smoke 崩溃:", e);
  process.exit(1);
});
