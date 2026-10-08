/**
 * agent-tool —— L2 Agent 工具示例。
 *
 * ⚠️ L1 contributes.agentTools 只是**声明**（用于能力展示/校验），不执行。
 *    真正让 Agent 能调用，必须在 L2 entry 里 ctx.registerAgentTool。
 *
 * 工具名自动加前缀 → ext.<pkg>.<id>
 * 权限档缺省 "each-time"（最严）
 * 参数 schema 不是 zod 实例时降级为 z.object({})
 * ⚠️ 上下文刻意收窄：插件只拿到 { workDir, signal }，
 *    拿不到 emit / requestPermission / askUser / submitPlan / setTodos / spawnSubtask
 */
const { z } = require("zod");

module.exports = function activate(ctx) {
  // ---- 1. 纯计算工具：auto 免询问 ----
  ctx.registerAgentTool({
    id: "word-count",
    description: "统计给定文本的中英文字数、行数、词数",
    permissionClass: "auto",
    parametersSchema: z.object({
      text: z.string().min(1).describe("要统计的文本"),
      countChinese: z.boolean().optional().default(true).describe("是否单独统计中文字符"),
    }),
    execute: (args) => {
      const text = String(args.text);
      const chinese = args.countChinese === false ? null : (text.match(/[一-龥]/g) || []).length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const lines = text.split("\n").length;
      return [
        `字符数：${text.length}`,
        chinese !== null ? `中文字符：${chinese}` : null,
        `词数（空白分隔）：${words}`,
        `行数：${lines}`,
      ].filter(Boolean).join("\n");
    },
  });

  // ---- 2. 只读仓库信息工具：走 ctx.git，auto ----
  ctx.registerAgentTool({
    id: "recent-commits",
    description: "读取当前仓库最近 N 次提交摘要（oneline）",
    permissionClass: "auto",
    parametersSchema: z.object({
      limit: z.number().int().min(1).max(50).default(10).describe("提交条数，1-50"),
    }),
    execute: async (args, env) => {
      const out = await ctx.git.log(args.limit ?? 10);
      if (!out.trim()) return "（无提交记录或非 git 仓库）";
      return `仓库：${env.workDir}\n${out.trim()}`;
    },
  });

  // ---- 3. 外部副作用工具：each-time 每次询问 ----
  //      Agent 工具拿不到 shell/requestPermission，副作用工具只返回文本。
  //      需要弹系统对话框的话，用 L1 命令 + shell.openExternal 走宿主。
  ctx.registerAgentTool({
    id: "open-link",
    description: "记录一个 http(s) URL 供后续人工打开（不做外部副作用，仅演示 each-time 权限档）",
    permissionClass: "each-time",
    parametersSchema: z.object({
      url: z.string().url().describe("要记录的 http(s) URL"),
      reason: z.string().min(1).optional().describe("为什么需要这个链接"),
    }),
    execute: async (args) => {
      await ctx.storage.set("lastUrl", args.url);
      return `URL 已记录：${args.url}${args.reason ? `\n原因：${args.reason}` : ""}`;
    },
  });

  // ---- 4. 演示 signal 中止传播 ----
  ctx.registerAgentTool({
    id: "slow-probe",
    description: "演示 AbortSignal 传播：耗时操作可被用户取消",
    permissionClass: "auto",
    parametersSchema: z.object({
      ms: z.number().int().min(0).max(30000).default(2000).describe("模拟耗时毫秒数"),
    }),
    execute: async (args, env) => {
      const ms = Math.min(Math.max(args.ms ?? 2000, 0), 30000);
      const sleep = (n) => new Promise((r) => setTimeout(r, n));
      for (let waited = 0; waited < ms; waited += 250) {
        if (env.signal.aborted) return `（已取消，已等待 ${waited}ms）`;
        await sleep(Math.min(250, ms - waited));
      }
      return `等待 ${ms}ms 完成`;
    },
  });

  return () => {
    // 宿主会自动 unregisterAgentToolsByPackage(`ext.${ctx.packageId}`)
    // 这里只需清理本文件自己的资源
  };
};
