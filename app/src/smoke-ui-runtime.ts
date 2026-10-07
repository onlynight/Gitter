/**
 * R0 UI 运行时无头烟雾（ui-full-pluginization-plan.md R0）：
 * a) checkCallerAccess 权限闭环（R0/A1）：声明 permissions 参与 __caller 强制、缺省回退 DEFAULT_PAGE_SCOPES
 * b) pagesOf 形状（R0-2/R0-7）：slot（显式与缺省）/styles/lazy/isBuiltIn
 * c) 停用守卫（R0-3/D4）：soleProviderSlotsAfterDisable——有替换者放行、最后提供者拦截
 * d) 静态守卫：bridge 门分离（内置页面包免 allowCodePlugins）+ extensions.changed 热刷新 + sdk __caller 携带
 * 运行：npm run build && node dist/smoke-ui-runtime.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { checkCallerAccess } from "./services/extensions/rpcScopes";
import { PackageStore } from "./services/extensions/store";

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

/** 造一个最小页面包（manifest + entry 占位 + style 占位）。 */
function writePagePackage(
  root: string,
  dirName: string,
  id: string,
  page: { id: string; slot?: string; permissions?: string[]; styles?: string[]; lazy?: boolean },
): void {
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    schemaVersion: 2,
    id,
    name: id,
    version: "1.0.0",
    contributes: {
      pages: [{
        id: page.id,
        title: `${id} 页`,
        entry: "page.js",
        ...(page.slot ? { slot: page.slot } : {}),
        ...(page.permissions ? { permissions: page.permissions } : {}),
        ...(page.styles ? { styles: page.styles } : {}),
        ...(page.lazy !== undefined ? { lazy: page.lazy } : {}),
      }],
    },
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "page.js"), "// entry");
}

function makeStore(builtinRoot: string, userRoot: string, ledger: Record<string, { enabled?: boolean; kinds?: Record<string, boolean> }> = {}): PackageStore {
  return new PackageStore([builtinRoot], [userRoot], "0.1.0", () => ledger);
}

