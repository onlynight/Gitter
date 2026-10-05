/**
 * 无头烟雾验证（替代 C# headless 测试的首道防线）：
 * 不起窗口，直接对本仓库跑通 git 服务层主链路，失败非零退出。
 * 运行：npm run smoke（app/ 下）
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { tryGit, looksLikeRepo } from "./services/gitexec";
import { queryLog, listBranches, getCommit, commitFilesWithCounts, parseUnifiedDiff, fileDiff } from "./services/gitlog";
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

  // 回归（用户报告：非首条提交详情全挂）——queryLog 记录分隔解析曾产生带前导 \n 的 sha
  const badSha = page1.commits.find((x) => !/^[0-9a-f]{40}$/.test(x.sha));
  check("sha 无前导空白（记录分隔解析）", !badSha, badSha?.sha.slice(0, 12));
  const c2nd = page1.commits[1];
  if (c2nd) {
    const files2 = await commitFilesWithCounts(repo, c2nd.sha, null);
    const d2 = files2[0] ? await fileDiff(repo, c2nd.sha, files2[0].path, null) : null;
    check("非首条提交详情+diff 往返", !!d2 && (d2.hunks.length > 0 || d2.isBinary || files2.length === 0), `${c2nd.shortSha} ${files2.length}files`);
  }

  // ---- v2 移植面：安全网 / 会话聚合 / 高亮 / 反馈 / CLI 解析 ----
  const { scan } = await import("./services/safety");
  const findings = scan([
    {
      path: "leak.js",
      patch: [
        "diff --git a/leak.js b/leak.js",
        "--- a/leak.js",
        "+++ b/leak.js",
        "@@ -1,3 +1,4 @@",
        " ctx",
        "+const apiKey = \"sk-abc123def456ghijklmno\";",
        "+console.log(\"debug\");",
      ].join("\n"),
      isBinary: false,
      isNew: false,
      addedLines: 2,
      deletedLines: 0,
    },
  ]);
  const blocked = findings.filter((f) => f.severity === "blocked");
  const warned = findings.filter((f) => f.ruleId === "debug.residue");
  check("安全网：secret 泄露检出", blocked.length >= 1, blocked.map((f) => `${f.filePath}:${f.line}`).join(","));
  check("安全网：调试残留检出", warned.length === 1);

  const { groupSessions, readTrailers } = await import("./services/sessions");
  const mk = (sha: string, body: string, date: number): any => ({
    sha, shortSha: sha.slice(0, 7), subject: "s", body, author: "a", authorEmail: "e",
    authorDate: date, committerDate: date, parents: [], refs: [],
    assistedBy: body.match(/^assisted-by:\s*(.+)$/im)?.[1]?.trim() ? [body.match(/^assisted-by:\s*(.+)$/im)![1].trim()] : [],
    sessionId: /^gitter-session:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? null,
  });
  const now = Math.floor(Date.now() / 1000);
  const sessions = groupSessions([
    mk("c1", "s\n\nAssisted-by: claude\nGitter-Session: s1", now),
    mk("c2", "s\n\nAssisted-by: claude\nGitter-Session: s1", now - 60),
    mk("c3", "human commit", now - 120),
    mk("c4", "s\n\nAssisted-by: claude", now - 86400),
  ]);
  check(
    "会话聚合：同 session 成组、人写不聚、孤立不成组",
    sessions.length === 1 && sessions[0].commits.length === 2 && sessions[0].sessionId === "s1",
    `${sessions.length} 组`,
  );
  const tr = readTrailers("msg\n\nAssisted-by: codex\nGitter-Session: abc");
  check("trailer 解析", tr.assistedBy === "codex" && tr.sessionId === "abc");

  const { HighlightService } = await import("./services/highlight");
  const hs = new HighlightService(path.join(__dirname, "..", "resources", "syntax", "highlighters.json"));
  const hl = hs.forFile("Test.cs");
  check("高亮：语言识别（.cs）", !!hl, hl?.id);
  if (hl) {
    const r = hs.highlightLines(hl, ["// hello", "const int x = 1;"]);
    check(
      "高亮：注释/关键词着色",
      r.lines[0][0]?.style === "comment" && r.lines[1].some((x) => x.style === "keyword"),
      JSON.stringify(r.lines[1]?.slice(0, 3)),
    );
  }

  const { parseCliCommand } = await import("./services/ai");
  const [exe, args] = parseCliCommand('"C:\\Program Files\\tool\\ai.exe" -p --stdin');
  check("CLI 桥命令解析", exe.endsWith("ai.exe") && args.length === 2, `${exe} ${args.join(" ")}`);

  const fb = await import("./services/feedback");
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-fb-"));
  fb.writeFeedback(tmpRepo, "check line 42", "a.ts");
  const gotFb = fb.readFeedback(tmpRepo);
  check("agent 反馈读写", !!gotFb && gotFb.note === "check line 42" && gotFb.path === "a.ts");
  fb.clearFeedback(tmpRepo);
  check("agent 反馈清除", fb.readFeedback(tmpRepo) === null);
  fs.rmSync(tmpRepo, { recursive: true, force: true });

  // Git 配置读写 + 层级 + remote（合成仓库，不碰真实用户配置）
  const cfgRepo = fs.mkdtempSync(path.join(os.tmpdir(), "gitter-cfg-"));
  await tryGit(cfgRepo, ["init"]);
  const gc = await import("./services/gitconfig");
  await gc.setConfig(cfgRepo, "user.name", "测试者", "repo");
  await gc.setConfig(cfgRepo, "push.autoSetupRemote", "true", "repo");
  const localMap = await gc.listConfig(cfgRepo, "repo");
  check("gitconfig 写读（repo）", localMap["user.name"] === "测试者" && localMap["push.autosetupremote"] === "true");
  check("gitconfig 有效值", (await gc.effectiveConfig(cfgRepo, "user.name")) === "测试者");
  await gc.setConfig(cfgRepo, "push.autoSetupRemote", null, "repo");
  check("gitconfig unset", (await gc.effectiveConfig(cfgRepo, "push.autoSetupRemote")) === null);
  let up: { message: string; result: { stderr: string } };
  try {
    const r = await gc.pushSetUpstream(cfgRepo);
    up = { message: "unexpectedly pushed", result: { stderr: JSON.stringify(r) } };
  } catch (e) {
    up = { message: (e as Error).message, result: { stderr: (e as { result?: { stderr?: string } }).result?.stderr ?? "" } };
  }
  check("pushSetUpstream：无远程 → NO_REMOTE", /NO_REMOTE/.test(up.message + up.result.stderr));
  fs.rmSync(cfgRepo, { recursive: true, force: true });

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
