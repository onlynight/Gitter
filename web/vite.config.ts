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
  },
});