async function main() {
  out("== R0 UI 运行时无头烟雾 ==\n");

  // ---- a) checkCallerAccess（R0/A1 权限闭环） ----
  out("-- a) checkCallerAccess --");
  check("声明 git.write 可调 changes.commit",
    checkCallerAccess("changes.commit", { packageId: "p", permissions: ["open", "git.write"] }).ok === true);
  check("声明缺省（回退 DEFAULT_PAGE_SCOPES）可读 log.query",
    checkCallerAccess("log.query", { packageId: "p" }).ok === true);
  check("声明缺省（回退 DEFAULT_PAGE_SCOPES）不可写 changes.commit",
    checkCallerAccess("changes.commit", { packageId: "p" }).ok === false);
  check("显式 git.read 声明不可写（不再回退缺省）",
    checkCallerAccess("changes.commit", { packageId: "p", permissions: ["git.read"] }).ok === false);
  check("open 域恒放行（无论声明）",
    checkCallerAccess("ui.panels", { packageId: "p", permissions: [] }).ok === true);
  const denied = checkCallerAccess("nope.method", { packageId: "p", permissions: ["git.write"] });
  check("未收录方法默认拒绝（extensions.admin）", !denied.ok && denied.ok === false && denied.scope === "extensions.admin");

  // ---- b) pagesOf 形状（fixture 包） ----
  out("\n-- b) pagesOf 形状 --");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-smoke-ui-"));
  try {
    const builtinRoot = path.join(tmp, "builtin");
    const userRoot = path.join(tmp, "user");
    fs.mkdirSync(builtinRoot, { recursive: true });
    fs.mkdirSync(userRoot, { recursive: true });
    writePagePackage(builtinRoot, "b-log", "gitui.page.log", { id: "log", slot: "log", styles: ["page.css"], lazy: true, permissions: ["git.write"] });
    writePagePackage(userRoot, "u-log", "user.log.replacement", { id: "main", slot: "log" });
    writePagePackage(userRoot, "u-own", "user.own.page", { id: "dashboard" });

    const store = makeStore(builtinRoot, userRoot);
    const pages = store.pagesOf();
    check("三个页面全部返回", pages.length === 3, JSON.stringify(pages.map((p) => p.id)));

    const bLog = pages.find((p) => p.packageId === "gitui.page.log");
    check("内置包页面 isBuiltIn=true + lazy 透传",
      !!bLog && bLog.isBuiltIn === true && bLog.lazy === true,
      bLog ? `isBuiltIn=${bLog.isBuiltIn} lazy=${bLog.lazy}` : "未找到");
    check("显式 slot 透传（内置页面包必须声明 slot 竞争内置槽位）",
      !!bLog && bLog.slot === "log");
    check("styles 解析为包内绝对路径",
      !!bLog && bLog.styles.length === 1 && bLog.styles[0] === path.join(builtinRoot, "b-log", "page.css"));
    check("permissions 声明透传",
      !!bLog && bLog.permissions.join(",") === "git.write");

    const uLog = pages.find((p) => p.packageId === "user.log.replacement");
    check("显式 slot 竞争内置槽位（替换声明）",
      !!uLog && uLog.slot === "log" && uLog.isBuiltIn === false);

    const uOwn = pages.find((p) => p.packageId === "user.own.page");
    check("无声明页 lazy 缺省 false",
      !!uOwn && uOwn.lazy === false && uOwn.slot === "ext.user.own.page.dashboard");

    // ---- c) 停用守卫（D4：槽位恒有 ≥1 已启用提供者） ----
    out("\n-- c) 停用守卫 --");
    check("替换者在位：停用内置 log 页放行",
      store.soleProviderSlotsAfterDisable("gitui.page.log").length === 0);
    check("停用独占槽位页（dashboard）返回该槽位",
      JSON.stringify(store.soleProviderSlotsAfterDisable("user.own.page")) === JSON.stringify(["ext.user.own.page.dashboard"]));
    check("停用未贡献页面的包返回空",
      store.soleProviderSlotsAfterDisable("no.such.package").length === 0);

    const store2 = makeStore(builtinRoot, userRoot, {
      "user.log.replacement": { kinds: { pages: false } },
    });
    const sole = store2.soleProviderSlotsAfterDisable("gitui.page.log");
    check("替换者被单独停用后：停用内置 log 页被拦（唯一提供者）",
      JSON.stringify(sole) === JSON.stringify(["log"]), JSON.stringify(sole));

    const store3 = makeStore(builtinRoot, userRoot, {
      "gitui.page.log": { kinds: { pages: false } },
    });
    check("已单独停用 pages 的包再停无新增影响",
      store3.soleProviderSlotsAfterDisable("gitui.page.log", "pages").length === 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- d) 静态守卫：bridge 门分离 / extensions.changed / sdk __caller 携带 ----
  out("\n-- d) 静态守卫（编译产物/源码 grep） --");
  const bridgeSrc = fs.readFileSync(path.resolve(__dirname, "bridge.js"), "utf8");
  check("extensions.pages：内置包免 allowCodePlugins 门（gate ? all : filter isBuiltIn）",
    bridgeSrc.includes("all.filter((p) => p.isBuiltIn)"));
  check("extensions.changed 事件存在（热刷新）",
    bridgeSrc.includes('emit("extensions.changed"'));
  check("停用守卫接入 setEnabled",
    bridgeSrc.includes("soleProviderSlotsAfterDisable"));
  const sdkSrc = fs.readFileSync(path.resolve(__dirname, "..", "..", "web", "src", "sdk.ts"), "utf8");
  check("sdk __caller 携带 permissions（R0/A1）",
    sdkSrc.includes("__caller: { packageId: packageId ?? \"\", permissions }"));
  check("registerPage 闭包捕获 permissions（挂载时模块变量已被重置——权限 denied 事故防回潮）",
    sdkSrc.includes("const permissions = loadingPermissions;") &&
    sdkSrc.includes("makeCtx(packageId, permissions)"));
  check("sdk context() 暴露共享上下文镜像（R2：context = repo + store.context 展开）",
    sdkSrc.includes("context: () => ({ repo: getState().repo, ...getState().context })"));

  out(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write("smoke 崩溃: " + String(e) + "\n");
  process.exit(1);
});
