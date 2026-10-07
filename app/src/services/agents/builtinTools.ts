import { spawn } from "child_process";
import * as fsp from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { tryGit } from "../gitexec";
import * as status from "../gitstatus";
import * as safety from "../safety";
import { readFeedback } from "../feedback";
import { registerAgentTool, type ToolEnv } from "./registry";
import {
  globMatch, isImageExt, lineDiffOf, looksBinary, nearestSimilarLine,
  readFileText, resolveSafe, statSafe,
} from "./fsx";
import type { FileChangeKind } from "./types";

/**
 * 内置工具全集（agent-harness-v4.md F2/F3/F4/F5/F8/F9）：
 * 经 registerAgentTool 自举注册——与插件/MCP 工具同一条入表路径（§14.4 无特判）。
 * 权限门/规则门在 buildToolset 包装层统一生效，这里只写执行体与授权卡文案。
 */

const normRel = (p: string): string => p.replace(/\\/g, "/");

function err(e: unknown): string {
  return `错误：${(e as Error).message}`;
}

async function gitOut(wd: string, args: string[], cap = 20_000): Promise<string> {
  const r = await tryGit(wd, args);
  if (r.code !== 0) return `错误：${r.stderr.trim().slice(0, 500)}`;
  const out = r.stdout;
  return out.length > cap ? out.slice(0, cap) + `\n…（输出已截断，共 ${out.length} 字符）` : out;
}

/** 外部进程执行（repo_grep 的 rg 探测与调用）。 */
function runProc(exe: string, args: string[], cwd: string, timeoutMs = 20_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { cwd, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e) });
      return;
    }
    const outs: Buffer[] = [];
    const errs: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (d: Buffer) => outs.push(d));
    child.stderr?.on("data", (d: Buffer) => errs.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(outs).toString("utf8"),
        stderr: Buffer.concat(errs).toString("utf8"),
      });
    });
  });
}

let rgAvailable: boolean | null = null;
async function hasRipgrep(): Promise<boolean> {
  if (rgAvailable === null) {
    const r = await runProc("rg", ["--version"], process.cwd(), 5000);
    rgAvailable = r.code === 0;
  }
  return rgAvailable;
}

// ================ 只读：仓库状态 ================

registerAgentTool({
  name: "repo_status",
  description: "查看工作区状态：暂存/未暂存/未跟踪/冲突文件列表与计数",
  parametersSchema: z.object({}),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env) {
    const st = await status.getStatus(env.worktreePath);
    const all = [...st.staged, ...st.changes, ...st.unversioned, ...st.conflicts];
    return JSON.stringify({
      staged: st.staged.length, modified: st.changes.length,
      unversioned: st.unversioned.length, conflicts: st.conflicts.length,
      files: all.slice(0, 50).map((f) => `[${f.category}] ${f.path}`),
    });
  },
});

registerAgentTool({
  name: "repo_diff",
  description: "查看 diff。可看工作区/暂存区/相对某基线提交的变更",
  parametersSchema: z.object({
    path: z.string().optional().describe("限定文件（可选）"),
    staged: z.boolean().optional().describe("true = 暂存区 vs HEAD"),
    baseline: z.string().optional().describe("基线提交 SHA（工作区+提交 vs 该基线）"),
  }),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env, args) {
    const p = typeof args.path === "string" ? args.path : undefined;
    const abs = p ? await resolveSafe(env.worktreePath, p) : null;
    const gitArgs = ["diff", "--no-color"];
    if (args.staged) gitArgs.push("--cached");
    if (args.baseline) gitArgs.push(String(args.baseline));
    if (abs) gitArgs.push("--", abs);
    return gitOut(env.worktreePath, gitArgs);
  },
});

registerAgentTool({
  name: "repo_log",
  description: "查看提交历史（最近 N 条，默认 20）",
  parametersSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env, args) {
    const limit = Math.max(1, Math.min(Number(args.limit ?? 20), 100));
    const r = await tryGit(env.worktreePath, ["log", "--pretty=format:%h %s (%an)", `-n${limit}`]);
    return r.code === 0 ? r.stdout : err(new Error(r.stderr));
  },
});

