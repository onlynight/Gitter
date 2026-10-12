/**
 * R9 内置页面包无头烟雾（ui-full-pluginization-plan.md R2–R9 验收）：
 * a) 包齐备：resources/packages 下七个 gitui.page.* 全部有效、slot 显式声明、lazy 装载、
 *    pagesOf() 返回七个内置槽位（"内置走接缝"自举断言——宿主 bundle 零页面代码后这是唯一来源）
 * b) 权限足迹：页面源码实际 RPC 调用面（字面 grep + surface 面补充）⊆ manifest 声明
 * c) 入口产物：page.js 存在且不打包 react（externals 单例断言）
 * d) 重资产拆分产物（GITTER_LIBS，页面包拆分方案 S2/S3/S5）：页面包零重资产字节、
 *    库包唯一副本、monaco/chart 版本双点一致、echarts 已从 officeview 剥离（stub 化）、
 *    依赖声明（含 chart 可选依赖）真实解析全 ok
 * 运行：npm run build && node dist/smoke-ui-pages.js
 */
import * as fs from "fs";
import * as path from "path";
import { PackageStore } from "./services/extensions/store";
import { requiredScope, RPC_SCOPES } from "./services/extensions/rpcScopes";

/** 测试报告通道：CLI 运行器直写 stdout（非 console 调试通道——安全网调试残留规则针对后者） */
const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  out(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PACKAGES_ROOT = path.resolve(__dirname, "..", "resources", "packages");
const SLOTS = ["projects", "log", "changes", "branches", "tasks", "bash", "settings"];

async function main() {
  out("== R9 内置页面包无头烟雾 ==\n");

  // ---- a) 包齐备 + pagesOf（真实 PackageStore 扫描 resources/packages） ----
  const store = new PackageStore([PACKAGES_ROOT], [], "0.1.0", () => ({}));
  const pages = store.pagesOf();
  const bySlot = new Map(pages.filter((p) => p.isBuiltIn && p.packageId.startsWith("gitui.page.")).map((p) => [p.slot, p]));
  check("七个内置槽位全部由 gitui.page.* 提供（内置走接缝）",
    SLOTS.every((s) => bySlot.has(s)),
    SLOTS.map((s) => `${s}=${bySlot.has(s) ? "✓" : "✗"}`).join(" "));
  check("全部显式声明 slot + lazy 装载",
    SLOTS.every((s) => bySlot.get(s)?.lazy === true));
  check("全部携带图标（icon 字形或 svg 二选一）",
    SLOTS.every((s) => !!(bySlot.get(s)?.icon || bySlot.get(s)?.svg)),
    SLOTS.map((s) => `${s}=${bySlot.get(s)?.icon ? "glyph" : bySlot.get(s)?.svg ? "svg" : "✗"}`).join(" "));

  // ---- b) 权限足迹 ⊆ 声明 ----
  // 字面 call("...") 之外，surface 面方法也会发起 RPC（openRepo→projects.open 等）
  const SURFACE_RPC: Record<string, string[]> = {
    projects: ["projects.open"],
    log: ["projects.open", "projects.list", "menus.list", "commands.exec"],
    changes: ["projects.open", "projects.list", "menus.list", "commands.exec", "log.detail"],
    branches: ["projects.open", "projects.list", "menus.list", "commands.exec"],
    tasks: ["projects.open", "projects.list", "menus.list", "commands.exec"],
    bash: [],
    settings: ["projects.open", "projects.list", "themes.state", "settings.set", "settings.get", "menus.list", "commands.exec"],
  };
  out("\n-- b) 权限足迹 ⊆ manifest 声明 --");
  for (const slot of SLOTS) {
    const pkg = bySlot.get(slot);
    if (!pkg) continue;
    const srcPath = path.join(REPO_ROOT, "web", "src", "pages", `${slot === "bash" ? "Terminal" : slot[0].toUpperCase() + slot.slice(1)}Page.tsx`);
    const src = fs.readFileSync(srcPath, "utf8");
    const used = new Set<string>();
    for (const m of src.matchAll(/call(?:<[^>]*>)?\(\s*"([a-zA-Z.]+)"/g)) used.add(m[1]);
    for (const r of SURFACE_RPC[slot] ?? []) used.add(r);
    const declared = new Set(pkg.permissions);
    const missing = [...used]
      .filter((m) => RPC_SCOPES[m] !== undefined)
      .filter((m) => requiredScope(m) !== "open" && !declared.has(requiredScope(m)));
    check(`${slot}：${used.size} 个 RPC 调用面 ⊆ 声明 [${pkg.permissions.join(",")}]`,
      missing.length === 0, missing.length ? `缺声明: ${missing.map((m) => `${m}(${requiredScope(m)})`).join(", ")}` : "覆盖完整");
  }

  // ---- c) 入口产物：page.js 存在且 react 外置 ----
  out("\n-- c) 入口产物（page.js 存在 + react externals） --");
  for (const slot of SLOTS) {
    const js = path.join(PACKAGES_ROOT, `gitui.page.${slot}`, "page.js");
    const exists = fs.existsSync(js);
    const bundlesReact = exists && /\bnode_modules\b|function React|var React\s*=/.test(fs.readFileSync(js, "utf8").slice(0, 4000)) &&
      /jsxRuntime:\s*window\.GITTER_KIT|window\.GITTER_KIT\.ReactJSXRuntime/.test(fs.readFileSync(js, "utf8")) === false;
    const usesKitGlobals = exists && fs.readFileSync(js, "utf8").includes("window.GITTER_KIT.React");
    check(`gitui.page.${slot}/page.js 存在且 react 走 GITTER_KIT globals`,
      exists && usesKitGlobals && !bundlesReact, exists ? `${(fs.statSync(js).size / 1024).toFixed(0)}KB` : "缺失");
  }

  // ---- d) 重资产拆分产物（GITTER_LIBS 机制，页面包拆分方案 S2/S3/S5）----
  // files/office 两页的重资产（Monaco / office 预览运行时）拆为库包：
  // 页面包零重资产字节（尺寸 + 标记断言），库包唯一副本，依赖声明经真实 store 解析全 ok。
  out("\n-- d) 重资产拆分产物（GITTER_LIBS） --");
  const pkgDir = (id: string) => path.join(PACKAGES_ROOT, id);
  const readPkg = (id: string, file: string): string => {
    const p = path.join(pkgDir(id), file);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  };
  const MB = 1024 * 1024;

  const libs = store.librariesOf();
  const libById = new Map(libs.map((l) => [l.id, l]));
  check("库贡献齐备：monaco（gitui.lib.monaco）+ officeview（gitui.page.office）+ chart（gitui.lib.chart）",
    libById.get("monaco")?.packageId === "gitui.lib.monaco" && libById.get("officeview")?.packageId === "gitui.page.office" &&
    libById.get("chart")?.packageId === "gitui.lib.chart",
    libs.map((l) => `${l.id}→${l.packageId}`).join(", "));

  const webPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "web", "package.json"), "utf8"));
  const monacoDep = String(webPkg.dependencies["monaco-editor"]).replace(/^[^\d]*/, "");
  const monacoManifest = JSON.parse(readPkg("gitui.lib.monaco", "manifest.json") || "{}");
  check("monaco 库 manifest 版本与 web/package.json 一致（升 Monaco 双点同步）",
    monacoManifest.contributes?.libraries?.[0]?.version === monacoDep,
    `manifest=${monacoManifest.contributes?.libraries?.[0]?.version} package.json=${monacoDep}`);

  const echartsDep = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "web", "node_modules", "echarts", "package.json"), "utf8")).version as string;
  const chartManifest = JSON.parse(readPkg("gitui.lib.chart", "manifest.json") || "{}");
  check("chart 库 manifest 版本与 node_modules echarts 一致（升 echarts 双点同步）",
    chartManifest.contributes?.libraries?.[0]?.version === echartsDep,
    `manifest=${chartManifest.contributes?.libraries?.[0]?.version} node_modules=${echartsDep}`);

  const filesJs = readPkg("gitui.page.files", "page.js");
  check("gitui.page.files/page.js 零 monaco 字节（MonacoEnvironment 标记）",
    filesJs.length > 0 && !filesJs.includes("MonacoEnvironment"));
  check("gitui.page.files/page.js 零 office 预览运行时字节（pdfjs/SheetJS 标记）",
    !/pdfjs|SheetJS/.test(filesJs));
  check("gitui.page.files/page.js ≤ 1.5MB（重资产已拆出）",
    filesJs.length > 0 && filesJs.length <= 1.5 * MB, `${(filesJs.length / 1024).toFixed(0)}KB`);

  const monacoJs = readPkg("gitui.lib.monaco", "monaco.js");
  check("gitui.lib.monaco/monaco.js 存在且含 worker 装配 + GITTER_LIBS 注册",
    monacoJs.includes("MonacoEnvironment") && monacoJs.includes("GITTER_LIBS"),
    `${(monacoJs.length / MB).toFixed(1)}MB`);

  const officeviewJs = readPkg("gitui.page.office", "officeview.js");
  check("gitui.page.office/officeview.js 为库 wrapper（runtimeJs + srcdocScripts 唯一副本）",
    officeviewJs.startsWith("(window.GITTER_LIBS=window.GITTER_LIBS||{}).officeview=") &&
    officeviewJs.includes("runtimeJs") && officeviewJs.includes("srcdocScripts"),
    `${(officeviewJs.length / MB).toFixed(1)}MB`);
  check("officeview stub 委托在位（GITTER_CHART 字样）且零 echarts 内部符号（SeriesModel/CoordinateSystem）",
    officeviewJs.includes("GITTER_CHART") && !officeviewJs.includes("SeriesModel") && !officeviewJs.includes("CoordinateSystem"));

  const chartJs = readPkg("gitui.lib.chart", "chart.js");
  check("gitui.lib.chart/chart.js 为字符串资产 wrapper 且含 echarts 本体（GITTER_CHART 注册串 + 内部符号）",
    chartJs.startsWith("(window.GITTER_LIBS=window.GITTER_LIBS||{}).chart=") &&
    chartJs.includes("version") && chartJs.includes("SeriesModel"),
    `${(chartJs.length / MB).toFixed(1)}MB`);

  const officeJs = readPkg("gitui.page.office", "page.js");
  check("gitui.page.office/page.js 零预览运行时字节（pdfjs/SheetJS 标记）",
    officeJs.length > 0 && !/pdfjs|SheetJS/.test(officeJs), `${(officeJs.length / 1024).toFixed(0)}KB`);

  const filesPage = pages.find((p) => p.packageId === "gitui.page.files");
  const officePage = pages.find((p) => p.packageId === "gitui.page.office");
  const chartDepOk = (p: (typeof pages)[number] | undefined) => {
    const d = p?.dependencies.find((x) => x.lib === "chart");
    return !!d && d.ok === true && d.required === false && d.packageId === "gitui.lib.chart";
  };
  check("files 页依赖 monaco + officeview + chart(可选) 全部解析 ok（真实包扫描）",
    filesPage !== undefined && filesPage.dependencies.length >= 3 && filesPage.dependencies.every((d) => d.ok) && chartDepOk(filesPage),
    filesPage?.dependencies.map((d) => `${d.lib}:${d.ok ? "✓" : d.reason}${d.required ? "" : "(可选)"}`).join(", ") ?? "页面未找到");
  check("office 页自依赖 officeview + chart(可选) 解析 ok",
    officePage?.dependencies.length === 2 && officePage.dependencies.every((d) => d.ok) && chartDepOk(officePage),
    officePage?.dependencies.map((d) => `${d.lib}:${d.ok ? "✓" : d.reason}${d.required ? "" : "(可选)"}`).join(", ") ?? "页面未找到");
  check("chart 可选依赖不触发依库停用守卫（required:false 语义）",
    store.dependentPagesAfterDisable("gitui.lib.chart").length === 0,
    JSON.stringify(store.dependentPagesAfterDisable("gitui.lib.chart")));

  out(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write("smoke 崩溃: " + String(e) + "\n");
  process.exit(1);
});
