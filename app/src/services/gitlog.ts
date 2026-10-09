import { git, GitError } from "./gitexec";
import type { CommitDTO, DiffDTO, FileMetaDTO, HunkDTO, RefDTO } from "../shared/types";

// ---------------------------------------------------------------------------
// unified diff 解析（对齐 C# ParseUnifiedDiff 语义：hunk/EOF 标志/二进制/重命名）
// ---------------------------------------------------------------------------

const DIFF_FILE_PREFIX = "diff --git ";

/** 解析 `git diff` 输出为 DiffDTO 列表。空输入返回空数组。 */
export function parseUnifiedDiff(patch: string): DiffDTO[] {
  if (!patch) return [];
  const files: DiffDTO[] = [];
  // 按 "diff --git " 切分（patch 正文行以 +/−/空格/@/\ 开头，不会误切）
  const sections = patch.split("\n").reduce<string[][]>((acc, line) => {
    if (line.startsWith(DIFF_FILE_PREFIX)) acc.push([line]);
    else if (acc.length > 0) acc[acc.length - 1].push(line);
    return acc;
  }, []);

  for (const lines of sections) {
    const file = parseFileSection(lines);
    if (file) files.push(file);
  }
  return files;
}

function parseFileSection(lines: string[]): DiffDTO | null {
  const header = lines[0]; // diff --git a/x b/y
  const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
  if (!m) return null;
  const oldPathFull = m[1];
  const newPathFull = m[2];

  let isNew = false;
  let isDeleted = false;
  let isRenamed = false;
  let isBinary = false;
  let oldPath = oldPathFull;
  let path_ = newPathFull;
  const hunks: HunkDTO[] = [];
  let added = 0;
  let deleted = 0;
  let oldEof = true;
  let newEof = true;

  let i = 1;
  let cur: HunkDTO | null = null;
  let lastSide: "old" | "new" | "ctx" | null = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("new file mode")) isNew = true;
    else if (line.startsWith("deleted file mode")) isDeleted = true;
    else if (line.startsWith("rename from ")) { isRenamed = true; oldPath = line.slice("rename from ".length); }
    else if (line.startsWith("rename to ")) { isRenamed = true; path_ = line.slice("rename to ".length); }
    else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) isBinary = true;
    else if (line.startsWith("--- ")) {
      if (line === "--- /dev/null") { isNew = true; oldPath = path_; }
    } else if (line.startsWith("+++ ")) {
      if (line === "+++ /dev/null") { isDeleted = true; path_ = oldPath; }
    } else if (line.startsWith("@@")) {
      const hm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (hm) {
        cur = {
          oldStart: parseInt(hm[1], 10),
          oldCount: hm[2] === undefined ? 1 : parseInt(hm[2], 10),
          newStart: parseInt(hm[3], 10),
          newCount: hm[4] === undefined ? 1 : parseInt(hm[4], 10),
          oldLines: [],
          newLines: [],
        };
        hunks.push(cur);
        lastSide = null;
      }
    } else if (line.startsWith("\\ No newline at end of file")) {
      // 归属最近内容行：'+'→新侧，'-'→旧侧，上下文→两侧
      if (lastSide === "new") newEof = false;
      else if (lastSide === "old") oldEof = false;
      else if (lastSide === "ctx") { oldEof = false; newEof = false; }
    } else if (cur) {
      if (line.startsWith("+")) { cur.newLines.push(line); added++; lastSide = "new"; }
      else if (line.startsWith("-")) { cur.oldLines.push(line); deleted++; lastSide = "old"; }
      else if (line.startsWith(" ") || line === "") { cur.oldLines.push(line || " "); cur.newLines.push(line || " "); lastSide = "ctx"; }
      // 其余行（index 等）忽略
    }
    i++;
  }

  return {
    path: path_,
    oldPath,
    isBinary,
    isNew,
    isDeleted,
    isRenamed,
    hunks,
    addedLines: added,
    deletedLines: deleted,
    oldEndsWithNewline: oldEof,
    newEndsWithNewline: newEof,
  };
}

// ---------------------------------------------------------------------------
// git log 查询
// ---------------------------------------------------------------------------

