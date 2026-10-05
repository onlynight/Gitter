import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly result: GitResult,
  ) {
    super(result.stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? `git ${args[0]} failed (code ${result.code})`);
    this.name = "GitError";
  }
}

let resolvedGitPath: string | null | undefined;

/** 定位 git.exe：PATH 优先，退回 Git for Windows 常见安装位。找不到返回 null。 */
export function locateGit(): string | null {
  if (resolvedGitPath !== undefined) return resolvedGitPath;
  const candidates = [
    "git.exe",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "cmd", "git.exe"),
  ];
  for (const c of candidates) {
    // 相对名 = 依赖 PATH（spawn 期才能真正验证）；绝对路径先做存在性检查
    if (!c.includes("\\") || fs.existsSync(c)) {
      resolvedGitPath = c;
      return c;
    }
  }
  resolvedGitPath = null;
  return null;
}

const BASE_ARGS = [
  "-c", "core.quotepath=false",
  "-c", "i18n.logOutputEncoding=UTF-8",
  "-c", "i18n.commitEncoding=UTF-8",
  "-c", "console.platform=off",
];

/** 运行 git（数组参数，不经 shell，无注入面）。失败抛 GitError。 */
export async function git(workDir: string, args: string[], input?: string): Promise<string> {
  const r = await tryGit(workDir, args, input);
  if (r.code !== 0) throw new GitError(args, r);
  return r.stdout;
}

export async function tryGit(workDir: string, args: string[], input?: string): Promise<GitResult> {
  const exe = locateGit() ?? "git.exe";
  return new Promise((resolve) => {
    const child = spawn(exe, [...BASE_ARGS, ...args], {
      cwd: workDir || undefined,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCMInteractive: "never" },
    });
    let stdout = "";
    let stderr = "";
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => outChunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", (err) => {
      resolve({ code: -1, stdout: "", stderr: String(err) });
    });
    child.on("close", (code) => {
      stdout = Buffer.concat(outChunks).toString("utf8");
      stderr = Buffer.concat(errChunks).toString("utf8");
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin.write(input, "utf8");
    }
    child.stdin.end();
  });
}

/** 工作目录是否是 git 仓库（.git 存在，含 worktree 链接文件）。 */
export function looksLikeRepo(dir: string): boolean {
  try {
    const dot = path.join(dir, ".git");
    if (fs.statSync(dot).isDirectory()) return true;
    // worktree：.git 是指向 gitdir 的文件
    if (fs.statSync(dot).isFile()) return /gitdir:/i.test(fs.readFileSync(dot, "utf8"));
    return false;
  } catch {
    return false;
  }
}