registerAgentTool({
  name: "review_get_state",
  description: "查看人类的验收反馈状态（审查意见/涉及文件），修复轮开始前先了解验收结论",
  parametersSchema: z.object({}),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env) {
    const fb = readFeedback(env.worktreePath);
    if (!fb) return JSON.stringify({ state: "no-feedback", note: null });
    return JSON.stringify({ state: "feedback", note: fb.note, path: fb.path, createdAt: fb.createdAt });
  },
});

// ================ 只读：文件读面（F2） ================

registerAgentTool({
  name: "repo_read_file",
  description:
    "读取 worktree 内文本文件（带行号）。默认从第 1 行读 2000 行 / 96KB；续读传 offsetLine。" +
    "编辑前必须先读本文件（写前读校验）",
  parametersSchema: z.object({
    path: z.string().min(1),
    offsetLine: z.number().int().min(1).optional().describe("起始行（1 起）"),
    lineCount: z.number().int().min(1).max(2000).optional().describe("读取行数（默认 2000）"),
  }),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env, args) {
    const rel = normRel(String(args.path));
    const abs = await resolveSafe(env.worktreePath, rel);
    const st = await statSafe(abs);
    if (!st) return `错误：文件不存在：${rel}`;

    if (isImageExt(abs)) {
      env.noteFileChange(rel, "read-image");
      return `（图片文件：${rel}，${st.size} 字节。已在任务时间线附件区可预览；如需分析内容请说明需求）`;
    }

    const head = await fsp.readFile(abs).then(
      (b) => b.subarray(0, Math.min(b.length, 8192)),
      () => Buffer.alloc(0),
    );
    if (looksBinary(head)) {
      return `错误：${rel} 疑似二进制文件（${st.size} 字节），不提供文本读取。`;
    }

    const raw = await readFileText(abs);
    const isCrlf = raw.includes("\r\n");
    const lines = raw.split(/\r?\n/);
    // 尾部分隔符产生的空行不计
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const total = lines.length;
    const offset = Math.max(1, Number(args.offsetLine ?? 1));
    const count = Math.min(Number(args.lineCount ?? 2000), 2000);
    const slice = lines.slice(offset - 1, offset - 1 + count);
    let out = "";
    let used = 0;
    const capChars = 96_000;
    let shown = 0;
    for (let i = 0; i < slice.length; i++) {
      const line = `${String(offset + i).padStart(6)}\t${slice[i]}`;
      if (used + line.length > capChars) break;
      out += line + "\n";
      used += line.length;
      shown++;
    }
    env.readLog.set(normRel(path.relative(env.worktreePath, abs)), { mtimeMs: st.mtimeMs, size: st.size });
    const tail =
      shown < slice.length
        ? `…（96KB 截断）\n`
        : "";
    const endLine = offset + shown - 1;
    const note =
      endLine < total
        ? `（第 ${offset}–${endLine} 行，共 ${total} 行；续读用 offsetLine=${endLine + 1}）`
        : `（第 ${offset}–${endLine} 行，共 ${total} 行）`;
    return tail + out + note + (isCrlf ? " [CRLF 文件：patch 的 oldString 需以 \r 行尾匹配]" : "");
  },
});

registerAgentTool({
  name: "repo_list_files",
  description: "列出 worktree 内文件（小目录速览；检索请优先 repo_glob / repo_grep）",
  parametersSchema: z.object({ dir: z.string().optional() }),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env, args) {
    const base = args.dir ? await resolveSafe(env.worktreePath, String(args.dir)) : env.worktreePath;
    const skip = new Set([".git", "node_modules", "dist", "target", "bin", "obj"]);
    const out: string[] = [];
    // 异步迭代目录（async IO，F1.3），深度上限 8
    const stack: { d: string; depth: number }[] = [{ d: base, depth: 0 }];
    while (stack.length > 0 && out.length < 200) {
      const { d, depth } = stack.shift()!;
      let entries: import("fs").Dirent[];
      try {
        entries = await fsp.readdir(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (out.length >= 200) break;
        if (skip.has(e.name)) continue;
        const rel = normRel(path.relative(env.worktreePath, path.join(d, e.name)));
        if (e.isDirectory()) {
          out.push(rel + "/");
          if (depth < 8) stack.push({ d: path.join(d, e.name), depth: depth + 1 });
        } else out.push(rel);
      }
    }
    return out.length > 0 ? out.join("\n") : "（空）";
  },
});

