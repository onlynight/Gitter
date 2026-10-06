/**
 * U2 权限令牌无头烟雾（ui-pluginization-plan.md U2）：
 * a) 分级表完整性：bridge 全部 R("...") 方法都在 RPC_SCOPES 内（防新增 RPC 漏分级）
 * b) requiredScope 默认拒绝（未收录方法 → extensions.admin）
 * c) scopeGranted 语义（open 恒放行 / git.write 需声明 / 非 RPC 域声明不参与）
 * 运行：npm run build && node dist/smoke-u2.js
 */
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_PAGE_SCOPES, requiredScope, scopeGranted, RPC_SCOPES } from "./services/extensions/rpcScopes";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function main() {
  console.log("== U2 权限令牌无头烟雾 ==\n");

  // ---- a) 分级表完整性（正则提取 bridge.ts 全部 R("...")） ----
  const bridgeSrc = fs.readFileSync(path.resolve(__dirname, "bridge.js"), "utf8");
  const registered = new Set<string>();
  for (const m of bridgeSrc.matchAll(/R\("([\w.]+)"/g)) registered.add(m[1]);
  const missing = [...registered].filter((m) => !(m in RPC_SCOPES));
  check("分级表完整性（每个注册 RPC 都有 scope）", missing.length === 0,
    missing.length ? "缺: " + missing.join(",") : `${registered.size} 个方法全部分级`);
  const stale = Object.keys(RPC_SCOPES).filter((m) => !registered.has(m));
  check("无失效分级残留", stale.length === 0, stale.join(",") || "无");

  // ---- b) requiredScope 抽样语义 ----
  check("open 域抽样", requiredScope("ui.panels") === "open" && requiredScope("settings.get") === "open");
  check("git.read 域抽样", requiredScope("log.query") === "git.read" && requiredScope("changes.state") === "git.read");
  check("git.write 域抽样", requiredScope("changes.commit") === "git.write" && requiredScope("branches.rebase") === "git.write");
  check("settings.write 域抽样", requiredScope("settings.set") === "settings.write" && requiredScope("settings.setAiKey") === "settings.write");
  check("agent.run 域抽样", requiredScope("agent.task.create") === "agent.run" && requiredScope("review.repair") === "agent.run");
  check("approval 域抽样（mcp.approve 高危）", requiredScope("mcp.approve") === "approval");
  check("terminal/ai.invoke/extensions.admin 抽样",
    requiredScope("terminal.write") === "terminal" &&
    requiredScope("ai.explain") === "ai.invoke" &&
    requiredScope("extensions.uninstall") === "extensions.admin");

  // ---- c) 默认拒绝 ----
  check("未收录方法默认 extensions.admin", requiredScope("nope.method") === "extensions.admin" &&
    !scopeGranted(requiredScope("nope.method"), ["git.read", "git.write"]));

  // ---- d) scopeGranted 语义 ----
  check("open 恒放行（无论声明）", scopeGranted("open", []) && scopeGranted("open", ["git.read"]));
  check("git.write 需显式声明", !scopeGranted("git.write", DEFAULT_PAGE_SCOPES as string[]) &&
    scopeGranted("git.write", ["git.read", "git.write"]));
  check("缺省声明（DEFAULT_PAGE_SCOPES）放行 open+git.read", scopeGranted("git.read", DEFAULT_PAGE_SCOPES as string[]) &&
    !scopeGranted("settings.write", DEFAULT_PAGE_SCOPES as string[]));
  check("非 RPC 域声明（webview 等）不参与判定", !scopeGranted("git.write", ["webview"]));

  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke 崩溃:", e);
  process.exit(1);
});
