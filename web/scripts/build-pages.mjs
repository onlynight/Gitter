#!/usr/bin/env node
/**
 * 内置页面构建（ui-full-pluginization-plan.md R2/R2c）：
 * 八个页面各自构建为 IIFE 经典脚本 → app/resources/packages/gitui.page.<slot>/page.js。
 * - react 系（react / jsx-runtime / react-dom(+/client)）声明为 window.GITTER_KIT.* globals
 *   external——与宿主（kitGlobal.ts 组装的单实例）三方共享同一 React；
 * - "../pageSdk" / "../kit" / "../commands" 构建期映射到 src/external/* 适配层（window 面），
 *   页面产物不打包任何宿主模块；页内私有依赖（@tanstack/react-virtual、@xterm/*、
 *   monaco-editor——仅 files 页，inline-editor-plan.md §2.2「页面私有依赖」）随页打包。
 * 运行：cd web && node scripts/build-pages.mjs（npm run build 链末段自动执行）
 */
import { build } from "vite";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const outRoot = path.resolve(webRoot, "..", "app", "resources", "packages");

const PAGES = ["projects", "log", "changes", "branches", "tasks", "bash", "files", "settings"];

/**
 * Monaco ESM 的样式经 JS 分发（96 个 contrib 模块 `import './x.css'`）。
 * lib IIFE 构建下 vite 会把 CSS 抽成独立 .css 产物，而页装载器只装 page.js——样式永远装不上；
 * 且 file:// 下 codicon.css 里相对 url(./codicon.ttf) 也取不到字体。
 * 此插件把 monaco 的 .css 模块重写为「自注入 <style>」的 JS 模块，字体/图标二进制
 * 内联为 data URI——page.js 即装即用，无额外产物。仅 files 页引入 monaco，其余页面不受影响。
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

for (const slot of PAGES) {
  await build({
    root: webRoot,
    logLevel: "warn",
    plugins: [monacoCssInline()],
    resolve: {
      alias: [
        // 精确匹配（^...$）：monaco 内部也有 "../commands/..." 形态的相对导入，
        // 字符串前缀 alias 会把它们误改写到 shim 路径（页源码只会以整串 specifier 引用这三者）
        { find: /^\.\.\/pageSdk$/, replacement: path.resolve(webRoot, "src/external/pageSurface.ts") },
        { find: /^\.\.\/kit$/, replacement: path.resolve(webRoot, "src/external/kitShim.ts") },
        { find: /^\.\.\/commands$/, replacement: path.resolve(webRoot, "src/external/commandsShim.ts") },
      ],
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    // Worker 以经典脚本（IIFE）格式打包 → vite 产出 base64 内联 + Blob URL 包装器，
    // 绕开 file:// + webSecurity 下 `new Worker(相对 URL)` 的同源拦截
    //（inline-editor-plan.md §2.3：worker 经 Blob URL 加载）
    worker: { format: "iife" },
    build: {
      outDir: path.join(outRoot, `gitui.page.${slot}`),
      // 不可清空目录：manifest.json / i18n/ 是随包静态资源（提交入库），只覆盖 page.js
      emptyOutDir: false,
      // 页面包不需要宿主 public/ 资产（favicon / 品牌图），禁止 vite 复制
      copyPublicDir: false,
      // 不压缩是页面包缺省策略（安全网按行扫描、报错行号有意义）。
      // 例外：files 槽内联了 Monaco 全量 + 五个语言 worker（未压缩 ~24.8MB，§6.2），
      // P4 优化按文档 §6.2 选项 2 仅对该槽启用 minify（预计 ~8MB）——Monaco 主体是第三方代码，
      // 自研代码占比极小，压缩不损失安全网可读性。
      minify: slot === "files",
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
process.stdout.write(`[pages] 八个内置页面构建完成` + "\n");
