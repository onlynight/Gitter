/**
 * 外部插件装载链路无头验证（markdown-preview / html-preview 样例，extension-system-v2.md
 * L2 契约）：PackageStore 扫描真实用户插件根（%APPDATA%/gitter-app/packages）→ zod
 * manifest → PluginHost activateAll(allowCode) → require entry → registerPreviewProvider
 * 生效 → findPreviewProvider(".md"/".html") → md 走 markdown-it 渲染、html 原文透传 +
 * 越界拒绝。前置：node plugins/markdown-preview/build.mjs --install &&
 * node plugins/html-preview/build.mjs --install
 * 运行：npm run build && node dist/smoke-md-plugin.js
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PackageStore } from "./services/extensions/store";
import { PluginHost } from "./services/extensions/host";
import { BUILTIN_COMMANDS, CommandRegistry } from "./services/extensions/commands";
import { ToolRegistry } from "./services/extensions/tools";
import { EventBus } from "./services/extensions/events";
import { PluginStorage } from "./services/extensions/storage";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function main() {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  const userRoot = path.join(appData, "gitter-app", "packages");
  if (!fs.existsSync(userRoot)) {
    console.log(`[FAIL] 用户插件根不存在：${userRoot}（先跑 node plugins/markdown-preview/build.mjs --install）`);
    process.exit(1);
  }

  // 1. 包扫描：真实用户根 → manifest zod → active
  const store = new PackageStore([], [userRoot], "0.1.0", () => ({}));
  const pkg = store.list().find((p) => p.id === "com.gitter.markdown-preview");
  check("用户包扫描并激活", !!pkg && pkg.state === "active", pkg ? `state=${pkg.state} kinds=${JSON.stringify(pkg.kinds)}` : "未找到");

  // 2. 宿主激活（信任门开启）：require entry → provider 注册
  const host = new PluginHost({
    registry: new CommandRegistry(BUILTIN_COMMANDS),
    tools: new ToolRegistry([]),
    events: new EventBus(),
    storage: new PluginStorage(fs.mkdtempSync(path.join(os.tmpdir(), "gitter-mdplugin-"))),
    notify: () => {},
  });
  await host.activateAll(store, { allowCode: true });
  const st = host.status().find((s) => s.packageId === "com.gitter.markdown-preview");
  check("entry 装载成功", !!st && st.active, st?.error ?? undefined);

  // 信任门关闭：entry 不装载（L2 只走审核渠道）
  const host2 = new PluginHost({
    registry: new CommandRegistry(BUILTIN_COMMANDS),
    tools: new ToolRegistry([]),
    events: new EventBus(),
    storage: new PluginStorage(fs.mkdtempSync(path.join(os.tmpdir(), "gitter-mdplugin-"))),
    notify: () => {},
  });
  await host2.activateAll(store, { allowCode: false });
  check("信任门关闭时不装载", host2.findPreviewProvider("a.md") === null);

  // 3. provider 行为：渲染 / 越界拒绝 / 扩展名不命中
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-mdplugin-repo-"));
  fs.writeFileSync(path.join(repo, "sample.md"), "# 标题\n\n**加粗** 与 `code`。\n");
  const provider = host.findPreviewProvider("docs/readme.md");
  check("provider 命中 .md（子目录路径）", !!provider);
  const r = provider ? await provider("sample.md", { repo }) : null;
  check("返回 html 形态", !!r && r.kind === "html", r ? `kind=${r.kind}` : "null");
  const html = r && r.kind === "html" ? r.content : "";
  check("渲染 h1/strong/code", html.includes("<h1>") && html.includes("<strong>") && html.includes("<code>"));
  fs.writeFileSync(path.join(repo, "xss.md"), "<script>alert(1)</script>\n\n![](https://x/y.png)\n");
  const r3 = provider ? await provider("xss.md", { repo }) : null;
  const html3 = r3 && r3.kind === "html" ? r3.content : "";
  check("内联 HTML 被转义（html:false）", r3 !== null && !html3.includes("<script>"), html3.slice(0, 80));
  const rOut = provider ? await provider("../outside.md", { repo }) : null;
  check("越界路径拒绝", rOut === null);
  check("未注册扩展名不命中", host.findPreviewProvider("a.txt") === null);

  // 4. html-preview 链路：包扫描 → entry 装载 → 原文透传 / 越界拒绝 / 扩展名命中面
  const pkgHtml = store.list().find((p) => p.id === "com.gitter.html-preview");
  check("html 包扫描并激活", !!pkgHtml && pkgHtml.state === "active", pkgHtml ? `state=${pkgHtml.state}` : "未找到");
  const stHtml = host.status().find((s) => s.packageId === "com.gitter.html-preview");
  check("html entry 装载成功", !!stHtml && stHtml.active, stHtml?.error ?? undefined);
  const providerHtml = host.findPreviewProvider("docs/index.html");
  check("provider 命中 .html（子目录路径）", !!providerHtml);
  check("provider 命中 .htm", !!host.findPreviewProvider("a.htm"));
  fs.writeFileSync(path.join(repo, "sample.html"), "<!doctype html><html><body><h1>hi</h1><script>1</script></body></html>\n");
  const rh = providerHtml ? await providerHtml("sample.html", { repo }) : null;
  check("返回 html 形态且原文透传（含脚本原文）", !!rh && rh.kind === "html" && rh.content.includes("<script>1</script>"),
    rh ? `kind=${rh.kind}` : "null");
  const rhOut = providerHtml ? await providerHtml("../outside.html", { repo }) : null;
  check("html 越界路径拒绝", rhOut === null);

  console.log(failures === 0 ? "\n外部插件链路全部通过" : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