const SEP = "\x1f"; // 字段分隔
const REC = "\x1e"; // 记录分隔
const LOG_FORMAT = ["%H", "%h", "%an", "%ae", "%at", "%ct", "%s", "%b", "%P", "%D"].join(SEP) + REC;

export interface LogQuery {
  branch?: string | null;
  query?: string | null; // author:xxx / agent:xxx / 裸文本=主题子串（对齐 LogFilterParser 语义子集）
  limit?: number;
  skip?: number;
}

function parseQuery(query: string | null | undefined): { author?: string; agent?: string; grep?: string } {
  if (!query) return {};
  const trimmed = query.trim();
  const author = /^author:(.*)$/i.exec(trimmed);
  if (author) return { author: author[1] };
  const agent = /^agent:(.*)$/i.exec(trimmed);
  if (agent) return { agent: agent[1] || "*" };
  return { grep: trimmed };
}

export async function queryLog(workDir: string, q: LogQuery): Promise<{ commits: CommitDTO[]; hasMore: boolean }> {
  const args = ["log", `--format=${LOG_FORMAT}`, "--date-order"];
  const limit = q.limit ?? 50;
  args.push("-n", String(limit + 1)); // 多取一条探测 hasMore
  if ((q.skip ?? 0) > 0) args.push("--skip", String(q.skip));
  const parsed = parseQuery(q.query);
  if (parsed.author) args.push("--author", parsed.author);
  if (parsed.agent) {
    // agent 过滤：任意 Assisted-By = grep trailer 键；具体值 = 大小写不敏感子串
    args.push("--grep", parsed.agent === "*" ? "Assisted-By:" : parsed.agent, "-i");
  }
  if (parsed.grep) args.push("--grep", parsed.grep, "-i", "-F");
  if (q.branch) args.push(q.branch);

  let out: string;
  try {
    out = await git(workDir, args);
  } catch (e) {
    // 空仓库（git init 后还没有提交）：git log 对 unborn HEAD 报 fatal——视为空日志
    if (e instanceof GitError && /does not have any commits yet/i.test(e.result.stderr)) {
      return { commits: [], hasMore: false };
    }
    throw e;
  }
  // git log 每条记录以 \x1e 结尾、后跟换行——split 后从第二条起带前导 \n，必须 trim
  const records = out.split(REC).map((r) => r.trimStart()).filter((r) => r.length > 0);
  const hasMore = records.length > limit;
  const commits = records.slice(0, limit).map(parseCommitRecord).filter((c): c is CommitDTO => c !== null);
  return { commits, hasMore };
}

function parseRefs(refsField: string): RefDTO[] {
  if (!refsField.trim()) return [];
  // %D: "HEAD -> main, origin/main, tag: v1.0"
  return refsField
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((raw) => {
      let name = raw;
      let isTag = false;
      if (name.startsWith("HEAD -> ")) name = name.slice(8);
      if (name.startsWith("tag: ")) { isTag = true; name = name.slice(5); }
      return { name, isTag };
    });
}

function parseAssistedBy(body: string): string[] {
  const found: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^Assisted-By:\s*(.+)$/i.exec(line.trim());
    if (m) found.push(m[1].trim());
  }
  return found;
}

/** Gitter-Session trailer（会话分组键，只看最后一段落）。 */
function parseSessionId(body: string): string | null {
  if (!body) return null;
  const blocks = body.trimEnd().split(/\r\n\r\n|\n\n/);
  const m = /^gitter-session:[ \t]*(.+)$/im.exec(blocks[blocks.length - 1]);
  return m ? m[1].trim() : null;
}

function parseCommitRecord(rec: string): CommitDTO | null {
  const cols = rec.split(SEP);
  if (cols.length < 10) return null;
  const [sha, shortSha, author, email, at, ct, subject, body, parents, refs] = cols;
  return {
    sha,
    shortSha,
    subject,
    body: body ?? "",
    author,
    authorEmail: email,
    authorDate: parseInt(at, 10) || 0,
    committerDate: parseInt(ct, 10) || 0,
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    refs: parseRefs(refs ?? ""),
    assistedBy: parseAssistedBy(body ?? ""),
    sessionId: parseSessionId(body ?? ""),
  };
}

// ---------------------------------------------------------------------------
// 提交详情 / 文件 diff
// ---------------------------------------------------------------------------

