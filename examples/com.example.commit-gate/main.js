/**
 * commit-gate —— L2 受信代码插件。
 *
 * 入口契约：module.exports = (ctx) => dispose | void
 * （也接受 module.exports = { activate(ctx) { ... } }）
 *
 * 信任门：settings.allowCodePlugins（默认 false）。
 * 安全不变量：插件"提议"，执行权在宿主；门禁钩子只能否决、不能篡改。
 * 激活失败会回滚本文件已注册的全部面，宿主与其它包不受影响。
 */
module.exports = function activate(ctx) {
  // ---- 配置读取：ctx.storage 是插件 KV，不是 contributes.configuration ----
  // contributes.configuration 的运行值由宿主经 store.configOf 提供给命令模板（${config.<key>}），
  // L2 代码面目前没有读配置值的通道，因此本插件用 storage 存运行期状态。

  const cfg = {
    forbidMerge: true,
    warnBodyLines: 6,
    requireSignOff: false,
  };

  // ---- 1. 门禁钩子：commit / push。返回非空字符串 = 否决；null = 放行。
  //      ⚠️ 只能否决，不能篡改提交内容。钩子抛异常视为放行（不阻塞主流程）。
  ctx.registerGate("commit", (info) => {
    const message = String(info.message ?? "");
    if (!message.trim()) return null;

    if (cfg.requireSignOff && !/Signed-off-by:/i.test(message)) {
      return "缺少 Signed-off-by trailer（设置 signOff=true 要求签名）";
    }
    if (cfg.forbidMerge && /\bMerge branch\b|\bMerge pull request\b/i.test(message)) {
      return "仓库约定不允许 merge commit —— 请 rebase";
    }
    const body = message.split("\n").slice(1).filter((l) => l.trim()).length;
    if (body > cfg.warnBodyLines) {
      return null; // 只提醒不否决：用 registerCommitBlock 呈现
    }
    return null;
  });

  ctx.registerGate("push", (info) => {
    const branch = String(info.branch ?? "");
    if (/^main$|^master$/.test(branch)) {
      return null; // 放行，演示"否决返回字符串"的另一种形态在下面
    }
    if (branch === "release") {
      return "release 分支禁止直接 push —— 走 PR";
    }
    return null;
  });

  // ---- 2. 提交对话框区块：只能提示，不能阻断（要阻断用 registerGate）
  //      单块失败跳过，不影响其它块。
  ctx.registerCommitBlock(({ message, files }) => {
    const lines = String(message).split("\n").length;
    const parts = [];
    if (files > 25) parts.push(`⚠️ 本次提交涉及 ${files} 个文件，建议拆分`);
    if (lines > 4) parts.push(`提交正文 ${lines - 1} 行，超过 ${cfg.warnBodyLines} 行上限`);
    return parts.length ? parts.join("\n") : null;
  });

  // ---- 3. diff 侧栏注记：按文件路径的只读注记。单注记失败跳过。
  ctx.registerDiffNote(async (filePath) => {
    const p = String(filePath);
    if (/\.env(\.|$)/.test(p) || p === ".env") return "⚠️ 敏感配置文件——确认不含明文密钥";
    if (/\/test(\/|$)|\.test\.|\.spec\./.test(p)) return "测试文件：确认无快照污染";
    return null;
  });

  // ---- 4. 状态栏条目（渲染层经 ui.statusItems RPC 拉取）
  let seenCommits = 0;
  ctx.registerStatusItem("commits", {
    text: "◉ 0 次提交",
    tooltip: "commit-gate：本次会话观察到的提交数",
  });

  // ---- 5. 侧栏面板（L2 数据供给，渲染层拉取正文文本）
  //      单面板抛错不拖累其它面板——错误会渲染成"（面板出错：<msg>）"
  ctx.registerPanel("session", {
    title: "会话观察",
    body: async ({ repo }) => {
      let status = "";
      try {
        status = await ctx.git.status();
      } catch {
        return "（git 不可用）";
      }
      const files = status.split("\n").filter(Boolean).length;
      return [
        `仓库：${repo ?? "（未打开）"}`,
        `工作区文件：${files}`,
        `观察提交：${seenCommits} 次`,
      ].join("\n");
    },
  });

  // ---- 6. 静态 HTML 视图（渲染层沙箱 iframe，无脚本权限）
  ctx.registerView("notes", {
    title: "门禁说明",
    html: "<h2>提交门禁</h2><p>规则：阻止 merge commit、检查 Signed-off-by、正文行数。</p><p>钩子只能否决，不能修改提交。</p>",
  });

  // ---- 7. 事件订阅（事件名是宿主枚举，插件不能自定义事件源）
  ctx.on("commit.created", (p) => {
    seenCommits += 1;
    ctx.notify("提交完成", String(p.message ?? "").slice(0, 60));
  });

  ctx.on("repo.opened", (p) => {
    void ctx.storage.set("lastRepo", String((p.repo && p.repo.workDir) ?? ""));
  });

  ctx.on("agent.task.completed", (p) => {
    ctx.notify("Agent 任务完成", String(p.title ?? "").slice(0, 60));
  });

  // ---- 8. 运行时命令注册（自动加 ext.commit-gate. 前缀）
  //      action 必须在宿主白名单内：terminal.run / shell.openPath / shell.reveal /
  //      repo.refresh / agent.task.create / agent.task.resume
  ctx.registerCommand({
    id: "show-status",
    title: "打印工作区状态",
    when: "repoOpen",
    action: "terminal.run",
    args: { command: "git status --short" },
  });

  ctx.registerCommand({
    id: "last-commit",
    title: "显示最近一次提交",
    when: "repoOpen",
    action: "terminal.run",
    args: { command: "git log -1 --stat" },
  });

  ctx.registerCommand({
    id: "spawn-repair",
    title: "新建修复任务",
    when: "repoOpen",
    action: "agent.task.create",
    args: { prompt: "检查当前变更的风险点并给出修复建议。" },
  });

  // ---- 9. 工具注册（legacy ToolRegistry；permission="write:gate" 的工具仍走人审门）
  ctx.registerTool({
    name: "repo_summary",
    description: "汇总仓库概况：工作区文件数与最近提交",
    permission: "read",
    execute: async () => {
      const status = await ctx.git.status();
      const files = status.split("\n").filter(Boolean).length;
      const log = await ctx.git.log(3);
      return `工作区文件：${files}\n最近提交：\n${log.trim()}`;
    },
  });

  // ---- 10. 生命周期：返回 dispose 函数
  //       卸载 / 热重载 / 激活失败回滚时由宿主调用
  //       宿主注册的面会自动回收，这里只需清理本文件自己的资源
  return () => {
    ctx.notify("commit-gate 已停用");
  };
};