registerAgentTool({
  name: "repo_glob",
  description: "按 glob 模式找文件（如 src/**/*.ts、*.json）。尊重 .gitignore，含未跟踪文件",
  parametersSchema: z.object({
    pattern: z.string().min(1).describe("glob 模式，** 跨目录"),
    dir: z.string().optional().describe("限定目录（相对 worktree）"),
  }),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env, args) {
    const pattern = String(args.pattern);
    const r = await tryGit(env.worktreePath, ["ls-files", "-co", "--exclude-standard"]);
    if (r.code !== 0) return err(new Error(r.stderr));
    const prefix = args.dir ? normRel(String(args.dir)).replace(/\/+$/, "") + "/" : "";
    const hits: string[] = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const rel = normRel(line.trim());
      if (!rel) continue;
      if (prefix && !rel.startsWith(prefix)) continue;
      if (globMatch(pattern, rel)) hits.push(rel);
    }
    hits.sort();
    if (hits.length === 0) return `无匹配（pattern=${pattern}${prefix ? `，dir=${prefix}` : ""}）。可尝试放宽模式。`;
    const cap = hits.slice(0, 200);
    return cap.join("\n") + (hits.length > 200 ? `\n…（共 ${hits.length} 个命中，仅显示前 200；请缩小 pattern）` : "");
  },
});

registerAgentTool({
  name: "repo_grep",
  description:
    "按正则在文件内容中搜索（优先 ripgrep，退 git grep）。返回 path:line:text。" +
    "rg 支持 \\d 简写，git grep 退回 POSIX ERE",
  parametersSchema: z.object({
    pattern: z.string().min(1),
    glob: z.string().optional().describe("文件名过滤，如 *.ts"),
    dir: z.string().optional(),
    ignoreCase: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(200).optional().describe("默认 100"),
  }),
  permissionClass: "auto",
  source: "builtin",
  readonly: true,
  async execute(env, args) {
    const pattern = String(args.pattern);
    const max = Math.min(Number(args.maxResults ?? 100), 200);
    const dirAbs = args.dir ? await resolveSafe(env.worktreePath, String(args.dir)) : env.worktreePath;
    const cap = (s: string) => (s.length > 400 ? s.slice(0, 400) + "…" : s);

    if (await hasRipgrep()) {
      const rgArgs = ["-n", "--no-heading", "--max-count", "80", "--no-config", "--glob", "!.git"];
      if (args.ignoreCase) rgArgs.push("-i");
      if (args.glob) rgArgs.push("-g", String(args.glob));
      rgArgs.push("-e", pattern, ".");
      const r = await runProc("rg", rgArgs, dirAbs);
      const lines = r.stdout.split(/\r?\n/).filter(Boolean).map(cap);
      if (lines.length === 0) {
        return r.code === 0 ? "无匹配。" : `rg 失败：${r.stderr.trim().slice(0, 200)}（可检查正则语法）`;
      }
      return lines.slice(0, max).join("\n") + (lines.length > max ? `\n…（共 ${lines.length} 行命中，已截断）` : "");
    }

    const ggArgs = ["grep", "-n", "-I", "--untracked", "-E", "-e", pattern];
    if (args.ignoreCase) ggArgs.push("-i");
    if (args.glob) ggArgs.push("--", String(args.glob));
    const r = await tryGit(env.worktreePath, ggArgs);
    if (r.code === 1) return "无匹配。";
    if (r.code !== 0) return `错误：git grep 失败：${r.stderr.trim().slice(0, 200)}`;
    const lines = r.stdout.split(/\r?\n/).filter(Boolean).map(cap);
    return lines.slice(0, max).join("\n") + (lines.length > max ? `\n…（共 ${lines.length} 行命中，已截断）` : "");
  },
});

// ================ 写面（F3） ================

async function guardWritable(env: ToolEnv, rel: string): Promise<string | null> {
  const abs = await resolveSafe(env.worktreePath, rel);
  const st = await statSafe(abs);
  if (st && st.size > 2 * 1024 * 1024) return `错误：目标文件超过 2MB 护栏（${st.size} 字节），拒绝写入。`;
  return null;
}

function afterWrite(env: ToolEnv, rel: string, oldText: string | null, newText: string): string {
  const kind: FileChangeKind = oldText === null ? "added" : "modified";
  const stat = oldText === null ? { added: newText.split(/\r?\n/).length, deleted: 0 } : lineDiffOf(oldText, newText);
  const summary = `+${stat.added} −${stat.deleted}`;
  env.noteFileChange(rel, kind, summary);
  return summary;
}

