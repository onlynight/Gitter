import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TerminalSessionDTO } from "../shared/types";

/** 会话输出事件的最小窗口接口（main 传 webContents 适配）。 */
export interface IEventSink {
  send(channel: string, payload: unknown): void;
}

/** node-pty 由 @electron/rebuild 对齐 Electron ABI（构建后处理，见 package.json postbuild）。 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pty: typeof import("node-pty") = require("node-pty");

export interface Session {
  id: string;
  backend: string;
  shellKind: string;
  cwd: string | null;
  running: boolean;
  exitCode: number | null;
  pty: import("node-pty").IPty | null;
}

/**
 * 终端会话管理（替代 ConptySession/WinPtySession 双后端）：
 * node-pty 1.x 在 Windows 上直接走 ConPTY（winpty 仅作旧系统兜底，自动选择）。
 * 输出 → 渲染层走 base64 事件块（32KB 分块防单消息过大）。
 */
export class TerminalManager {
  private readonly sessions = new Map<string, Session>();
  private seq = 0;

  constructor(
    private readonly win: IEventSink,
    /** terminalProfiles 接缝（extension-system-v2.md §16.5）：ext.<pkg>.<id> 档位解析器，main 注入 */
    private readonly resolveProfile?: (shellKind: string) => { command: string; args: string[] } | null,
  ) {}

  list(): TerminalSessionDTO[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id, backend: s.backend, shellKind: s.shellKind, cwd: s.cwd,
      running: s.running, exitCode: s.exitCode,
    }));
  }

  /** 确保会话存在且匹配 cwd/shell；不匹配或已退出则重启（对齐 TerminalFollowRepo）。
   *  多标签：带 sessionId 时按 id 定位——存在且 running 直接返回（标签切换/恢复，
   *  不因 shellKind/cwd 变化重启）；不存在或已退出则以该 id 重建；
   *  无 sessionId 走旧单会话兼容路径（首个 running 复用/重启）。 */
  ensure(opts: { cols: number; rows: number; cwd?: string | null; shellKind?: string; sessionId?: string }): TerminalSessionDTO {
    const shellKind = opts.shellKind ?? "powershell";
    const cwd = opts.cwd ?? null;
    if (opts.sessionId) {
      const byId = this.sessions.get(opts.sessionId);
      if (byId) {
        if (!byId.running) {
          this.kill(byId);
          return this.dto(this.spawn(opts.sessionId, shellKind, cwd, opts.cols, opts.rows));
        }
        return this.dto(byId);
      }
      const created = this.spawn(opts.sessionId, shellKind, cwd, opts.cols, opts.rows);
      return this.dto(created);
    }
    const existing = [...this.sessions.values()].find((s) => s.running);
    if (existing && existing.shellKind === shellKind && samePath(existing.cwd, cwd)) {
      return this.dto(existing);
    }
    if (existing) this.kill(existing);
    const created = this.spawn(`term-${++this.seq}`, shellKind, cwd, opts.cols, opts.rows);
    return this.dto(created);
  }

  /** 关闭并移除会话（标签 ×）。 */
  close(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      this.kill(s);
      this.sessions.delete(s.id);
    }
  }

  private spawn(id: string, shellKind: string, cwd: string | null, cols = 120, rows = 30): Session {
    const session: Session = { id, backend: "conpty", shellKind, cwd, running: false, exitCode: null, pty: null };
    this.sessions.set(id, session);

    const [file, args] = this.shellFor(shellKind, cwd);
    const p = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: Math.max(20, Math.min(500, Math.floor(cols) || 120)),
      rows: Math.max(5, Math.min(200, Math.floor(rows) || 30)),
      cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
      env: process.env as Record<string, string>,
      useConpty: true,
    });
    session.pty = p;
    session.running = true;

    let pending: Buffer = Buffer.alloc(0);
    p.onData((data) => {
      const chunk = Buffer.concat([pending, Buffer.from(data, "utf8")]);
      // 按 32KB 切块发送，残余留到下一事件
      const CHUNK = 32 * 1024;
      let offset = 0;
      while (chunk.length - offset > CHUNK) {
        this.win.send("evt", { method: "terminal.data", params: { id, b64: chunk.subarray(offset, offset + CHUNK).toString("base64") } });
        offset += CHUNK;
      }
      pending = chunk.subarray(offset);
    });
    // 残余块定时冲刷（shell 安静时也要送达）
    const flushTimer = setInterval(() => {
      if (pending.length > 0) {
        this.win.send("evt", { method: "terminal.data", params: { id, b64: pending.toString("base64") } });
        pending = Buffer.alloc(0);
      }
    }, 16);

    p.onExit(({ exitCode }) => {
      clearInterval(flushTimer);
      if (pending.length > 0) {
        this.win.send("evt", { method: "terminal.data", params: { id, b64: pending.toString("base64") } });
        pending = Buffer.alloc(0);
      }
      session.running = false;
      session.exitCode = exitCode;
      this.win.send("evt", { method: "terminal.exit", params: { id, exitCode } });
    });
    return session;
  }

  write(id: string, dataB64: string) {
    const s = this.sessions.get(id);
    if (s?.pty && s.running) s.pty.write(Buffer.from(dataB64, "base64"));
  }

  resize(id: string, cols: number, rows: number) {
    try {
      this.sessions.get(id)?.pty?.resize(Math.floor(cols), Math.floor(rows));
    } catch {
      // 会话退出竞态：忽略
    }
  }

  private kill(s: Session) {
    try {
      s.pty?.kill();
    } catch {
      // ignore
    }
    this.sessions.delete(s.id);
  }

  disposeAll() {
    for (const s of [...this.sessions.values()]) this.kill(s);
  }

  private dto(s: Session): TerminalSessionDTO {
    return { id: s.id, backend: s.backend, shellKind: s.shellKind, cwd: s.cwd, running: s.running, exitCode: s.exitCode };
  }

  /** 档位解析：ext.* 走包 profiles（未知档位回退 PowerShell），其余走内置三档。 */
  private shellFor(kind: string, workDir: string | null): [string, string[]] {
    if (kind.startsWith("ext.")) {
      const p = this.resolveProfile?.(kind);
      if (p && p.command.trim()) return [p.command, [...p.args]];
    }
    return resolveShell(kind, workDir);
  }
}

function samePath(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/** shell 解析（对齐 TerminalPage.EnsureSessionStartedAsync 的三分支）。 */
function resolveShell(kind: string, workDir: string | null): [string, string[]] {
  if (kind === "cmd") return ["cmd.exe", []];
  if (kind === "bash") {
    const bashPath = locateBash();
    return [bashPath, ["-i", "-l"]];
  }
  return ["powershell.exe", ["-NoLogo"]];
}

/** Git Bash 定位（BashLocator 移植：设置路径 → 常见安装位 → where bash）。 */
export function locateBash(configured?: string | null): string {
  const candidates = [
    configured ?? "",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return "bash.exe"; // PATH 兜底
}
