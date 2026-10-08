/**
 * sandboxed-plugin —— L3 隔离子进程示例。
 *
 * manifest.entrySandbox: "utility"
 * 宿主用 Electron utilityProcess（或无头冒烟时的 child_process.fork）拉起本文件，
 * 把 sdkDir 作为 process.argv[2] 下发。
 *
 * ⚠️ L3 API 面严格小于 L2：只有
 *    storage / notify / on(events) / git.read / registerTool / registerStatusItem / registerView
 *    没有 gate / logDecorator / loop / agentTool / promptSection / compactor / aiProvider
 *
 * 超时：每次能力调用 20s；工具回调 30s。
 * 权限：manifest.permissions 未列出的能力调用 → "permission denied: <cap>"
 */
const sdkDir = process.argv[2];
if (!sdkDir) {
  console.error("sandboxed-plugin: 未收到 sdkDir 参数（必须经宿主 utilityProcess 拉起）");
  process.exit(2);
}

const { connectL3 } = require(sdkDir + "/services/extensions/l3-child");

connectL3().then((ctx) => {
  // ---- 1. 能力探活：列出本包实际可用的权限 ----
  ctx.storage.set("activatedAt", new Date().toISOString()).then(() => {
    ctx.notify("沙箱插件已激活", `可用权限：${ctx.permissions.join(", ")}`);
  });

  // ---- 2. 只读 git API（git.read 权限）----
  ctx.git.status().then((s) => {
    const files = s.split("\n").filter(Boolean).length;
    return ctx.storage.set("lastFileCount", files);
  }).catch((e) => {
    ctx.storage.set("lastError", e.message);
  });

  // ---- 3. 工具注册（tools 权限；write:gate 走宿主侧人审门）----
  //      注意：L3 工具进 legacy ToolRegistry，不是 v4 AgentToolRegistry
  ctx.registerTool({
    name: "sandbox_whoami",
    description: "返回沙箱进程内的环境信息（演示隔离子进程）",
    permission: "read",
    execute: () => {
      return [
        `进程 pid: ${process.pid}`,
        `packageId: ${ctx.packageId}`,
        `permissions: ${JSON.stringify(ctx.permissions)}`,
        `execPath: ${process.execPath}`,
      ].join("\n");
    },
  });

  ctx.registerTool({
    name: "repo_stat",
    description: "读取当前仓库工作区概况",
    permission: "read",
    execute: async () => {
      const status = await ctx.git.status();
      const branches = await ctx.git.branches();
      return `文件数: ${status.split("\n").filter(Boolean).length}\n分支:\n${branches.trim()}`;
    },
  });

  // ---- 4. 写类工具：宿主侧套人审门 ----
  ctx.registerTool({
    name: "sandbox_note",
    description: "把一段备注写入插件 KV（演示 write:gate 人审）",
    permission: "write:gate",
    execute: async (args) => {
      const text = String(args && args.text || "").slice(0, 2000);
      await ctx.storage.set("note", { ts: new Date().toISOString(), text });
      return `已记录（${text.length} 字）`;
    },
  });

  // ---- 5. 状态栏条目（statusbar 权限）----
  ctx.registerStatusItem("sandbox", {
    text: "🧪 sandboxed",
    tooltip: `L3 沙箱运行中，pid ${process.pid}`,
  });

  // ---- 6. 静态 HTML 视图（webview 权限；沙箱 iframe，无脚本）----
  ctx.registerView("about", {
    title: "沙箱说明",
    html: [
      "<h2>L3 沙箱插件</h2>",
      "<p>本插件运行在隔离子进程中，崩溃不影响宿主。</p>",
      "<p>可用权限：</p><ul>",
      ...ctx.permissions.map((p) => `<li>${p}</li>`),
      "</ul>",
      "<p>未列出的能力调用会被宿主拒绝。</p>",
    ].join("\n"),
  });

  // ---- 7. 事件订阅（events 权限）----
  ctx.on("commit.created", (payload) => {
    ctx.notify("提交完成", String(payload && payload.message || "").slice(0, 60));
  });

  ctx.on("repo.opened", (payload) => {
    ctx.storage.set("lastRepo", payload && payload.repo ? payload.repo.workDir : null);
  });
}).catch((e) => {
  // connectL3 失败：IPC 通道缺失（不是经 utilityProcess 拉起）
  console.error("sandboxed-plugin 启动失败:", e && e.message);
  process.exit(3);
});

// 崩溃隔离：子进程退出 → 宿主回收该包注册面
// 宿主收到 onExit(code) → 标记 active.error = "L3 进程异常退出（码 <n>）"
process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection:", e && e.message);
});
process.on("uncaughtException", (e) => {
  console.error("uncaughtException:", e && e.message);
  process.exit(1);
});