registerAgentTool({
  name: "file_write",
  description:
    "写入/覆盖 worktree 内的文本文件（整文件内容）。新建文件用；定点修改优先 file_patch。" +
    "单次 ≤512KB",
  parametersSchema: z.object({
    path: z.string().min(1),
    content: z.string().max(512 * 1024),
  }),
  permissionClass: "auto",
  source: "builtin",
  async execute(env, args) {
    const rel = normRel(String(args.path));
    const g = await guardWritable(env, rel);
    if (g) return g;
    const abs = await resolveSafe(env.worktreePath, rel);
    const existed = await statSafe(abs);
    let oldText: string | null = null;
    if (existed) {
      oldText = await readFileText(abs);
      if (!env.readLog.has(rel)) {
        // 覆盖前未读取：放行但警告（写场景常为新建/模板）
        env.emit({ type: "log", level: "warn", text: `file_write 覆盖未读文件：${rel}` });
      }
    }
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, String(args.content), "utf8");
    const st2 = await statSafe(abs);
    if (st2) env.readLog.set(rel, { mtimeMs: st2.mtimeMs, size: st2.size });
    const summary = afterWrite(env, rel, oldText, String(args.content));
    return `已写入 ${rel}（${String(args.content).length} 字符，${summary}）${oldText !== null && !env.readLog.has(rel) ? "（警告：覆盖前未读取）" : ""}`;
  },
});

registerAgentTool({
  name: "file_patch",
  description:
    "定点编辑：把文件中的旧串精确替换为新串（edits 批量，原子生效——任一 oldString 不存在则整体不写）。" +
    "编辑前必须先 repo_read_file 同一文件。多次出现需加长上下文或 replaceAll",
  parametersSchema: z.object({
    path: z.string().min(1),
    edits: z.array(z.object({
      oldString: z.string().min(1),
      newString: z.string(),
    })).min(1).max(20),
    replaceAll: z.boolean().optional(),
  }),
  permissionClass: "auto",
  source: "builtin",
  async execute(env, args) {
    const rel = normRel(String(args.path));
    const abs = await resolveSafe(env.worktreePath, rel);
    const st = await statSafe(abs);
    if (!st) return `错误：文件不存在：${rel}（新建文件请用 file_write）`;
    const g = await guardWritable(env, rel);
    if (g) return g;

    // 写前读校验（F3.2 硬规则）
    const seen = env.readLog.get(rel);
    if (!seen) {
      return `错误：文件尚未在本会话读取过，请先 repo_read_file ${rel} 再编辑。`;
    }
    if (st.mtimeMs !== seen.mtimeMs) {
      return `错误：${rel} 在读取后被外部修改过，请重新 repo_read_file 再编辑。`;
    }

    const text = await readFileText(abs);
    const isCrlf = text.includes("\r\n");
    const edits = (args.edits ?? []) as { oldString: string; newString: string }[];
    const replaceAll = !!args.replaceAll;

    // 原子性：先全量定位，任一失败整体不写
    const positions: { start: number; end: number; replacement: string }[] = [];
    for (let i = 0; i < edits.length; i++) {
      const { oldString, newString } = edits[i];
      if (isCrlf && !oldString.includes("\r") && oldString.includes("\n")) {
        return `错误：edits[${i}] 的 oldString 用 \n 换行，但文件是 CRLF 行尾——请以 \r\n 匹配（或先读取确认）。`;
      }
      const indices: number[] = [];
      let from = 0;
      for (;;) {
        const idx = text.indexOf(oldString, from);
        if (idx === -1) break;
        indices.push(idx);
        from = idx + oldString.length;
        if (!replaceAll && indices.length > 1) break;
      }
      if (indices.length === 0) {
        const line = nearestSimilarLine(text, oldString);
        return (
          `错误：edits[${i}] 的 oldString 在 ${rel} 中不存在（需精确匹配，含缩进与行尾）。` +
          (line ? `可能位置：第 ${line} 行附近，请核对后重试。` : "请确认内容后重试。")
        );
      }
      if (indices.length > 1 && !replaceAll) {
        const lineNos = indices.map((idx) => text.slice(0, idx).split("\n").length);
        return `错误：edits[${i}] 的 oldString 出现 ${indices.length} 次（行 ${lineNos.join(", ")}）。请加长上下文使其唯一，或传 replaceAll=true。`;
      }
      for (const idx of indices) {
        positions.push({ start: idx, end: idx + oldString.length, replacement: newString });
      }
    }
    positions.sort((a, b) => b.start - a.start);
    let result = text;
    for (const pos of positions) result = result.slice(0, pos.start) + pos.replacement + result.slice(pos.end);

    await fsp.writeFile(abs, result, "utf8");
    const st2 = await statSafe(abs);
    if (st2) env.readLog.set(rel, { mtimeMs: st2.mtimeMs, size: st2.size });
    const summary = afterWrite(env, rel, text, result);
    return `已编辑 ${rel}（${edits.length} 处修改，${summary}）`;
  },
});

