import { git, tryGit, GitError } from "./gitexec";
import type { StashEntryDTO, StashFileDTO } from "../shared/types";

/**
 * stash 管理（stash-mockup.html / git-commands-gap-analysis）：
 * 存（push -u 含未跟踪）→ 列（reflog format 解析出 stash@{n}）→ 恢复（apply，可选随后 drop = pop 语义）
 * → 删（drop）。不做 clear（safety.ts 已把 stash clear 列为危险拦截，UI 同样不提供）。
 * 冲突语义按 git：apply 遇冲突时条目保留不删，冲突文件落 changes 页 conflicts 组走冲突助手。
 */

/** stash 列表：reflog format 一次取全（selector/subject/时间），branch 与消息从 subject 解析。 */
export async function listStashes(workDir: string): Promise<StashEntryDTO[]> {
  const r = await tryGit(workDir, ["stash", "list", "--pretty=format:%gd%x09%gs%x09%at"]);
  if (r.code !== 0) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [selector, subject, ts] = line.split("\t");
    const idx = /(?:^|@)\{(\d+)\}/.exec(selector ?? "")?.[1] ?? "0";
    return {
      index: parseInt(idx, 10),
      selector: selector ?? `stash@{${idx}}`,
      // git 默认 subject 形如 "WIP on dev: 0f0af88 subj" / -m 时 "On dev: msg"
      message: (subject ?? "").replace(/^On\s+\S+:\s*/, "").replace(/^WIP on\s+[^:]+:\s*/, "") || subject || "",
      branch: /(?:^On|WIP on)\s+([^:]+):/.exec(subject ?? "")?.[1] ?? null,
      subject: subject ?? "",
      timestamp: parseInt(ts ?? "", 10) || 0,
    };
  });
}

/** 入 stash（-u 含未跟踪）。message 空 = 用 git 默认（"WIP on <branch>: …"）。工作区干净时 git 静默跳过（exit 0）。 */
export async function pushStash(workDir: string, message: string | null): Promise<void> {
  const args = ["stash", "push", "-u", ...(message ? ["-m", message] : [])];
  const r = await tryGit(workDir, args);
  if (r.code !== 0) throw new GitError(args, r);
}

/** stash@{index} 名字（负索引由调用方防护）。 */
function ref(index: number): string {
  return `stash@{${index}}`;
}

/** 应用（drop=true = pop 语义：应用成功后才删条目；遇冲突 git 自身保留条目，这里不会走到 drop）。 */
export async function applyStash(workDir: string, index: number, drop: boolean): Promise<void> {
  if (index < 0) throw new GitError(["stash", "apply"], { code: -1, stdout: "", stderr: `非法索引: ${index}` });
  const r = await tryGit(workDir, ["stash", "apply", ref(index)]);
  if (r.code !== 0) throw new GitError(["stash", "apply", ref(index)], r);
  if (drop) {
    const d = await tryGit(workDir, ["stash", "drop", ref(index)]);
    if (d.code !== 0) throw new GitError(["stash", "drop", ref(index)], d);
  }
}

export async function dropStash(workDir: string, index: number): Promise<void> {
  if (index < 0) throw new GitError(["stash", "drop"], { code: -1, stdout: "", stderr: `非法索引: ${index}` });
  const r = await tryGit(workDir, ["stash", "drop", ref(index)]);
  if (r.code !== 0) throw new GitError(["stash", "drop", ref(index)], r);
}

/** 条目涉及的文件（含未跟踪；name-status 供列表展示状态字母）。 */
export async function showStash(workDir: string, index: number): Promise<StashFileDTO[]> {
  if (index < 0) return [];
  const r = await tryGit(workDir, ["stash", "show", "--include-untracked", "--name-status", ref(index)]);
  if (r.code !== 0) {
    // 极旧 stash 无 untracked 支持等场景：退化为不带 -u
    const fallback = await tryGit(workDir, ["stash", "show", "--name-status", ref(index)]);
    if (fallback.code !== 0) throw new GitError(["stash", "show", ref(index)], fallback);
    return parseNameStatus(fallback.stdout);
  }
  return parseNameStatus(r.stdout);
}

function parseNameStatus(out: string): StashFileDTO[] {
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    return { code: tab > 0 ? line.slice(0, tab) : "M", path: tab > 0 ? line.slice(tab + 1) : line };
  });
}
