#!/usr/bin/env node
/**
 * 内置页面构建（ui-full-pluginization-plan.md R2/R2c）：
 * 九个页面各自构建为 IIFE 经典脚本 → app/resources/packages/gitui.page.<slot>/page.js。
 * - react 系（react / jsx-runtime / react-dom(+/client)）声明为 window.GITTER_KIT.* globals
 *   external——与宿主（kitGlobal.ts 组装的单实例）三方共享同一 React；
 * - "../pageSdk" / "../kit" / "../commands" 构建期映射到 src/external/* 适配层（window 面），
 *   页面产物不打包任何宿主模块；
 * - 重资产库独立包化（GITTER_LIBS 机制，页面包拆分方案 S2/S3）：
 *   · gitui.lib.monaco —— Monaco 全量（含五语言 worker inline + CSS 自注入）独立成库，
 *     files 页经 window.GITTER_LIBS.monaco 取用，Monaco 升级只重建这一个包；
 *   · gitui.page.office/officeview.js —— iframe 预览运行时（pdfjs/SheetJS/docx-preview/
 *     pptx-preview）作为 office 包的库贡献落盘为 wrapper 脚本（运行时字符串唯一副本），
 *     office/files 两页经 window.GITTER_LIBS.officeview 取用，loader 按依赖声明先行注入；
 *     echarts 构建期替身化（echartsStub），真实现由 gitui.lib.chart 独立库包提供（S5）。
 *   页装载器保证依赖库先于页面 entry 注入（build 产物不再内联任何重资产）。
 * 运行：cd web && node scripts/build-pages.mjs（npm run build 链末段自动执行）
 */
import { build } from "vite";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const outRoot = path.resolve(webRoot, "..", "app", "resources", "packages");

const PAGES = ["projects", "log", "changes", "branches", "tasks", "bash", "files", "office", "settings"];
const OFFICEVIEW_VERSION = "1.0.0";

/**
 * gitui.lib.chart 库构建（S5）：echarts 全量（含 SVG 渲染器）独立 IIFE → 字符串资产
 * wrapper（GITTER_LIBS.chart = { version, runtimeJs }）落盘 gitui.lib.chart/chart.js。
 * echarts 本体只在 iframe 预览文档内执行（officeview.srcdocScripts 组合注入），
 * 宿主文档零字节执行；库 manifest 版本须与 node_modules 实际 echarts 版本一致
 * （升 echarts = npm 升级 + 同步 manifest version + 重建本包，officeview/pages 零重建）。
 */