// ================ git 写（授权卡 Session / EachTime） ================

registerAgentTool({
  name: "git_stage",
  description: "把文件加入暂存区（git add）——需要人类在授权卡批准",
  parametersSchema: z.object({ paths: z.array(z.string()).min(1) }),
  permissionClass: "session",
  source: "builtin",
  permissionRequest: (args) => {
    const paths = (Array.isArray(args.paths) ? args.paths : []) as string[];
    return {
      title: "暂存文件",
      detail: `${paths.length} 个文件`,
      command: `git add ${paths.slice(0, 3).join(" ")}${paths.length > 3 ? " …" : ""}`,
      payload: { kind: "git-stage", paths },
    };
  },
  async execute(env, args) {
    const paths = (args.paths ?? []) as string[];
    const abs = [] as string[];
    for (const p of paths) abs.push(await resolveSafe(env.worktreePath, p));
    await status.stageFiles(env.worktreePath, abs);
    return `已暂存 ${paths.length} 个文件`;
  },
});

registerAgentTool({
  name: "git_commit",
  description:
    "提交暂存区内容（trailer 自动附加；提交前过安全网扫描，block 级拦截）——需要人类批准",
  parametersSchema: z.object({ message: z.string().min(1) }),
  permissionClass: "session",
  source: "builtin",
  permissionRequest: (args) => {
    const message = String(args.message ?? "");
    return {
      title: "提交",
      detail: message.split(/\r?\n/)[0]?.slice(0, 80) ?? "",
      command: `git commit -m "${message.split(/\r?\n/)[0]?.slice(0, 60)}…"`,
      payload: { kind: "git-commit" },
    };
  },
  async execute(env, args) {
    const message = String(args.message ?? "").trim();
    const wt = env.worktreePath;
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
    const r = await tryGit(wt, ["commit", "-m", message, "-m", "Assisted-by: gitter-agent\nGitter-Session: " + env.taskId]);
    if (r.code !== 0) return err(new Error(r.stderr));
    const sha = (await tryGit(wt, ["rev-parse", "HEAD"])).stdout.trim();
    return `已提交 ${sha.slice(0, 10)}：${message.split(/\r?\n/)[0]}`;
  },
});

registerAgentTool({
  name: "git_push",
  description: "推送当前任务分支到远程——每次都需要人类批准（永不记忆）",
  parametersSchema: z.object({}),
  permissionClass: "each-time",
  source: "builtin",
  permissionRequest: () => ({
    title: "推送到远程",
    detail: "git push（当前任务分支）",
    command: "git push",
    payload: { kind: "git-push" },
    rememberable: false,
  }),
  async execute(env) {
    const r = await tryGit(env.worktreePath, ["push"]);
    return r.code === 0 ? "已推送" : err(new Error(r.stderr));
  },
});

// ================ 命令面（F4） ================

const HEAD_TAIL = 8000;
const RING_CAP = 64_000;

function headTail(out: string): string {
  if (out.length <= HEAD_TAIL * 2) return out;
  return out.slice(0, HEAD_TAIL) + `\n…（中间省略 ${out.length - HEAD_TAIL * 2} 字符）\n` + out.slice(-HEAD_TAIL);
}