/** 提交变更文件列表（对父提交，或 base..sha 树 diff）。--root 对非根提交无副作用。 */
export async function commitFiles(workDir: string, sha: string, baseSha?: string | null): Promise<FileMetaDTO[]> {
  const range = baseSha ? [baseSha, sha] : ["--root", sha];
  const out = await git(workDir, ["diff-tree", "-r", "--no-commit-id", "--name-status", "-M", "-z", ...range]);
  return parseNameStatusZ(out);
}

function parseNameStatusZ(out: string): FileMetaDTO[] {
  const items: FileMetaDTO[] = [];
  const parts = out.split("\0").filter((p) => p.length > 0);
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    if (/^[MADTURC]$/.test(status)) {
      const path_ = parts[i + 1] ?? "";
      items.push({ path: path_, statusCode: status, added: null, deleted: null });
      i += 2;
    } else if (/^R\d*$/.test(status) || /^C\d*$/.test(status)) {
      const from = parts[i + 1] ?? "";
      const to = parts[i + 2] ?? "";
      items.push({ path: to, oldPath: from, statusCode: status[0], added: null, deleted: null });
      i += 3;
    } else {
      i += 1; // 未知格式，步进防死循环
    }
  }
  return items;
}

/** 变更文件 + 行数统计（numstat 二次查询合并）。 */
export async function commitFilesWithCounts(
  workDir: string,
  sha: string,
  baseSha?: string | null,
): Promise<FileMetaDTO[]> {
  const files = await commitFiles(workDir, sha, baseSha);
  const range = baseSha ? [baseSha, sha] : ["--root", sha];
  const out = await git(workDir, ["diff-tree", "-r", "--no-commit-id", "--numstat", "-M", "-z", ...range]);
  // numstat -z: added\tpath? 实际格式 "added\tdeleted\tpath\0"，重命名为 "added\tdeleted\t{old => new}"
  const map = new Map<string, { added: number | null; deleted: number | null }>();
  const lines = out.split("\0").filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const tab = line.split("\t");
    if (tab.length >= 3) {
      const added = tab[0] === "-" ? null : parseInt(tab[0], 10);
      const deleted = tab[1] === "-" ? null : parseInt(tab[1], 10);
      let p = tab.slice(2).join("\t");
      const rename = /^\{(.+) => (.+)\}$/.exec(p);
      if (rename) p = rename[2];
      map.set(p, { added, deleted });
    }
  }
  for (const f of files) {
    const n = map.get(f.oldPath && f.statusCode === "R" ? f.oldPath : f.path);
    if (n) { f.added = n.added; f.deleted = n.deleted; }
  }
  return files;
}

/** 单文件 diff：提交对第一父提交（根提交经 diff-tree -p --root，git diff 不认 --root）。 */
export async function fileDiff(workDir: string, sha: string, path_: string, baseSha?: string | null): Promise<DiffDTO> {
  let patch: string;
  if (baseSha) {
    patch = await git(workDir, ["diff", "--no-color", baseSha, sha, "--", path_]);
  } else {
    patch = await git(workDir, ["diff-tree", "--no-color", "-p", "--root", sha, "--", path_]);
  }
  const files = parseUnifiedDiff(patch);
  return (
    files[0] ?? {
      path: path_, oldPath: path_, isBinary: false, isNew: false, isDeleted: false, isRenamed: false,
      hunks: [], addedLines: 0, deletedLines: 0, oldEndsWithNewline: true, newEndsWithNewline: true,
    }
  );
}

export async function getCommit(workDir: string, sha: string): Promise<CommitDTO | null> {
  const out = await git(workDir, ["show", "-s", `--format=${LOG_FORMAT}`, sha]);
  return parseCommitRecord(out.split(REC)[0] ?? "");
}

/** 列出分支（log 页下拉用，轻量）。 */
export async function listBranches(workDir: string): Promise<{ current: string | null; names: string[] }> {
  const out = await git(workDir, ["branch", "--list", "--format=%(refname:short)\t%(HEAD)"]);
  let current: string | null = null;
  const names: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const [name, head] = line.split("\t");
    names.push(name);
    if (head === "*") current = name;
  }
  return { current, names };
}