async function buildChartLib() {
  const echartsVer = JSON.parse(fs.readFileSync(path.join(webRoot, "node_modules", "echarts", "package.json"), "utf8")).version;
  const manifestPath = path.join(outRoot, "gitui.lib.chart", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const declared = manifest.contributes?.libraries?.[0]?.version;
  if (declared !== echartsVer) {
    throw new Error(
      `gitui.lib.chart/manifest.json 版本(${declared})与 node_modules echarts(${echartsVer}) 不一致——` +
      `升级 echarts 请同步 manifest.contributes.libraries[0].version`,
    );
  }
  const outDir = path.join(webRoot, ".vite-chart-lib");
  await build({
    root: webRoot,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      lib: {
        entry: path.resolve(webRoot, "src/libs/chartLib.ts"),
        name: "GitterChartLib",
        formats: ["iife"],
        fileName: () => "chart-runtime.js",
      },
      chunkSizeWarningLimit: 20000,
    },
  });
  const js = fs.readFileSync(path.join(outDir, "chart-runtime.js"), "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  const wrapper =
    `(window.GITTER_LIBS=window.GITTER_LIBS||{}).chart={` +
    `version:${JSON.stringify(echartsVer)},` +
    `runtimeJs:${JSON.stringify(js)}};`;
  fs.writeFileSync(path.join(outRoot, "gitui.lib.chart", "chart.js"), wrapper);
  process.stdout.write(`[libs] gitui.lib.chart/chart.js ✓ (${(wrapper.length / 1048576).toFixed(1)}MB)\n`);
}

/**
 * office 槽的 iframe 预览运行时（office-integration-plan.md §10.5）：
 * 单独构建为 minified IIFE，再包一层 wrapper 落盘为 office 包的库贡献
 * gitui.page.office/officeview.js——运行时字符串的唯一副本，页面运行时经
 * window.GITTER_LIBS.officeview 取用并写进 iframe srcdoc——预览库
 * （pdfjs/SheetJS/docx-preview/pptx-preview）及其全部样式只存在于 iframe 文档内，
 * 宿主文档零污染。（S2 前该字符串经 virtual 模块内联进 office/files 两个 page.js，
 * 重复 2×3.5MB；现改为库贡献，loader 按页 manifest dependencies 先行注入。）
 *
 * S5：echarts 经 ^echarts$ alias 顶替为构建期替身（echartsStub.ts，惰性委托
 * self.GITTER_CHART）——echarts 全量（~1MB，sideEffects 强制全收）不再入包，
 * 改由 gitui.lib.chart 独立提供；srcdocScripts() 把 chart 运行时组合在预览运行时
 * 之前（chart 缺席 = 图表幻灯片降级为文档级错误卡，可选依赖语义）。
 */
async function buildOfficePreviewRuntime() {
  const outDir = path.join(webRoot, ".vite-office-preview");
  await build({
    root: webRoot,
    logLevel: "warn",
    resolve: {
      alias: [{ find: /^echarts$/, replacement: path.resolve(webRoot, "src/pages/officePreview/echartsStub.ts") }],
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      lib: {
        entry: path.resolve(webRoot, "src/pages/officePreview/runtime.ts"),
        name: "GitterOfficePreview",
        formats: ["iife"],
        fileName: () => "runtime.js",
      },
      chunkSizeWarningLimit: 10000,
    },
  });
  const js = fs.readFileSync(path.join(outDir, "runtime.js"), "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  const wrapper =
    `(window.GITTER_LIBS=window.GITTER_LIBS||{}).officeview={` +
    `version:${JSON.stringify(OFFICEVIEW_VERSION)},` +
    `runtimeJs:${JSON.stringify(js)},` +
    // srcdoc 脚本序（S5）：chart 运行时在前（挂 self.GITTER_CHART），预览运行时在后——
    // chart 库缺席（可选依赖）时降级为只装预览运行时
    `srcdocScripts(){var c=window.GITTER_LIBS&&window.GITTER_LIBS.chart;` +
    `var out=(c&&typeof c.runtimeJs==="string")?[c.runtimeJs]:[];return out.concat(this.runtimeJs);}};`;
  fs.writeFileSync(path.join(outRoot, "gitui.page.office", "officeview.js"), wrapper);
  process.stdout.write(`[libs] gitui.page.office/officeview.js ✓ (${(wrapper.length / 1048576).toFixed(1)}MB)\n`);
}

/**
 * Monaco ESM 的样式经 JS 分发（96 个 contrib 模块 `import './x.css'`）。
 * lib IIFE 构建下 vite 会把 CSS 抽成独立 .css 产物，而页装载器只装 page.js——样式永远装不上；
 * 且 file:// 下 codicon.css 里相对 url(./codicon.ttf) 也取不到字体。
 * 此插件把 monaco 的 .css 模块重写为「自注入 <style>」的 JS 模块，字体/图标二进制
 * 内联为 data URI——monaco.js 即装即用，无额外产物。仅 monaco 库构建使用
 * （页面构建不再打包 monaco——S3 拆分后 pages 插件列表为空）。
 */
function monacoCssInline() {
  const FONT_MIME = {
    ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2",
    ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif",
  };
  return {
    name: "monaco-css-inline",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.endsWith(".css")) return null;
      const fromMonaco = source.includes("monaco-editor") || (!!importer && importer.includes("monaco-editor"));
      if (!fromMonaco) return null;
      const base = importer ? path.dirname(importer) : webRoot;
      // 虚拟 id 以 .js 结尾——若仍以 .css 结尾，vite:css 会无视本插件的 load 结果，
      // 把下面的 JS 再送进 postcss（Unknown word const）
      return "\0monaco-css:" + path.resolve(base, source) + ".js";
    },
    load(id) {
      if (!id.startsWith("\0monaco-css:")) return null;
      const file = id.slice("\0monaco-css:".length).replace(/\.js$/, "");
      let css;
      try {
        css = fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
      css = css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, u) => {
        if (/^(data:|https?:|\/\/)/.test(u)) return m;
        const abs = path.resolve(path.dirname(file), decodeURIComponent(u));
        const mime = FONT_MIME[path.extname(abs).toLowerCase()];
        if (!mime || !fs.existsSync(abs)) return m;
        return `url(data:${mime};base64,${fs.readFileSync(abs).toString("base64")})`;
      });
      return `const s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s);`;
    },
  };
}

