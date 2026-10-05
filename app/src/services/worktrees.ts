import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { git, tryGit } from "./gitexec";
import type { WorktreeDTO } from "../shared/types";

/** worktree 列表（git worktree list --porcelain）。 */
export async function listWorktrees(workDir: string): Promise<WorktreeDTO[]> {
  const out = await git(workDir, ["worktree", "list", "--porcelain"]);
  const result: WorktreeDTO[] = [];
  let cur: Partial<WorktreeDTO> = {};
  const flush = () => {
    if (cur.path) {
      result.push({
        path: cur.path,
        head: cur.head ?? "",
        branch: (cur.branch ?? "").replace("refs/heads/", ""),
        isMain: result.length === 0,
        isCurrent: false,
        prunable: cur.prunable ?? false,
      });
    }
    cur = {};
  };
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) { flush(); cur.path = line.slice(9); }
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7);
    else if (line.startsWith("prunable")) cur.prunable = true;
    else if (line === "") flush();
  }
  flush();

  // isCurrent：与 workDir 规范化比对
  const norm = (p: string) => path.resolve(p).toLowerCase();
  const curNorm = norm(workDir);
  for (const w of result) w.isCurrent = norm(w.path) === curNorm;
  return result;
}

/** 任务 worktree 落盘位（对齐 TasksPage：%LOCALAPPDATA%\GitUI\tasks\<repo>-<hash8>\<slug>）。 */
export function taskWorktreePath(repoDir: string, name: string): string {
  const repoName = path.basename(repoDir).replace(/[^\w.-]+/g, "_");
  const hash8 = crypto.createHash("sha256").update(repoDir.toLowerCase()).digest("hex").slice(0, 8);
  const slug = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
  return path.join(process.env.LOCALAPPDATA ?? ".", "GitUI", "tasks", `${repoName}-${hash8}`, slug);
}

export async function createTaskWorktree(workDir: string, name: string): Promise<WorktreeDTO> {
  const target = taskWorktreePath(workDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const branch = `task/${name}`;
  const r = await tryGit(workDir, ["worktree", "add", target, "-b", branch]);
  if (r.code !== 0) {
    // 分支已存在 → 不带 -b 重试
    const r2 = await tryGit(workDir, ["worktree", "add", target, branch]);
    if (r2.code !== 0) throw new Error(r.stderr.trim() || r2.stderr.trim());
  }
  const all = await listWorktrees(workDir);
  return all.find((w) => path.resolve(w.path) === path.resolve(target))!;
}

export async function removeTaskWorktree(workDir: string, target: string): Promise<void> {
  const r = await tryGit(workDir, ["worktree", "remove", target]);
  if (r.code !== 0) throw new Error(r.stderr.trim());
}