registerAgentTool({
  name: "terminal_run",
  description:
    "在 worktree 内执行 shell 命令（跑测试/构建等）。默认前台（输出实时回传，超时默认 120s 上限 600s）；" +
    "background=true 转后台返回 shellId（terminal_poll 查询）——需要人类批准（危险命令每次确认）",
  parametersSchema: z.object({
    command: z.string().min(1),
    timeoutMs: z.number().int().min(5000).max(600_000).optional(),
    cwd: z.string().optional().describe("worktree 内相对目录"),
    background: z.boolean().optional(),
  }),
  permissionClass: "session",
  source: "builtin",
  dynamicRisk: (args) => safety.commandRisk(String(args.command ?? "")),
  permissionRequest: (args) => {
    const command = String(args.command ?? "");
    return {
      title: "执行命令",
      detail: command.slice(0, 120),
      command,
      payload: { kind: "command", risk: safety.commandRisk(command) },
    };
  },
  async execute(env, args) {
    const command = String(args.command ?? "");
    const timeoutMs = Math.max(5000, Math.min(Number(args.timeoutMs ?? 120_000), 600_000));
    const cwd = args.cwd ? await resolveSafe(env.worktreePath, String(args.cwd)) : env.worktreePath;

    const run = (id: string | null): Promise<string> =>
      new Promise((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(command, { cwd, shell: true, windowsHide: true });
        } catch (e) {
          resolve(err(e));
          return;
        }
        let out = "";
        let lastFlush = 0;
        const emitDelta = (delta: string) => {
          out += delta;
          if (out.length > RING_CAP) out = out.slice(out.length - RING_CAP);
          const now = Date.now();
          if (id && now - lastFlush > 120 && delta) {
            lastFlush = now;
            env.emit({ type: "output", text: delta, stream: "tool", subtaskId: env.subtaskId });
          }
        };
        const finish = (text: string, exitCode: number | null) => {
          clearTimeout(timer);
          if (id) {
            const rec = env.shells.get(id);
            if (rec) {
              rec.output = out;
              rec.running = false;
              rec.exitCode = exitCode;
            }
          }
          resolve(text);
        };
        const timer = setTimeout(() => {
          // Windows：杀整棵进程树
          if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
          finish(`超时（${Math.round(timeoutMs / 1000)}s，已终止进程树）。已有输出：\n${headTail(out)}`, null);
        }, timeoutMs);
        child.stdout?.on("data", (d: Buffer) => emitDelta(d.toString()));
        child.stderr?.on("data", (d: Buffer) => emitDelta(d.toString()));
        child.on("error", (e) => finish(err(e), null));
        child.on("close", (code) => finish(`退出码 ${code ?? -1}：\n${headTail(out)}`, code ?? -1));
      });

    if (args.background) {
      const id = `sh-${env.shells.size + 1}-${Date.now().toString(36)}`;
      env.shells.set(id, { id, command, output: "", running: true, exitCode: null, startedAt: Date.now() });
      void run(id);
      return `后台 shell 已启动：shellId=${id}\n命令：${command.slice(0, 200)}\n用 terminal_poll(shellId="${id}") 查询输出与退出码。`;
    }
    return run(null);
  },
});

registerAgentTool({
  name: "terminal_poll",
  description: "查询后台 shell 的输出与状态（可等待 N 秒）",
  parametersSchema: z.object({
    shellId: z.string().min(1),
    waitSec: z.number().int().min(0).max(60).optional(),
  }),
  permissionClass: "session",
  source: "builtin",
  permissionRequest: () => ({ title: "查询后台命令", detail: "", command: null, payload: { kind: "command" } }),
  async execute(env, args) {
    const id = String(args.shellId ?? "");
    const rec = env.shells.get(id);
    if (!rec) return `错误：shellId 不存在：${id}`;
    const waitMs = Math.min(Number(args.waitSec ?? 0), 60) * 1000;
    const start = Date.now();
    while (rec.running && Date.now() - start < waitMs) {
      await new Promise((r) => setTimeout(r, 300));
      if (env.signal.aborted) return "（会话中断）";
    }
    const stateText = rec.running ? "仍在运行" : `已退出（码 ${rec.exitCode ?? "-"}）`;
    return `shellId=${id} ${stateText}\n命令：${rec.command.slice(0, 200)}\n输出（尾部）：\n${headTail(rec.output) || "（无输出）"}`;
  },
});

// ================ 交互与规划（F5.4 / F8） ================

