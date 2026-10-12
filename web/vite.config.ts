import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./"：产物经 WebView2 虚拟域名（http://app.local/）以文件形式加载，不能用绝对根路径
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    strictPort: true,
    // build-pages 的 monaco 库构建 outDir 在 web 树内（emptyOutDir 期间文件锁/删）——
    // 监视器撞上会 EBUSY 未捕获崩溃（dev server 与页面包重建并发的实际事故），排除之
    watch: {
      ignored: ["**/.vite-monaco-lib/**"],
    },
  },
});
