import { tryGit } from "../gitexec";
import { getStatus, stageFiles, commit } from "../gitstatus";
import { queryLog } from "../gitlog";
import { getBranches } from "../gitbranches";
import { listWorktrees } from "../worktrees";
import { readTrailers } from "../sessions";
import { writeFeedback } from "../feedback";

/**
 * ToolRegistry——统一工具总线（extension-system-v2.md §16.2 机制 2，B 阶段）：
 * 内置 git 工具（自举：mcp.ts 管道宿主改走本注册表）/ MCP server 工具 / L2 插件工具 / L3（后续）
 * 同一张表。命令面板（后续）与 Agent 循环（D 阶段）消费同一注册表。
 * 权限模型：read 直行；write:gate 必经人审门（ctx.requestApproval）。
 */

export type ToolPermission = "read" | "write:gate";
export type ToolSource = "builtin" | "mcp" | "plugin";

export interface ToolContext {
  workDir: string;
  /** 写工具人审门（mcp 管道宿主注入；超时=拒绝由门实现方负责） */
  requestApproval: (description: string) => Promise<boolean>;
}

export interface ToolDef {
  name: string;
  description: string;
  permission: ToolPermission;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export interface ToolInfo {
  name: string;
  description: string;
  permission: ToolPermission;
  source: ToolSource;
  packageId?: string;
}

export const TOOL_DENIED =
  "write tools are disabled; start Gitter's MCP server with write permission or perform git writes yourself.";

// ---- 参数 helper（自 mcp.ts 移入）----

export function strArg(args: Record<string, unknown>, name: string): string | null {
  return typeof args?.[name] === "string" ? (args[name] as string) : null;
}
export function intArg(args: Record<string, unknown>, name: string): number | null {
  return typeof args?.[name] === "number" ? (args[name] as number) : null;
}
export function strArrayArg(args: Record<string, unknown>, name: string): string[] | null {
  if (!Array.isArray(args?.[name])) return null;
  return (args[name] as unknown[]).filter((x): x is string => typeof x === "string");
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const LOG_LIMIT = 20;

// ---- 内置 git 工具（自 mcp.ts runTool 迁入——工具接缝的自举）----

export function builtinGitTools(): ToolDef[] {
  return [
    {
      name: "repo.status",
      description: "Working tree status: changed/staged/untracked/conflict files.",
      permission: "read",
      async execute(_args, ctx) {
        const s = await getStatus(ctx.workDir);
        const lines = [...s.staged, ...s.changes, ...s.unversioned, ...s.conflicts].map(
          (f) => `${f.category}: ${f.path} (+${f.added ?? 0}/-${f.deleted ?? 0})`,
        );
        return lines.length === 0 ? "clean" : lines.join("\n");
      },
    },
    {
      name: "repo.log",
      description: "Recent commits (sha, subject, author, date, ai agent). Optional: limit.",
      permission: "read",
      async execute(args, ctx) {
        const limit = clamp(intArg(args, "limit") ?? LOG_LIMIT, 1, 200);
        const { commits, hasMore } = await queryLog(ctx.workDir, { limit });
        const lines = commits.map((c) => {
          const meta = readTrailers(c.body);
          const agent = c.assistedBy[0] ?? meta.assistedBy;
          return `${c.shortSha} ${new Date(c.committerDate * 1000).toISOString().slice(0, 16).replace("T", " ")} ${c.author}: ${c.subject}${agent ? ` [ai:${agent}]` : ""}`;
        });
        return lines.join("\n") + `\n(${commits.length}${hasMore ? "+" : ""})`;
      },
    },
    {
      name: "repo.diff",
      description: "Patch of staged changes vs HEAD (or one file). Optional: path.",
      permission: "read",
      async execute(args, ctx) {
        const wd = ctx.workDir;
        const p = strArg(args, "path");
        if (p) {
          const r = await tryGit(wd, ["diff", "--cached", "--no-color", "--", p]);
          return r.stdout || `(no staged diff for ${p})`;
        }
        const s = await getStatus(wd);
        const chunks: string[] = [];
        for (const f of s.staged.slice(0, 50)) {
          const r = await tryGit(wd, ["diff", "--cached", "--no-color", "--", f.path]);
          if (r.stdout) chunks.push(r.stdout);
        }
        return chunks.length === 0 ? "(nothing staged)" : chunks.join("\n");
      },
    },
    {
      name: "repo.branches",
      description: "Local and remote branches.",
      permission: "read",
      async execute(_args, ctx) {
        const b = await getBranches(ctx.workDir);
        return [
          ...b.local.map((x) => `local  ${x.isHead ? "*" : " "} ${x.name}`),
          ...b.remote.map((x) => `remote   ${x.name}`),
        ].join("\n");
      },
    },
    {
      name: "repo.worktrees",
      description: "All worktrees of this repository.",
      permission: "read",
      async execute(_args, ctx) {
        const wts = await listWorktrees(ctx.workDir);
        return wts.map((w) => `${w.isMain ? "main " : "task "} ${w.branch.padEnd(20)} ${w.path}`).join("\n");
      },
    },
    {
      name: "repo.stage",
      description: "Stage files (git add). Requires human approval.",
      permission: "write:gate",
      async execute(args, ctx) {
        const paths = strArrayArg(args, "paths");
        if (!paths || paths.length === 0) return "paths[] required";
        if (
          !(await ctx.requestApproval(
            `git add ${paths.length} 个文件（${paths.slice(0, 3).join(", ")}${paths.length > 3 ? " …" : ""}）`,
          ))
        ) {
          return TOOL_DENIED;
        }
        await stageFiles(ctx.workDir, paths);
        return `staged ${paths.length} file(s)`;
      },
    },
    {
      name: "repo.commit",
      description: "Commit staged changes with a message. Requires human approval.",
      permission: "write:gate",
      async execute(args, ctx) {
        const message = strArg(args, "message");
        if (!message?.trim()) return "message required";
        if (!(await ctx.requestApproval(`git commit：${message.trim().split("\n")[0].slice(0, 80)}`))) {
          return TOOL_DENIED;
        }
        const r = await commit(ctx.workDir, message, false);
        return `committed ${r.sha ? r.sha.slice(0, 7) : "(none)"}`;
      },
    },
    {
      name: "review.submit_feedback",
      description: "Submit human review feedback about a hunk/file. Params: note (required), path (optional).",
      permission: "read",
      async execute(args, ctx) {
        const note = strArg(args, "note");
        if (!note?.trim()) return "note required";
        writeFeedback(ctx.workDir, note, strArg(args, "path") ?? null);
        return "feedback recorded; the person will see it in Gitter's Changes page.";
      },
    },
  ];
}

// ---- 注册表 ----

interface RegisteredTool extends ToolDef {
  source: ToolSource;
  packageId: string | null;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  constructor(builtins: ToolDef[]) {
    for (const t of builtins) this.tools.set(t.name, { ...t, source: "builtin", packageId: null });
  }

  /** 注册 MCP/L2 来源工具（同名覆盖 = 后注册来源按包遮蔽；内置名被覆盖时保底保留原名no——直接覆盖，调用方负责命名空间）。 */
  register(def: ToolDef, source: ToolSource, packageId?: string): void {
    this.tools.set(def.name, { ...def, source, packageId: packageId ?? null });
  }

  unregisterByPackage(packageId: string): void {
    for (const [name, t] of this.tools) {
      if (t.packageId === packageId && t.source !== "builtin") this.tools.delete(name);
    }
  }

  list(): ToolInfo[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      permission: t.permission,
      source: t.source,
      packageId: t.packageId ?? undefined,
    }));
  }

  get(name: string): ToolInfo | null {
    const t = this.tools.get(name);
    return t ? { name: t.name, description: t.description, permission: t.permission, source: t.source, packageId: t.packageId ?? undefined } : null;
  }

  /** 执行；未知工具返回 null（调用方转协议错误）。工具抛错原样上抛（调用方转 isError）。 */
  async call(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
    const t = this.tools.get(name);
    if (!t) return null;
    return t.execute(args ?? {}, ctx);
  }
}
