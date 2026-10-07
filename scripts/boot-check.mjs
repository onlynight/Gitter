/**
 * Electron 启动级验证（extension-system-v2.md 收尾补强：此前全部为无头验证，
 * 本脚本真启动 Electron（渲染层 + 主进程装配 + 插件宿主），GITTER_BOOT_EXIT_MS 后自动退出，
 * 断言：进程存活至定时退出、退出码 0、启动期无致命输出（i18n 字典为空告警等）。
 * 运行：node scripts/boot-check.mjs [存活毫秒=6000]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "app");
const electronJs = path.join(appRoot, "node_modules", "electron", "cli.js");
const ms = Number(process.argv[2] ?? 6000);
if (!fs.existsSync(electronJs)) {
  console.error("FAIL: 未找到 electron cli.js（先在 app/ 下 npm install）");
  process.exit(1);
}

const child = spawn(process.execPath, [electronJs, "."], {
  cwd: appRoot,
  env: { ...process.env, GITTER_BOOT_EXIT_MS: String(ms), ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
const startedAt = Date.now();
const killer = setTimeout(() => {
  // 双保险：主进程内定时退出失效时由外部强杀（视为失败）
  console.error("FAIL: 超时未自动退出（GITTER_BOOT_EXIT_MS 未生效），外部终止");
  child.kill();
  process.exit(1);
}, ms + 15_000);

child.on("exit", (code) => {
  clearTimeout(killer);
  const elapsed = Date.now() - startedAt;
  const fatal = ["Cannot find module", "TypeError", "ReferenceError", "i18n 字典为空"].filter((k) => out.includes(k));
  if (code === 0 && elapsed >= ms - 1500 && fatal.length === 0) {
    console.log(`[PASS] Electron 启动级验证（存活 ${elapsed}ms，退出码 0，无致命输出）`);
    process.exit(0);
  }
  const hint = code === 0 && elapsed < 3000 ? "（疑似单实例锁被占用：先结束残留的 electron.exe 再重跑）" : ""
  console.error(`[FAIL] 退出码=${code} 存活=${elapsed}ms 致命标记=${fatal.join(",") || "无"}${hint}`);
  console.error(out.slice(-2000));
  process.exit(1);
});
