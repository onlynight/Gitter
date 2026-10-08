import { git, tryGit, GitError } from "./gitexec";
import { pullWithProgress, push as pushRaw, type SyncProgress } from "./gitstatus";
import type { BranchesStateDTO, DeletePreviewDTO, TagItemDTO } from "../shared/types";

/** 分支+tag 列表（含 tip 主题，一次 for-each-ref 取回——对齐 GetBranchTipSubjects）。 */
export async function getBranches(workDir: string): Promise<BranchesStateDTO> {
  const fmt = "%(refname)%09%(objectname:short)%09%(subject)%09%(HEAD)";
  const [localOut, remoteOut, tagsOut, headOut] = await Promise.all([
    git(workDir, ["for-each-ref", `--format=${fmt}`, "refs/heads"]),
    tryGit(workDir, ["for-each-ref", `--format=${fmt}`, "refs/remotes", "--exclude=refs/remotes/*/HEAD"]),
    tryGit(workDir, ["for-each-ref", "--format=%(refname:short)%09%(objectname:short)%09%(subject)", "--sort=refname", "refs/tags"]),
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

  const tags: TagItemDTO[] = tagsOut.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, shortSha, subject] = line.split("\t");
      return { name, shortSha: shortSha ?? "", subject: subject ?? "" };
    });

  return {
    workDir,
    current: headOut.stdout.trim() || null,
    local: parse(localOut, false),
    remote: parse(remoteOut.stdout, true),
    tags,
  };
}

export async function checkout(workDir: string, branch: string): Promise<void> {
  await git(workDir, ["checkout", branch]);
}

/** 检出远程分支（name 形如 origin/feature）为本地跟踪分支；同名本地分支已存在则直接检出它。返回本地分支名。 */
export async function checkoutRemote(workDir: string, name: string): Promise<string> {
  const slash = name.indexOf("/");
  if (slash <= 0 || slash === name.length - 1) throw new Error(`Not a remote branch: ${name}`);
  const local = name.slice(slash + 1);
  const exists = (await tryGit(workDir, ["show-ref", "--verify", "--quiet", "refs/heads/" + local])).code === 0;
  const args = exists ? ["checkout", local] : ["checkout", "-b", local, "--track", name];
  const r = await tryGit(workDir, args);
  if (r.code !== 0) throw new GitError(args, r);
  return local;
}

export async function createBranch(workDir: string, name: string, fromSha?: string | null, checkoutAfter?: boolean): Promise<void> {
  // 检出型创建走 checkout -b（原子，起点可省略）；否则只建分支——检出由显式 checkout 触发
  if (checkoutAfter) {
    await git(workDir, fromSha ? ["checkout", "-b", name, fromSha] : ["checkout", "-b", name]);
    return;
  }
  await git(workDir, fromSha ? ["branch", name, fromSha] : ["branch", name]);
}

/** tag 列表（创建分支起点 / 分支页右栏用；按名排序）。 */
export async function listTags(workDir: string): Promise<TagItemDTO[]> {
  const r = await tryGit(workDir, ["for-each-ref", "--format=%(refname:short)%09%(objectname:short)%09%(subject)", "--sort=refname", "refs/tags"]);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, shortSha, subject] = line.split("\t");
      return { name, shortSha: shortSha ?? "", subject: subject ?? "" };
    });
}

/** 删除本地 tag（git tag -d，只移除引用，不影响提交与远程）。 */
export async function deleteTag(workDir: string, name: string): Promise<void> {
  const r = await tryGit(workDir, ["tag", "-d", name]);
  if (r.code !== 0) throw new GitError(["tag", "-d", name], r);
}

/** 在指定提交上创建 tag（message 非空时为附注 tag）。 */
export async function createTag(workDir: string, name: string, sha: string, message?: string | null): Promise<void> {
  const args = ["tag", ...(message ? ["-m", message] : []), name, sha];
  const r = await tryGit(workDir, args);
  if (r.code !== 0) throw new GitError(args, r);
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

export async function mergeBranch(workDir: string, branch: string, noFastForward: boolean, message?: string | null, target?: string | null): Promise<void> {
  // 目标分支非当前分支时先检出目标（脏工作区 git checkout 会自行拒绝并报错）；target 缺省 = 当前分支
  if (target) {
    const cur = (await tryGit(workDir, ["branch", "--show-current"])).stdout.trim();
    if (cur !== target) await git(workDir, ["checkout", target]);
  }
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

/** 删除远程分支（name 形如 origin/feature；首个 / 前是 remote 名）。 */
export async function deleteRemoteBranch(workDir: string, name: string): Promise<void> {
  const slash = name.indexOf("/");
  if (slash <= 0 || slash === name.length - 1) throw new Error(`Not a remote branch: ${name}`);
  const remote = name.slice(0, slash);
  const branch = name.slice(slash + 1);
  const args = ["push", remote, "--delete", branch];
  const r = await tryGit(workDir, args);
  if (r.code !== 0) throw new GitError(args, r);
}

export async function pull(workDir: string, rebase: boolean, onProgress?: SyncProgress): Promise<void> {
  const r = await pullWithProgress(workDir, rebase, onProgress);
  if (r.code !== 0) throw new GitError(["pull"], r);
}

export async function push(workDir: string, onProgress?: SyncProgress): Promise<void> {
  const r = await pushRaw(workDir, onProgress);
  if (r.code !== 0) throw new GitError(["push"], r);
}
