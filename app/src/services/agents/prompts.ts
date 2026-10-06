import * as fs from "fs";
import * as path from "path";
import { tryGit } from "../gitexec";
import type { HarnessLaunchSpec, ThinkingLevel } from "./types";

/**
 * Prompt 组装（agent-harness.md v3.0 §3.2/§五）：系统提示词（角色 + worktree 边界 + 仓库上下文
 * + 思考深度指令）与任务/反馈模板。全部纯函数（collectRepoContext 除外），黄金用例可测。
 */

/** 思考深度 → 系统提示词指令（软通道；硬通道是 loop.ts 的 providerOptions.reasoning_effort）。 */
export function thinkingDirective(t: ThinkingLevel | undefined): string {
  switch (t) {
    case "off":
      return "\n\n思考深度：关闭——直接给出结论与操作，不要展开长推理。";
    case "low":
      return "\n\n思考深度：低——简短确认关键步骤后即执行。";
    case "high":
      return "\n\n思考深度：高——先在内部完整推理方案与风险，再开始动手。";
    case "medium":
    default:
      return "\n\n思考深度：中——对关键决策稍作权衡后执行。";
  }
}

export function composeTaskPrompt(spec: HarnessLaunchSpec, taskPrompt: string): string {
  const pre = spec.promptTemplates.preamble?.trim();
  const body = taskPrompt.trim();
  if (!pre) return body;
  return `${pre}\n\n${body}`;
}

const FEEDBACK_FALLBACK =
  "以下是人工审查者对上一轮改动的反馈，请只处理这些条目，不要扩大改动范围：\n{feedback}";

export function composeFeedbackPrompt(spec: HarnessLaunchSpec, feedback: string): string {
  const tpl = spec.promptTemplates.feedback?.trim() || FEEDBACK_FALLBACK;
  return tpl.replace("{feedback}", feedback.trim());
}

// ---- 内置 Gitter Agent：系统提示词（agent-harness.md v3.0 §3.2）----

export interface RepoContext {
  branch: string | null;
  statusSummary: string;
  topLevel: string[];
  agentsMd: string | null;
}

/** 仓库上下文采集（每轮开始一次；全部软失败——采集不到就少一段，不阻塞循环）。 */
export async function collectRepoContext(worktreePath: string): Promise<RepoContext> {
  const branch = (await tryGit(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim() || null;
  let statusSummary = "（status 不可用）";
  try {
    const st = (await tryGit(worktreePath, ["status", "--porcelain"])).stdout.trim();
    statusSummary = st ? `${st.split("\n").length} 个文件有变更` : "工作区干净";
  } catch {
    /* 忽略 */
  }
  let topLevel: string[] = [];
  try {
    topLevel = fs
      .readdirSync(worktreePath, { withFileTypes: true })
      .filter((d) => d.name !== ".git")
      .slice(0, 40)
      .map((d) => (d.isDirectory() ? d.name + "/" : d.name));
  } catch {
    /* 忽略 */
  }
  let agentsMd: string | null = null;
  for (const name of ["AGENTS.md", "agents.md"]) {
    try {
      const raw = fs.readFileSync(path.join(worktreePath, name), "utf8");
      agentsMd = raw.length > 2000 ? raw.slice(0, 2000) + "\n…（已截断）" : raw;
      break;
    } catch {
      /* 无该文件 */
    }
  }
  return { branch, statusSummary, topLevel, agentsMd };
}

export function composeSystemPrompt(ctx: RepoContext, worktreePath: string): string {
  return [
    "你是 Gitter 的内置编码 agent，在一个隔离的任务 worktree 中完成人类下达的 git/编码任务。",
    "",
    "边界（硬约束）：",
    `- 你的一切文件与命令操作都限定在 worktree：${worktreePath}`,
    "- 破坏性 git 操作（push 之外的远程/历史改写）不在你的工具集内；",
    "- git 写操作（stage/commit/push）与命令执行需要人类在授权卡上批准，被拒绝时调整方案而不是重试同一操作；",
    "- commit 会自动附加 Assisted-by/Gitter-Session trailer，不要在消息里手写。",
    "",
    "工作方式：",
    "- 先用只读工具（repo_status/repo_diff/repo_read_file/repo_list_files）了解现场，再动手；",
    "- 改代码用 file_write / file_patch（精确旧串→新串）；跑测试/构建用 terminal_run；",
    "- 完成后输出一段简短总结（会作为任务卡摘要展示给人类）。",
    "",
    "当前仓库上下文：",
    `- 分支：${ctx.branch ?? "未知"}；工作区：${ctx.statusSummary}`,
    `- 顶层条目：${ctx.topLevel.join("  ") || "（空）"}`,
    ...(ctx.agentsMd ? [`- AGENTS.md：\n${ctx.agentsMd}`] : []),
  ].join("\n");
}
