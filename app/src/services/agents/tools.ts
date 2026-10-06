import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { tryGit } from "../gitexec";
import * as status from "../gitstatus";
import * as safety from "../safety";
import { readFeedback } from "../feedback";
import type { FileChangeKind } from "./types";

/**
 * Agent 工具集（agent-harness.md v3.0 §四 + task-model-modules.md §3.1/§3.2）：
 * 工具面操作目录的 zod 化。权限分级基线 PERM；任务型策略（收紧方向）经
 * effectivePermissionClass 生效——每个工具 execute 统一先过 ask（auto 直接放行，
 * session/each-time 走授权卡），策略收紧对任何工具都成立。被拒绝 → 文本回给模型自纠。
 * 所有 fs 工具经 resolveSafe 锁定任务 worktree。
 */

export type PermissionClass = "auto" | "session" | "each-time";

/** 内置权限基线（task-model-modules.md §3.2：任务型策略只能沿 auto→session→each-time 收紧）。 */
export const PERM: Record<string, PermissionClass> = {
  repo_status: "auto", repo_diff: "auto", repo_log: "auto",
  review_get_state: "auto",
  repo_read_file: "auto", repo_list_files: "auto",
  file_write: "auto", file_patch: "auto",
  git_stage: "session", git_commit: "session", terminal_run: "session",
  git_push: "each-time",
};

export const TOOL_NAMES = Object.keys(PERM);

const RANK: Record<PermissionClass, number> = { auto: 0, session: 1, "each-time": 2 };

export function permissionClass(toolName: string): PermissionClass {
  return PERM[toolName] ?? "each-time";
}

/** 生效分级 = 基线 ⊕ 任务型覆盖（收紧方向防御：覆盖不得低于基线；push 恒 each-time）。 */
export function effectivePermissionClass(toolName: string, policy?: Record<string, PermissionClass>): PermissionClass {
  const base = permissionClass(toolName);
  if (toolName === "git_push") return "each-time";
  const over = policy?.[toolName];
  if (!over) return base;
  return RANK[over] >= RANK[base] ? over : base;
}

export interface ToolBuildOptions {
  /** 工具白名单裁剪（taskTypes.tools）：缺省 = 全集 */
  allowedTools?: readonly string[];
  /** 权限策略覆盖（taskTypes.permissionPolicy）：只允许收紧 */
  policy?: Record<string, PermissionClass>;
}

export interface ToolDeps {
  worktreePath: string;
  taskId: string;
  /** 授权卡挂起；resolve(ok, remember)。permissionClass 为任务型策略收紧后的生效分级（auto 已在 ask 内放行） */
  requestPermission: (
    toolName: string,
    req: { title: string; detail: string; command?: string | null; permissionClass: PermissionClass },
  ) => Promise<boolean>;
  onFileChange?: (path: string, kind: FileChangeKind) => void;
}

/** 路径锁定：resolve 后必须落在 worktree 内，越权直接抛（调用方转错误文本给模型）。 */
export function resolveSafe(worktreePath: string, p: string): string {
  const abs = path.resolve(worktreePath, p);
  const rel = path.relative(worktreePath, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`路径越出 worktree 边界：${p}`);
  }
  return abs;
}

function err(e: unknown): string {
  return `错误：${(e as Error).message}`;
}

async function gitOut(wd: string, args: string[], cap = 20_000): Promise<string> {
  const r = await tryGit(wd, args);
  if (r.code !== 0) return `错误：${r.stderr.trim().slice(0, 500)}`;
  const out = r.stdout;
  return out.length > cap ? out.slice(0, cap) + `\n…（输出已截断，共 ${out.length} 字符）` : out;
}

