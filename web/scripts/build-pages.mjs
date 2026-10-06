#!/usr/bin/env node
/**
 * 内置页面构建（ui-full-pluginization-plan.md R2/R2c）：
 * 七个页面各自构建为 IIFE 经典脚本 → app/resources/packages/gitui.page.<slot>/page.js。
 * - react 系（react / jsx-runtime / react-dom(+/client)）声明为 window.GITTER_KIT.* globals
 *   external——与宿主（kitGlobal.ts 组装的单实例）三方共享同一 React；
 * - "../pageSdk" / "../kit" / "../commands" 构建期映射到 src/external/* 适配层（window 面），
 *   页面产物不打包任何宿主模块；页内私有依赖（@tanstack/react-virtual、@xterm/*）随页打包。
 * 运行：cd web && node scripts/build-pages.mjs（npm run build 链末段自动执行）
 */
import { build } from "vite";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const outRoot = path.resolve(webRoot, "..", "app", "resources", "packages");

const PAGES = ["projects", "log", "changes", "branches", "tasks", "bash", "settings"];

for (const slot of PAGES) {
  await build({
    root: webRoot,
    logLevel: "warn",
    resolve: {
      alias: [
        { find: "../pageSdk", replacement: path.resolve(webRoot, "src/external/pageSurface.ts") },
        { find: "../kit", replacement: path.resolve(webRoot, "src/external/kitShim.ts") },
        { find: "../commands", replacement: path.resolve(webRoot, "src/external/commandsShim.ts") },
      ],
    },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: path.join(outRoot, `gitui.page.${slot}`),
      // 不可清空目录：manifest.json / i18n/ 是随包静态资源（提交入库），只覆盖 page.js
      emptyOutDir: false,
      // 不压缩：内置页面包产物保持可读多行格式——安全网按行扫描、报错行号有意义；
      // 本地包随应用分发，体积代价可接受
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
      chunkSizeWarningLimit: 2000,
    },
  });
  process.stdout.write(`[pages] gitui.page.${slot} → page.js ✓` + "\n");
}
process.stdout.write(`[pages] 七个内置页面构建完成` + "\n");
