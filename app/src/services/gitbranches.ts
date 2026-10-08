import { git, tryGit, GitError } from "./gitexec";
import { pullWithProgress, push as pushRaw, type SyncProgress } from "./gitstatus";
import type { BranchGraphDTO, BranchGraphRowDTO, BranchItemDTO, BranchesStateDTO, DeletePreviewDTO, ReflogEntryDTO, TagItemDTO } from "../shared/types";

/** 分支+tag 列表（含 tip 主题，一次 for-each-ref 取回——对齐 GetBranchTipSubjects）。
 * 本地分支附带 ahead/behind：有 upstream 用 %(upstream:track)，无 upstream 相对当前分支
 * （rev-list --left-right --count，上限 30 个分支防刷子仓库拖慢刷新）。 */
export async function getBranches(workDir: string): Promise<BranchesStateDTO> {
  const fmt = "%(refname)%09%(objectname:short)%09%(subject)%09%(HEAD)%09%(upstream:track)";
  const [localOut, remoteOut, tagsOut, headOut] = await Promise.all([
    git(workDir, ["for-each-ref", `--format=${fmt}`, "refs/heads"]),
    tryGit(workDir, ["for-each-ref", `--format=${fmt}`, "refs/remotes", "--exclude=refs/remotes/*/HEAD"]),
    tryGit(workDir, ["for-each-ref", "--format=%(refname:short)%09%(objectname:short)%09%(subject)", "--sort=refname", "refs/tags"]),
    tryGit(workDir, ["branch", "--show-current"]),
  ]);
  const current = headOut.stdout.trim() || null;

  const parse = (out: string, isRemote: boolean, withTrack: boolean): (BranchItemDTO & { refname: string; track: string })[] =>
    out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [refname, shortSha, subject, head, track] = line.split("\t");
        return {
          // 远端名剥前缀：origin/main → origin/main（v1 保留全短名，仅去 refs/remotes/）
          name: isRemote ? refname.replace(/^refs\/remotes\//, "") : refname.replace(/^refs\/heads\//, ""),
          shortSha: shortSha ?? "",
          subject: subject ?? "",
          isHead: head === "*",
          isRemote,
          refname,
          track: (withTrack ? (track ?? "").trim() : ""),
        };
      });

  const local = parse(localOut, false, true);
  const remote = parse(remoteOut.stdout, true, false);

  // 本地分支 ahead/behind：有 upstream 用 %(upstream:track)；无 upstream 相对当前分支
  // （rev-list --left-right --count，上限 30 个分支防超多分支仓库拖慢刷新）
  const need: BranchItemDTO[] = [];
  for (const b of local) {
    const track = b.track.replace(/^\[|\]$/g, "");
    if (track && track !== "gone") {
      const ahead = /ahead (\d+)/.exec(track)?.[1];
      const behind = /behind (\d+)/.exec(track)?.[1];
      if (ahead) b.ahead = Number(ahead);
      if (behind) b.behind = Number(behind);
    } else if (current && b.name !== current) {
      need.push(b);
    }
  }
  await Promise.all(need.slice(0, 30).map(async (b) => {
    const r = await tryGit(workDir, ["rev-list", "--left-right", "--count", `${current}...${b.name}`]);
    if (r.code !== 0) return;
    const [behind, ahead] = r.stdout.trim().split(/\s+/);
    if (ahead) b.ahead = Number(ahead);
    if (behind) b.behind = Number(behind);
  }));

  const tags: TagItemDTO[] = tagsOut.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, shortSha, subject] = line.split("\t");
      return { name, shortSha: shortSha ?? "", subject: subject ?? "" };
    });

  return {
    workDir,
    current,
    local: local.map(({ refname: _r, track: _t, ...rest }) => { void _r; void _t; return rest; }),
    remote: remote.map(({ refname: _r, track: _t, ...rest }) => { void _r; void _t; return rest; }),
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

/** ref 名守卫：防 "-开头被当 flag" 与路径穿越；分支名/tag 名/HEAD 均合法。 */
function guardRef(ref: string): string {
  if (!/^[A-Za-z0-9._/@{}~-]+$/.test(ref) || ref.startsWith("-")) throw new Error(`非法引用: ${ref}`);
  return ref;
}

/** 分支/引用的 reflog（最新在前，cap 条）。 */
export async function listReflog(workDir: string, ref: string, limit = 100): Promise<ReflogEntryDTO[]> {
  const safe = guardRef(ref);
  const fmt = "%H%x09%h%x09%gd%x09%gs%x09%at";
  const r = await tryGit(workDir, ["reflog", "show", safe, `--format=${fmt}`, "-n", String(limit)]);
  if (r.code !== 0) throw new GitError(["reflog", "show", safe], r);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, selector, subject, at] = line.split("\t");
      return { sha, shortSha: shortSha ?? "", selector: selector ?? "", subject: subject ?? "", timestamp: Number(at) || 0 };
    });
}

