/**
 * 无头烟雾验证（替代 C# headless 测试的首道防线）：
 * 不起窗口，直接对本仓库跑通 git 服务层主链路，失败非零退出。
 * 运行：npm run smoke（app/ 下）
 */
import * as path from "path";
import { tryGit, looksLikeRepo } from "./services/gitexec";
import { queryLog, listBranches, getCommit, commitFilesWithCounts, parseUnifiedDiff } from "./services/gitlog";
import { getStatus, worktreeFileDiff } from "./services/gitstatus";
import { getBranches } from "./services/gitbranches";
import { listWorktrees } from "./services/worktrees";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function main() {
  const repo = process.env.GITTER_SMOKE_REPO ?? "D:\\Code\\Gitter";
  console.log(`== git 服务层无头烟雾 ==\nrepo: ${repo}\n`);

  const gv = await tryGit(repo, ["--version"]);
  check("git 可用", gv.code === 0, gv.stdout.trim());
  check("是 git 仓库", looksLikeRepo(repo));

  // log
  const t0 = Date.now();
  const page1 = await queryLog(repo, { limit: 50 });
  const ms1 = Date.now() - t0;
  check("log.query 首页 50 条", page1.commits.length === 50 && page1.hasMore, `${page1.commits.length} 条 / ${ms1}ms`);

  const t1 = Date.now();
  const big = await queryLog(repo, { limit: 500 });
  check("log.query 500 条（全量回退）", big.commits.length >= 50 && !big.hasMore, `${big.commits.length} 条 / ${Date.now() - t1}ms`);
  const c = page1.commits[0];
  check("提交字段完整", !!(c.sha && c.subject && c.author && c.committerDate > 0), `${c.shortSha} ${c.subject.slice(0, 30)}`);

  // 分支
  const lb = await listBranches(repo);
  check("log.branches", lb.names.length > 0 && !!lb.current, `current=${lb.current}`);
  const bs = await getBranches(repo);
  check("branches.state", bs.local.length > 0, `local=${bs.local.length} remote=${bs.remote.length}`);

  // 提交详情 + 文件
  const detail = await commitFilesWithCounts(repo, c.sha, null);
  check("commitFilesWithCounts", detail.length >= 0, `${detail.length} 个文件`);
  if (detail.length > 0) {
    const d = await worktreeFileDiffCall(repo, c.sha, detail[0].path);
    check("fileDiff hunks 解析", d.hunks.length > 0 || d.isBinary, `${d.path} +${d.addedLines}/-${d.deletedLines} hunks=${d.hunks.length}`);
  }

  // 工作区状态（本仓库应可解析，四组均为数组）
  const st = await getStatus(repo);
  check(
    "changes.state 四分类",
    Array.isArray(st.changes) && Array.isArray(st.staged) && Array.isArray(st.unversioned) && Array.isArray(st.conflicts),
    `changes=${st.changes.length} staged=${st.staged.length} unversioned=${st.unversioned.length} conflicts=${st.conflicts.length}`,
  );

  // diff 解析器单测（构造含 EOF 标志/重命名的 patch）
  const sample = [
    "diff --git a/a.txt b/b.txt",
    "similarity index 90%",
    "rename from a.txt",
    "rename to b.txt",
    "--- a/a.txt",
    "+++ b/b.txt",
    "@@ -1,3 +1,3 @@",
    " ctx",
    "-old",
    "+new",
    " ctx",
    "\\ No newline at end of file",
  ].join("\n");
  const parsed = parseUnifiedDiff(sample)[0];
  check(
    "unified diff 解析（rename/EOF）",
    !!parsed && parsed.isRenamed && parsed.path === "b.txt" && !parsed.newEndsWithNewline && parsed.hunks.length === 1,
  );

  // worktree（本仓库通常只有主 worktree）
  const wts = await listWorktrees(repo);
  check("worktree list", wts.length >= 1 && wts[0].isMain, `${wts.length} 个`);

  // 提交读取
  const got = await getCommit(repo, c.sha);
  check("getCommit", !!got && got.sha === c.sha);

  console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

async function worktreeFileDiffCall(repo: string, sha: string, p: string) {
  const { fileDiff } = await import("./services/gitlog");
  return fileDiff(repo, sha, p, null);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
