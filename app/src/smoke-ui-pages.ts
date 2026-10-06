/**
 * R9 内置页面包无头烟雾（ui-full-pluginization-plan.md R2–R9 验收）：
 * a) 包齐备：resources/packages 下七个 gitui.page.* 全部有效、slot 显式声明、lazy 装载、
 *    pagesOf() 返回七个内置槽位（"内置走接缝"自举断言——宿主 bundle 零页面代码后这是唯一来源）
 * b) 权限足迹：页面源码实际 RPC 调用面（字面 grep + surface 面补充）⊆ manifest 声明
 * c) 入口产物：page.js 存在且不打包 react（externals 单例断言）
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

  out(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write("smoke 崩溃: " + String(e) + "\n");
  process.exit(1);
});
