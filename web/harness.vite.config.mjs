// harness 构建配置（开发用）：只打 harness 入口，不碰 dist 与页面包
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "harness",
  logLevel: "warn",
  build: {
    outDir: "harness-dist",
    emptyOutDir: true,
    target: "chrome120",
  },
});