export function buildToolset(deps: ToolDeps, opts?: ToolBuildOptions): ToolSet {
  const wt = deps.worktreePath;
  const policy = opts?.policy;
  // 统一授权入口：auto 直接放行（不触授权卡）；session/each-time 经授权卡（Session 记忆在宿主侧）
  const ask = async (toolName: string, title: string, detail: string, command?: string | null) => {
    const cls = effectivePermissionClass(toolName, policy);
    if (cls === "auto") return null;
    const ok = await deps.requestPermission(toolName, { title, detail, command: command ?? null, permissionClass: cls });
    if (!ok) return `用户拒绝了该操作（${toolName}）。请调整方案，不要原样重试。`;
    return null;
  };

  const toolDefs = {
    repo_status: tool({
      description: "查看工作区状态：暂存/未暂存/未跟踪文件列表与计数",
      inputSchema: z.object({}),
      execute: async () => {
        const denied = await ask("repo_status", "读取工作区状态", "");
        if (denied) return denied;
        const st = await status.getStatus(wt);
        const all = [...st.staged, ...st.changes, ...st.unversioned, ...st.conflicts];
        return JSON.stringify({
          staged: st.staged.length, modified: st.changes.length,
          unversioned: st.unversioned.length, conflicts: st.conflicts.length,
          files: all.slice(0, 50).map((f) => `[${f.category}] ${f.path}`),
        });
      },
    }),
    repo_diff: tool({
      description: "查看 diff。可看工作区/暂存区/相对某基线提交的变更",
      inputSchema: z.object({
        path: z.string().optional().describe("限定文件（可选）"),
        staged: z.boolean().optional().describe("true = 暂存区 vs HEAD"),
        baseline: z.string().optional().describe("基线提交 SHA（工作区+提交 vs 该基线，squash 视角）"),
      }),
      execute: async ({ path: p, staged, baseline }) => {
        const denied = await ask("repo_diff", "读取 diff", p ?? "");
        if (denied) return denied;
        const args = ["diff", "--no-color"];
        if (staged) args.push("--cached");
        if (baseline) args.push(baseline);
        if (p) args.push("--", resolveSafe(wt, p));
        return gitOut(wt, args);
      },
    }),
    repo_log: tool({
      description: "查看提交历史（最近 N 条）",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      execute: async ({ limit }) => {
        const denied = await ask("repo_log", "读取提交历史", "");
        if (denied) return denied;
        const r = await tryGit(wt, ["log", "--pretty=format:%h %s (%an)", `-n${limit ?? 20}`]);
        return r.code === 0 ? r.stdout : err(new Error(r.stderr));
      },
    }),
    repo_read_file: tool({
      description: "读取 worktree 内的文本文件（64KB 上限）",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async ({ path: p }) => {
        const denied = await ask("repo_read_file", "读取文件", p);
        if (denied) return denied;
        const abs = resolveSafe(wt, p);
        const text = fs.readFileSync(abs, "utf8");
        return text.length > 64_000 ? text.slice(0, 64_000) + "\n…（已截断）" : text;
      },
    }),
    repo_list_files: tool({
      description: "列出 worktree 内文件（跳过 .git/node_modules 等，200 条上限）",
      inputSchema: z.object({ dir: z.string().optional() }),
      execute: async ({ dir }) => {
        const denied = await ask("repo_list_files", "列出文件", dir ?? "");
        if (denied) return denied;
        const base = dir ? resolveSafe(wt, dir) : wt;
        const skip = new Set([".git", "node_modules", "dist", "target", "bin", "obj"]);
        const out: string[] = [];
        const walk = (d: string) => {
          if (out.length >= 200) return;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (out.length >= 200) return;
            if (skip.has(e.name)) continue;
            const rel = path.relative(wt, path.join(d, e.name)).replace(/\\/g, "/");
            if (e.isDirectory()) {
              out.push(rel + "/");
              walk(path.join(d, e.name));
            } else out.push(rel);
          }
        };
        walk(base);
        return out.join("\n") || "（空）";
      },
    }),
    file_write: tool({
      description: "写入/覆盖 worktree 内的文本文件（整文件内容）",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async ({ path: p, content }) => {
        const denied = await ask("file_write", "写入文件", p, `write ${p}`);
        if (denied) return denied;
        const abs = resolveSafe(wt, p);
        const existed = fs.existsSync(abs);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
        deps.onFileChange?.(p, existed ? "modified" : "added");
        return `已写入 ${p}（${content.length} 字符）`;
      },
    }),
    file_patch: tool({
      description: "定点编辑：把文件中的旧串精确替换为新串（旧串必须恰好出现一次）",
      inputSchema: z.object({
        path: z.string().min(1),
        oldString: z.string().min(1),
        newString: z.string(),
      }),
      execute: async ({ path: p, oldString, newString }) => {
        const denied = await ask("file_patch", "编辑文件", p, `patch ${p}`);
        if (denied) return denied;
        const abs = resolveSafe(wt, p);
        const text = fs.readFileSync(abs, "utf8");
        const first = text.indexOf(oldString);
        if (first === -1) return `错误：旧串在 ${p} 中不存在（需精确匹配，含缩进）`;
        if (text.indexOf(oldString, first + 1) !== -1) return `错误：旧串在 ${p} 中出现多次，请加长上下文使其唯一`;
        fs.writeFileSync(abs, text.slice(0, first) + newString + text.slice(first + oldString.length), "utf8");
        deps.onFileChange?.(p, "modified");
        return `已编辑 ${p}`;
      },
    }),
    git_stage: tool({
      description: "把文件加入暂存区（git add）——需要人类在授权卡批准",
      inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
      execute: async ({ paths }) => {
        const denied = await ask("git_stage", "暂存文件", `${paths.length} 个文件`, `git add ${paths.slice(0, 3).join(" ")}${paths.length > 3 ? " …" : ""}`);
        if (denied) return denied;
        await status.stageFiles(wt, paths.map((p) => resolveSafe(wt, p)));
        return `已暂存 ${paths.length} 个文件`;
      },
    }),
    git_commit: tool({
      description: "提交暂存区内容（trailer 自动附加；提交前过安全网扫描）——需要人类批准",
      inputSchema: z.object({ message: z.string().min(1) }),
      execute: async ({ message }) => {
        const denied = await ask("git_commit", "提交", message.split(/\r?\n/)[0]?.slice(0, 80) ?? "", `git commit -m "${message.split(/\r?\n/)[0]?.slice(0, 60)}…"`);
        if (denied) return denied;
        // 安全网（block 档语义）：与 bridge changes.commit 同一规则库
        const st = await status.getStatus(wt);
        const files: safety.ScannableFile[] = [];
        for (const f of st.staged) {
          const patch = (await tryGit(wt, ["diff", "--cached", "--no-color", "--", f.path])).stdout;
          files.push({
            path: f.path, patch: patch || null,
            isBinary: patch.includes("GIT binary patch") || patch.includes("Binary files"),
            isNew: patch.includes("new file mode"),
            addedLines: f.added ?? 0, deletedLines: f.deleted ?? 0,
          });
        }
        const blocked = safety.scan(files).filter((x) => x.severity === "blocked");
        if (blocked.length > 0) {
          return `错误：安全网拦截（${blocked[0].filePath}:${blocked[0].line ?? "?"} ${blocked[0].message}）。请修复后重试，不要要求用户豁免。`;
        }
        const r = await tryGit(wt, ["commit", "-m", message.trim(), "-m", "Assisted-by: gitter-agent\nGitter-Session: " + deps.taskId]);
        if (r.code !== 0) return err(new Error(r.stderr));
        const sha = (await tryGit(wt, ["rev-parse", "HEAD"])).stdout.trim();
        return `已提交 ${sha.slice(0, 10)}：${message.trim().split(/\r?\n/)[0]}`;
      },
    }),
    terminal_run: tool({
      description: "在 worktree 内执行 shell 命令（跑测试/构建等；120s 超时，输出截断 8KB）——需要人类批准",
      inputSchema: z.object({ command: z.string().min(1) }),
      execute: async ({ command }) => {
        const denied = await ask("terminal_run", "执行命令", command.slice(0, 120), command);
        if (denied) return denied;
        return await new Promise<string>((resolve) => {
          let out = "";
          const child = spawn(command, { cwd: wt, shell: true, windowsHide: true });
          const timer = setTimeout(() => {
            child.kill();
            resolve(`超时（120s）。已有输出：\n${out.slice(0, 8000)}`);
          }, 120_000);
          child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
          child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
          child.on("error", (e) => {
            clearTimeout(timer);
            resolve(err(e));
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve(`退出码 ${code}：\n${out.length > 8000 ? out.slice(0, 8000) + "\n…（已截断）" : out}`);
          });
        });
      },
    }),
    review_get_state: tool({
      description: "查看人类的验收反馈状态（审查意见/涉及文件），修复轮开始前先了解验收结论",
      inputSchema: z.object({}),
      execute: async () => {
        const denied = await ask("review_get_state", "读取验收反馈", "");
        if (denied) return denied;
        const fb = readFeedback(wt);
        if (!fb) return JSON.stringify({ state: "no-feedback", note: null });
        return JSON.stringify({ state: "feedback", note: fb.note, path: fb.path, createdAt: fb.createdAt });
      },
    }),
    git_push: tool({
      description: "推送当前任务分支到远程——每次都需要人类批准（永不记忆）",
      inputSchema: z.object({}),
      execute: async () => {
        const denied = await ask("git_push", "推送到远程", "git push（当前任务分支）", "git push");
        if (denied) return denied;
        const r = await tryGit(wt, ["push"]);
        return r.code === 0 ? "已推送" : err(new Error(r.stderr));
      },
    }),
  };

  // 任务型白名单裁剪（只能减，§3.1）
  const allowed = opts?.allowedTools;
  const filtered: ToolSet = {};
  for (const [name, t] of Object.entries(toolDefs)) {
    if (!allowed || allowed.includes(name)) filtered[name] = t;
  }
  return filtered;
}