registerAgentTool({
  name: "ask_user",
  description: "向人类提问（选项题或开放题）。在关键分歧点使用，不要用于可以自查的信息",
  parametersSchema: z.object({
    question: z.string().min(1),
    options: z.array(z.string()).max(6).optional(),
  }),
  permissionClass: "auto",
  source: "builtin",
  planAlways: true,
  async execute(env, args) {
    const question = String(args.question ?? "");
    const options = (Array.isArray(args.options) ? args.options : []).map(String);
    const answer = await env.askUser(question, options);
    return `用户回答：${answer}`;
  },
});

registerAgentTool({
  name: "todo_write",
  description:
    "维护任务清单（整体替换，≤20 条；至多 1 条 in_progress）。多步任务开始前建清单，每完成一步更新状态",
  parametersSchema: z.object({
    todos: z.array(z.object({
      content: z.string().min(1),
      status: z.enum(["pending", "in_progress", "completed"]),
    })).max(20),
  }),
  permissionClass: "auto",
  source: "builtin",
  planAlways: true,
  async execute(env, args) {
    const todos = (args.todos ?? []) as { content: string; status: string }[];
    const inProgress = todos.filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      return `错误：in_progress 至多 1 条（当前 ${inProgress.length} 条）。请调整后重试。`;
    }
    env.setTodos(todos.map((t) => ({ content: String(t.content), status: t.status as "pending" | "in_progress" | "completed" })));
    return `清单已更新（${todos.length} 项${inProgress.length === 1 ? `，进行中：${inProgress[0].content}` : ""}）`;
  },
});

registerAgentTool({
  name: "plan_submit",
  description:
    "提交执行计划供人类批准（仅规划模式）。计划用 markdown：## 目标 / ## 步骤（编号，每步含涉及文件与验证方式）/ ## 风险与回滚 / ## 待确认问题",
  parametersSchema: z.object({ plan: z.string().min(1) }),
  permissionClass: "auto",
  source: "builtin",
  planAlways: true,
  async execute(env, args) {
    const plan = String(args.plan ?? "").trim();
    const r = await env.submitPlan(plan);
    if (r.status === "approved") {
      return "计划已获人类批准。请输出一句简短确认（如「计划已批准，开始执行」）结束本轮；宿主会自动开始执行轮，届时再建立 todo 清单。";
    }
    return `人类要求修改计划${r.feedback ? `：${r.feedback}` : ""}。请继续调研并重新 plan_submit。`;
  },
});

// ================ 子代理（F9） ================

registerAgentTool({
  name: "task",
  description:
    "派生子代理执行子任务（结果回传为文本）。子代理看不到本对话，prompt 必须自包含" +
    "（全部背景、文件路径、期望产出格式）。mode 可选：explore（只读调研）/ act（可执行，写操作仍过授权卡）",
  parametersSchema: z.object({
    name: z.string().min(1).describe("子任务名（时间线标题）"),
    prompt: z.string().min(1),
    mode: z.string().optional().describe("子代理预设 id，缺省 explore"),
  }),
  permissionClass: "auto",
  source: "builtin",
  planAlways: true,
  noSubtask: true,
  async execute(env, args) {
    let mode = String(args.mode ?? "explore");
    const presets = env.subtaskPresets();
    if (!presets.includes(mode)) {
      // §20.3.5 预设 id 命名空间化（<pkg>/<id>）：裸名按唯一后缀解析（模型无需知道包前缀）
      const matches = presets.filter((id) => id.endsWith(`/${mode}`) || id.endsWith(`.${mode}`));
      if (matches.length === 1) mode = matches[0];
      else if (matches.length > 1) return `错误：预设 ${mode} 有多个匹配：${matches.join(", ")}。请写全名。`;
      else return `错误：未知子代理预设 ${mode}。可用：${presets.join(", ")}`;
    }
    if (env.mode === "plan" && mode !== "explore") {
      mode = "explore";
      return "错误：规划模式只允许 explore 子代理（零副作用调研）。";
    }
    return await env.spawnSubtask({ name: String(args.name), prompt: String(args.prompt), mode });
  },
});

/** 内置工具数量断言（smoke 用）。 */
export const BUILTIN_TOOL_COUNT = 19;

/** 全部内置只读工具名（explore 子代理工具面）。 */
export const READONLY_TOOL_NAMES = [
  "repo_status", "repo_diff", "repo_log", "repo_read_file", "repo_list_files",
  "repo_glob", "repo_grep", "review_get_state",
];
