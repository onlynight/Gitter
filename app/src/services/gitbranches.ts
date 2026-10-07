import { git, tryGit, GitError } from "./gitexec";
import { pullWithProgress, push as pushRaw, type SyncProgress } from "./gitstatus";
import type { BranchesStateDTO, DeletePreviewDTO } from "../shared/types";

/** 分支列表（含 tip 主题，一次 for-each-ref 取回——对齐 GetBranchTipSubjects）。 */
export async function getBranches(workDir: string): Promise<BranchesStateDTO> {
  const fmt = "%(refname)%09%(objectname:short)%09%(subject)%09%(HEAD)";
  const [localOut, remoteOut, headOut] = await Promise.all([
    git(workDir, ["for-each-ref", `--format=${fmt}`, "refs/heads"]),
    tryGit(workDir, ["for-each-ref", `--format=${fmt}`, "refs/remotes", "--exclude=refs/remotes/*/HEAD"]),
    tryGit(workDir, ["branch", "--show-current"]),
  ]);

  const parse = (out: string, isRemote: boolean) =>
    out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [refname, shortSha, subject, head] = line.split("\t");
        return {
          // 远端名剥前缀：origin/main → origin/main（v1 保留全短名，仅去 refs/remotes/）
          name: isRemote ? refname.replace(/^refs\/remotes\//, "") : refname.replace(/^refs\/heads\//, ""),
          shortSha: shortSha ?? "",
          subject: subject ?? "",
          isHead: head === "*",
          isRemote,
        };
      });

  return {
    workDir,
    current: headOut.stdout.trim() || null,
    local: parse(localOut, false),
    remote: parse(remoteOut.stdout, true),
  };
}

export async function checkout(workDir: string, branch: string): Promise<void> {
  await git(workDir, ["checkout", branch]);
}

export async function createBranch(workDir: string, name: string, fromSha?: string | null): Promise<void> {
  await git(workDir, fromSha ? ["branch", name, fromSha] : ["branch", name]);
  // 对齐 WinUI 语义：创建即可选——这里只创建，检出由显式 checkout 触发
}

export async function renameBranch(workDir: string, oldName: string, newName: string): Promise<void> {
  await git(workDir, ["branch", "-m", oldName, newName]);
}

/** 删除前影响计算（对齐 RequestDeletePreview：未合并 → 需 -D；丢失提交样本 ≤3）。 */
export async function deletePreview(workDir: string, branch: string): Promise<DeletePreviewDTO> {
  const merged = await tryGit(workDir, ["merge-base", "--is-ancestor", branch, "HEAD"]);
  const forceRequired = merged.code !== 0;
  let lost: { shortSha: string; subject: string }[] = [];
  if (forceRequired) {
    const out = await git(workDir, ["rev-list", "HEAD.." + branch, "--format=%h %s"]);
    lost = out
      .split("commit ")
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [shortSha, ...rest] = r.split(/\s+/);
        return { shortSha, subject: rest.join(" ") };
      });
  }
  return { forceRequired, lostCount: lost.length, lostSamples: lost.slice(0, 3) };
}

export async function deleteBranch(workDir: string, branch: string, force: boolean): Promise<void> {
  const r = await tryGit(workDir, force ? ["branch", "-D", branch] : ["branch", "-d", branch]);
  if (r.code !== 0) throw new GitError(["branch"], r);
}

export async function mergeBranch(workDir: string, branch: string, noFastForward: boolean, message?: string | null): Promise<void> {
  const args = ["merge", ...(noFastForward ? ["--no-ff"] : []), ...(message ? ["-m", message] : []), branch];
  const r = await tryGit(workDir, args);
  if (r.code !== 0) throw new GitError(args, r);
}

export async function rebaseBranch(workDir: string, upstream: string): Promise<void> {
  const r = await tryGit(workDir, ["rebase", upstream]);
  if (r.code !== 0) throw new GitError(["rebase", upstream], r);
}

export async function fastForward(workDir: string, branch: string): Promise<void> {
  const r = await tryGit(workDir, ["merge", "--ff-only", branch]);
  if (r.code !== 0) throw new GitError(["merge", "--ff-only", branch], r);
}

export async function pull(workDir: string, rebase: boolean, onProgress?: SyncProgress): Promise<void> {
  const r = await pullWithProgress(workDir, rebase, onProgress);
  if (r.code !== 0) throw new GitError(["pull"], r);
}

export async function push(workDir: string, onProgress?: SyncProgress): Promise<void> {
  const r = await pushRaw(workDir, onProgress);
  if (r.code !== 0) throw new GitError(["push"], r);
}
