#!/usr/bin/env node
/**
 * 页面权限 E2E 金丝雀（ui-full-pluginization-plan.md R2 事故防回潮）：
 * 真启动 Electron（GITTER_E2E=1 触发 main.ts 内的探针：真点击终端页 →
 * terminal.ensure 需要 terminal 权限域）→ 审计 stdout 的 [e2e] 结果行。
 * 覆盖无头冒烟盖不到的链路：页面真实 mount 后 makeCtx 闭包里的 permissions
 * 是否随 GITTER_UI.call 注入 __caller 并被 bridge 放行。
 * 运行：node scripts/e2e-pages-check.mjs [存活毫秒=16000]（需先构建 app + web + pages）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "app");
const electronJs = path.join(appRoot, "node_modules", "electron", "cli.js");
const ms = Number(process.argv[2] ?? 16_000);
if (!fs.existsSync(electronJs)) {
  console.error("FAIL: 未找到 electron cli.js（先在 app/ 下 npm install）");
  process.exit(1);
}

const child = spawn(process.execPath, [electronJs, "."], {
  cwd: appRoot,
  env: { ...process.env, GITTER_BOOT_EXIT_MS: String(ms), GITTER_E2E: "1", ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
const killer = setTimeout(() => {
  console.error("FAIL: 超时未自动退出，外部终止");
  child.kill();
  process.exit(1);
}, ms + 15_000);

child.on("exit", (code) => {
  clearTimeout(killer);
  const pass = out.includes("[e2e] PASS");
  const fail = out.includes("[e2e] FAIL");
  if (code === 0 && pass && !fail) {
    process.stdout.write("[PASS] 页面权限 E2E（真点击终端页，terminal 域经 __caller 放行）\n");
    process.exit(0);
  }
  process.stderr.write(`[FAIL] 退出码=${code} — 见下方探针输出` + "\n");
  process.stderr.write((out.split("\n").filter((l) => l.includes("[e2e]") || l.includes("audit")).join("\n") || out.slice(-1200)) + "\n");
  process.exit(1);
});
