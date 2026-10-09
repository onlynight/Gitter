// harness 构建配置（开发用）：只打 harness 入口，不碰 dist 与页面包
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: "harness",
  // 相对产物路径：harness-dist 可挂在任意静态目录深度下查看
  base: "./",
  logLevel: "warn",
  build: {
    // 钉在 web/harness-dist（与 root 同级）：页面产物经 ../../app/resources 相对导入，
    // 深度变了相对路径就断了
    outDir: path.resolve(here, "harness-dist"),
    emptyOutDir: true,
    target: "chrome120",
    rollupOptions: {
      input: {
        main: path.resolve(here, "harness", "index.html"),
        terminal: path.resolve(here, "harness", "terminal.html"),
        files: path.resolve(here, "harness", "files.html"),
      },
    },
  },
});