/**
 * gitui.lib.monaco 库构建（S3）：Monaco 全量 + 五语言 worker（?worker&inline → base64 +
 * Blob URL）+ CSS 自注入 → IIFE 经典脚本挂 window.GITTER_LIBS.monaco。
 * 库 manifest 版本须与 web/package.json 的 monaco-editor 版本一致（升 Monaco 的动作 =
 * 改 package.json + 同步 manifest version + 重建本包，files 页零改动）。
 */
async function buildMonacoLib() {
  const webPkg = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8"));
  const monacoVer = String(webPkg.dependencies?.["monaco-editor"] ?? "").replace(/^[^\d]*/, "");
  const manifestPath = path.join(outRoot, "gitui.lib.monaco", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const declared = manifest.contributes?.libraries?.[0]?.version;
  if (declared !== monacoVer) {
    throw new Error(
      `gitui.lib.monaco/manifest.json 版本(${declared})与 web/package.json monaco-editor(${monacoVer}) 不一致——` +
      `升级 Monaco 请同步 manifest.contributes.libraries[0].version`,
    );
  }
  const outDir = path.join(webRoot, ".vite-monaco-lib");
  await build({
    root: webRoot,
    logLevel: "warn",
    plugins: [monacoCssInline()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    worker: { format: "iife" },
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      lib: {
        entry: path.resolve(webRoot, "src/libs/monacoLib.ts"),
        name: "GitterMonacoLib",
        formats: ["iife"],
        fileName: () => "monaco.js",
      },
      chunkSizeWarningLimit: 40000,
    },
  });
  const js = fs.readFileSync(path.join(outDir, "monaco.js"), "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.writeFileSync(path.join(outRoot, "gitui.lib.monaco", "monaco.js"), js);
  process.stdout.write(`[libs] gitui.lib.monaco/monaco.js ✓ (${(js.length / 1048576).toFixed(1)}MB)\n`);
}

await buildChartLib();
await buildOfficePreviewRuntime();
await buildMonacoLib();

for (const slot of PAGES) {
  await build({
    root: webRoot,
    logLevel: "warn",
    resolve: {
      alias: [
        // 精确匹配（^...$）：monaco 内部也有 "../commands/..." 形态的相对导入，
        // 字符串前缀 alias 会把它们误改写到 shim 路径（页源码只会以整串 specifier 引用这三者）
        { find: /^\.\.\/pageSdk$/, replacement: path.resolve(webRoot, "src/external/pageSurface.ts") },
        { find: /^\.\.\/kit$/, replacement: path.resolve(webRoot, "src/external/kitShim.ts") },
        { find: /^\.\.\/commands$/, replacement: path.resolve(webRoot, "src/external/commandsShim.ts") },
        // monaco-editor → 库访问面（页面包拆分 S3）：页面源码保持 `import * as monaco
        // from "monaco-editor"` 零改动（tsc 走 node_modules 真实类型），运行时经
        // window.GITTER_LIBS.monaco 取用——页面产物零 monaco 字节
        { find: /^monaco-editor$/, replacement: path.resolve(webRoot, "src/external/monacoLibAccess.ts") },
      ],
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: path.join(outRoot, `gitui.page.${slot}`),
      // 不可清空目录：manifest.json / i18n/ / officeview.js 是随包静态资源（提交入库），只覆盖 page.js
      emptyOutDir: false,
      // 页面包不需要宿主 public/ 资产（favicon / 品牌图），禁止 vite 复制
      copyPublicDir: false,
      // 不压缩是页面包缺省策略（安全网按行扫描、报错行号有意义）。
      // 重资产（Monaco / office 预览运行时）已拆为 GITTER_LIBS 库包（独立 minify 构建），
      // 页面包回归纯自研代码——minify 例外随之取消。
      minify: false,
      lib: {
        entry: path.resolve(webRoot, `src/pages/entries/${slot}.ts`),
        name: "GitterPage",
        formats: ["iife"],
        fileName: () => "page.js",
      },
      rollupOptions: {
        external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
        output: {
          globals: {
            "react": "window.GITTER_KIT.React",
            "react/jsx-runtime": "window.GITTER_KIT.ReactJSXRuntime",
            "react-dom": "window.GITTER_KIT.ReactDOM",
            "react-dom/client": "window.GITTER_KIT.ReactDOMClient",
          },
        },
      },
      chunkSizeWarningLimit: 4000,
    },
  });
  process.stdout.write(`[pages] gitui.page.${slot} → page.js ✓` + "\n");
}
process.stdout.write(`[pages] ${PAGES.length} 个内置页面构建完成` + "\n");