/** 强制移动分支指针到指定提交（git branch -f；分支在其它 worktree 检出时 git 自行拒绝）。 */
export async function moveBranch(workDir: string, branch: string, sha: string): Promise<void> {
  const safe = guardRef(branch);
  const args = ["branch", "-f", safe, sha];
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

/** 分支图（全部分支的提交泳道拓扑，date-order）。
 * 泳道指派：经典 walk——槽位表记录每条泳道“期望的下一提交”，提交落到匹配槽位；
 * 未匹配则新开泳道；首父占用原槽位、次父新开槽位（spawn）；其他槽位命中同一提交
 * 记为并入（merge，画分叉/合并曲线）。返回行带 lane/merges/spawns/slotAfter，
 * 前端按 id 稳定重放绘制（槽位索引可在行间平移，id 不变）。 */
export async function listGraph(workDir: string, limit = 300, skip = 0): Promise<BranchGraphDTO> {
  const cap = Math.min(Math.max(limit, 20), 1000);
  const args = ["log", "--branches", "--remotes", "--date-order", `--skip=${skip}`, "-n", String(cap + 1),
    "--pretty=format:%H%x09%h%x09%s%x09%an%x09%at%x09%P%x09%D"];
  const r = await tryGit(workDir, args);
  if (r.code !== 0) throw new GitError(args, r);
  let lines = r.stdout.split(/\r?\n/).filter(Boolean);
  const hasMore = lines.length > cap;
  if (hasMore) lines = lines.slice(0, cap);

  const slots: { sha: string | null; id: number }[] = [];
  let nextId = 0;
  const rows: BranchGraphRowDTO[] = [];
  for (const line of lines) {
    const [sha, shortSha, subject, author, at, parentsStr, decoRaw] = line.split('	');
    const parents = (parentsStr ?? '').split(' ').filter(Boolean);
    let li = slots.findIndex((s2) => s2.sha === sha);
    const merges: { from: number; to: number }[] = [];
    if (li < 0) { li = slots.length; slots.push({ sha, id: nextId++ }); }
    else {
      // 同提交的其他槽位 → 并入本槽位（从右往左收集；id 在移除前取，槽位索引会平移）
      for (let j = slots.length - 1; j >= 0; j--) {
        if (j !== li && slots[j].sha === sha) merges.unshift({ from: slots[j].id, to: slots[li].id });
      }
      for (const m of [...merges].sort((a, b) => b.from - a.from)) {
        const idx = slots.findIndex((s2) => s2.id === m.from);
        slots.splice(idx, 1);
      }
    }
    const laneId = slots[li].id;
    slots[li] = { sha: parents[0] ?? null, id: laneId };
    const spawns: number[] = [];
    for (const p of parents.slice(1)) { slots.push({ sha: p, id: nextId++ }); spawns.push(slots[slots.length - 1].id); }
    const refs = (decoRaw ?? '').split(', ').filter(Boolean).map((d): { name: string; isTag: boolean; isHead: boolean } => {
      if (d.startsWith('HEAD -> ')) return { name: d.slice(8), isTag: false, isHead: true };
      if (d.startsWith('tag: ')) return { name: d.slice(5), isTag: true, isHead: false };
      return { name: d, isTag: false, isHead: false };
    });
    rows.push({
      sha, shortSha: shortSha ?? '', subject: subject ?? '', author: author ?? '',
      timestamp: Number(at) || 0, lane: laneId, merges, spawns,
      slotAfter: slots.map((s2) => s2.id), refs,
    });
  }
  return { rows, hasMore };
}