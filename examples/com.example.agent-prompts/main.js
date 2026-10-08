/**
 * agent-prompts —— L2 Agent 提示词/上下文/子代理/压缩示例。
 *
 * ⚠️ 槽位限制：identity 与 boundary 锁死，不对插件开放。
 *    用户包贡献 boundary 会在同步时被拒（isBuiltIn 裁决）。
 */

const fs = require("node:fs");
const path = require("node:path");

module.exports = function activate(ctx) {
  // ---- 1. 提示词槽位：静态 content 或动态 provide ----
  //      slot 可选：context/workflow/tools/skills/mode/task/free/output/compaction/subagent
  ctx.registerPromptSection({
    id: "branch_context",
    slot: "context",
    order: 20,
    provide: async (env) => {
      try {
        const status = await ctx.git.status();
        const files = status.split("\n").filter(Boolean).length;
        return `- 工作区改动文件：${files}`;
      } catch {
        return null; // null = 本轮省略
      }
    },
  });

  // 动态：按 mode 生成不同工作流提示
  ctx.registerPromptSection({
    id: "mode_hint",
    slot: "mode",
    order: 30,
    provide: (env) => {
      if (env.mode === "plan") return "当前为 plan 模式：只规划不执行，用 plan_submit 交付。";
      if (env.mode === "yolo") return "当前为 yolo 模式：非高风险操作直接执行。";
      return null;
    },
  });

  // 静态 content（无需 provide）
  ctx.registerPromptSection({
    id: "output_hint",
    slot: "output",
    order: 50,
    content: "任务结束时用三行以内总结：做了什么 / 改了哪些文件 / 遗留项。",
  });

  // ---- 2. 上下文采集器：tokenBudget 预算感知，软失败 ----
  ctx.registerContextCollector({
    id: "readme_digest",
    order: 30,
    tokenBudget: 800,
    collect: async (env) => {
      const candidates = ["README.md", "readme.md", "README.MD"];
      for (const name of candidates) {
        const p = path.join(env.worktreePath, name);
        if (!fs.existsSync(p)) continue;
        try {
          const raw = fs.readFileSync(p, "utf8");
          if (!raw.trim()) return null;
          // 预算约 0.5 token/字：粗算 800 token ≈ 400 中文字 ≈ 1600 英文字符
          const cap = 1600;
          return raw.length > cap
            ? raw.slice(0, cap) + "\n…（已截断）"
            : raw;
        } catch {
          return null;
        }
      }
      return null;
    },
  });

  // ---- 3. 子代理预设 ----
  //      ⚠️ timeoutMs 在 L2 运行时夹到 30_000..600_000（比 manifest 的 1_800_000 严）
  ctx.registerSubagentPreset({
    id: "quick-scan",
    name: "快速扫描",
    description: "快速定位一处代码，只读",
    tools: ["repo_glob", "repo_grep", "repo_read_file"],
    readonly: true,
    addendum: "快速扫描：最多 5 次工具调用，产出位置与结论。",
    timeoutMs: 180000,
  });

  // ---- 4. post-turn 钩子：产物以 system-reminder 注入下一轮，cap 2000 字符 ----
  //      ⚠️ 只有 post-turn；pre-turn 拦截不开放（引擎不插件化）
  ctx.registerTurnHook({
    id: "todo_auditor",
    order: 20,
    hook: (info) => {
      if (info.outcome !== "completed") return null;
      const todos = Array.isArray(info.todoState) ? info.todoState : [];
      const pending = todos.filter((t) => t && t.status !== "completed");
      if (pending.length === 0) return null;
      const lines = pending
        .slice(0, 8)
        .map((t) => `- ${t.content}（${t.status ?? "pending"}）`)
        .join("\n");
      return `本轮结束但 todo 未清空，未完成项：\n${lines}`;
    },
  });

  // ---- 5. 压缩器：单槽覆盖，活跃非内置压缩器优先于 builtin.summarizer ----
  ctx.registerCompactor({
    id: "tail_keeper",
    compact: async (input) => {
      const messages = Array.isArray(input.messages) ? input.messages : [];
      if (messages.length < 8) return null; // 太短不压，让内置处理

      const keepTail = 6;
      const removed = messages.slice(0, Math.max(0, messages.length - keepTail));
      const kept = messages.slice(-keepTail);

      // 极简实现：保留尾部 + 一行说明（真实实现应调模型总结）
      const note = `[压缩：已省略 ${removed.length} 条早期消息]`;
      return {
        messages: kept,
        record: {
          ts: new Date().toISOString(),
          removedCount: removed.length,
          tokensBefore: input.systemEstTokens,
          tokensAfter: Math.max(1, Math.floor(input.systemEstTokens * 0.35)),
          summary: note,
        },
      };
    },
  });

  // ---- 6. AI provider：⚠️ apiKey 永远不会下发给插件 ----
  //      真实接入应调用宿主已解析的 model 句柄，不要自己发 HTTP。
  ctx.registerAiProvider("echo", {
    isConfigured: () => false, // 明确不参与真实推理
    complete: async (prompt) => {
      return typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    },
  });

  return () => {
    // 宿主会自动按包注销 prompt sections / collectors / presets / hooks / compactors / providers
  };
};
