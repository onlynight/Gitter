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

let resolvedGit: Promise<string> | null = null;

/**
 * 定位 git.exe：候选逐个实测（spawn --version），首个可用者胜出并缓存。
 * PATH 里的 "git.exe" 失败时退回 Git for Windows 常见安装位；全失败抛错。
 */
export function locateGit(): Promise<string> {
  resolvedGit ??= (async () => {
    const candidates = [
      "git.exe",
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "cmd", "git.exe"),
    ];
    for (const c of candidates) {
      if (c.includes("\\") && !fs.existsSync(c)) continue;
      const ok = await new Promise<boolean>((res) => {
        try {
          const r = spawn(c, ["--version"], { windowsHide: true });
          r.on("error", () => res(false));
          r.on("close", (code) => res(code === 0));
        } catch {
          res(false);
        }
      });
      if (ok) return c;
    }
    throw new Error("未找到 git（PATH 与常见安装位均不可用）——请安装 Git for Windows");
  })();
  return resolvedGit;
}

const BASE_ARGS = [
  "-c", "core.quotepath=false",
  "-c", "i18n.logOutputEncoding=UTF-8",
  "-c", "i18n.commitEncoding=UTF-8",
  "-c", "console.platform=off",
];

/** 同 tryGit，但 stderr 按 \r/\n 流式分行回调（git 的进度条用 \r 原地重写）。 */
export async function tryGitStream(
  workDir: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<GitResult> {
  const exe = await locateGit();
  return new Promise((resolve) => {
    const child = spawn(exe, [...BASE_ARGS, ...args], {
      cwd: workDir || undefined,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCMInteractive: "never" },
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let errBuf = "";
    const drainErr = () => {
      // 进度行以 \r 分隔原地重写；按 \r\n、\r、\n 全部切开
      errBuf += errChunks.map((b) => b.toString("utf8")).join("");
      errChunks.length = 0;
      const parts = errBuf.split(/\r\n|\r|\n/);
      errBuf = parts.pop() ?? "";
      for (const line of parts) {
        const t = line.trim();
        if (t) onLine(t);
      }
    };
    child.stdout.on("data", (d: Buffer) => outChunks.push(d));
    child.stderr.on("data", (d: Buffer) => {
      errChunks.push(d);
      drainErr();
    });
    child.on("error", (err) => resolve({ code: -1, stdout: "", stderr: String(err) }));
    child.on("close", (code) => {
      drainErr();
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: errBuf,
      });
    });
    child.stdin.end();
  });
}

/** 运行 git（数组参数，不经 shell，无注入面）。失败抛 GitError。 */
export async function git(workDir: string, args: string[], input?: string): Promise<string> {
  const r = await tryGit(workDir, args, input);
  if (r.code !== 0) throw new GitError(args, r);
  return r.stdout;
}

export async function tryGit(workDir: string, args: string[], input?: string): Promise<GitResult> {
  const exe = await locateGit();
  // ENOENT 重试：杀软对进程镜像的瞬时锁会让 Windows spawn 间歇性失败（实测本机复现）。
  // 锁窗口可能超过 100ms，用 5 次指数退避（0/100/250/500/1000ms）。
  let lastError: Error | null = null;
  const backoff = [0, 100, 250, 500, 1000];
  for (let attempt = 0; attempt < backoff.length; attempt++) {
    if (backoff[attempt] > 0) await new Promise((r) => setTimeout(r, backoff[attempt]));
    const r = await spawnOnce(exe, workDir, args, input);
    if (r.stderr !== "SPAWN_ENOENT") return r;
    lastError = new Error(`spawn ${exe} ENOENT`);
  }
  return { code: -1, stdout: "", stderr: lastError?.message ?? "spawn failed" };
}

function spawnOnce(exe: string, workDir: string, args: string[], input?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    let child: import("child_process").ChildProcessWithoutNullStreams;
    try {
      child = spawn(exe, [...BASE_ARGS, ...args], {
        cwd: workDir || undefined,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCMInteractive: "never" },
      });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: "SPAWN_ENOENT" });
      return;
    }
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => outChunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", (err) => {
      const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      resolve({ code: -1, stdout: "", stderr: enoent ? "SPAWN_ENOENT" : String(err) });
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
      });
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
