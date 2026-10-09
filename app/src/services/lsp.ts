/**
 * LSP 语言服务器进程管理（inline-editor-plan.md §4.5，P3）：
 * 按语言键（typescript / python）管理 stdio JSON-RPC 语言服务器子进程。
 * 渲染层经 bridge 的 lsp.* RPC 消费；server→client 通知（publishDiagnostics 等）
 * 经 "evt" 通道以 lsp.event 扇出（bridge 注入 onEvent 回调）。
 *
 * 帧协议就地实现（Content-Length: N\r\n\r\n + UTF-8 body），零新增依赖；
 * FrameParser/buildMessage 为纯函数导出，smoke.ts 直测（含多字节/分块切割）。
 *
 * 命令以整行经 shell 解析（typescript-language-server 等在 Windows 是 npm .cmd shim，
 * 无 shell 直接 spawn 会 EINVAL）；停止用 taskkill /T（win32）连 shell 带子进程一起收。
 */
import { spawn, type ChildProcess } from "child_process";

export type LspStatus = "starting" | "running" | "error" | "stopped";

export interface LspServerInfo {
  /** 服务器键（typescript | python），一个键一个进程 */
  language: string;
  command: string;
  status: LspStatus;
  error?: string;
  pid?: number;
}

/** 未在设置里覆盖命令时的缺省命令行（inline-editor-plan.md §4.5）。 */
export const DEFAULT_LSP_COMMANDS: Record<string, string> = {
  typescript: "typescript-language-server --stdio",
  python: "pyright-langserver --stdio",
};

// ---- JSON-RPC 帧 ----

/** LSP 消息（请求/响应/通知同形，按需取字段）。 */
export interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** 编码一条消息为完整帧（Content-Length 按 UTF-8 字节数——多字节正文不能按字符数）。 */
export function buildMessage(msg: LspMessage): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/**
 * 流式帧解析器：push 任意切割的 stdout 字节块，吐出完整消息。
 * 头部 ASCII 解析、正文按字节长度截取——中文字符串跨块/跨帧不断裂。
 */
export class FrameParser {
  // chunk 来自 stream（Buffer<ArrayBufferLike>），显式放宽泛型避免赋值不兼容
  private buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  /** 解析已缓冲字节，返回 (解析出的消息, 剩余字节)。 */
  drain(): { messages: LspMessage[]; rest: Buffer } {
    const messages: LspMessage[] = [];
    for (;;) {
      const headEnd = this.buf.indexOf("\r\n\r\n");
      if (headEnd < 0) break;
      const header = this.buf.slice(0, headEnd).toString("ascii");
      const m = /Content-Length: (\d+)/i.exec(header);
      if (!m) {
        // 协议外杂质（个别服务器往 stdout 打日志）：丢弃这一行，不致死
        const lineEnd = this.buf.indexOf("\n");
        if (lineEnd < 0) break;
        this.buf = this.buf.slice(lineEnd + 1);
        continue;
      }
      const len = Number(m[1]);
      const bodyStart = headEnd + 4;
      if (this.buf.length < bodyStart + len) break; // 正文未到齐，等下一个 chunk
      try {
        messages.push(JSON.parse(this.buf.slice(bodyStart, bodyStart + len).toString("utf8")) as LspMessage);
      } catch {
        // 坏帧：丢弃，继续收
      }
      this.buf = this.buf.slice(bodyStart + len);
    }
    return { messages, rest: this.buf };
  }

  /** 追加字节块。 */
  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  get buffered(): number {
    return this.buf.length;
  }
}

interface LspProcess {
  child: ChildProcess;
  command: string;
  status: LspStatus;
  error?: string;
  parser: FrameParser;
  stderrTail: string;
  nextId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const INITIALIZE_TIMEOUT_MS = 10_000;

export class LspManager {
  private procs = new Map<string, LspProcess>();

  constructor(
    /** server→client 通知与状态变化扇出（bridge → webContents "evt"）。 */
    private readonly onEvent: (language: string, method: string, params: unknown) => void,
  ) {}

  /** 全部服务器快照（lsp.status RPC）。 */
  status(): LspServerInfo[] {
    return [...this.procs.entries()].map(([language, p]) => ({
      language, command: p.command, status: p.status, error: p.error, pid: p.child.pid,
    }));
  }

  /**
   * 启动（幂等：已在跑直接返回）。握手 initialize → initialized，完成后 status=running。
   * 命令行整行经 shell 解析；rootPath 作为 workspace 根（initialize.rootUri）。
   */
  async start(language: string, command: string, rootPath: string): Promise<LspServerInfo> {
    const existing = this.procs.get(language);
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      return this.snapshot(language, existing);
    }
    if (existing) this.kill(language, existing); // 上一个 error/stopped 进程：清掉再起

    let child: ChildProcess;
    try {
      child = spawn(command, { shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      const info: LspServerInfo = { language, command, status: "error", error: (e as Error).message };
      this.onEvent(language, "lsp/status", info);
      return info;
    }

    const proc: LspProcess = {
      child, command, status: "starting", parser: new FrameParser(), stderrTail: "",
      nextId: 1, pending: new Map(),
    };
    this.procs.set(language, proc);

    child.stdout!.on("data", (chunk: Buffer) => {
      proc.parser.push(chunk);
      const { messages } = proc.parser.drain();
      for (const msg of messages) this.dispatch(language, proc, msg);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      // 只留尾部用于报错展示（个别服务器把日志写 stderr，属正常）
      proc.stderrTail = (proc.stderrTail + chunk.toString("utf8")).slice(-2000);
    });
    const onDeath = () => {
      if (proc.status === "stopped") return;
      proc.status = "error";
      proc.error = proc.stderrTail.trim().split("\n").pop() || "服务器进程退出";
      for (const [, p] of proc.pending) { clearTimeout(p.timer); p.reject(new Error(`LSP 进程退出: ${proc.error}`)); }
      proc.pending.clear();
      this.onEvent(language, "lsp/status", this.snapshot(language, proc));
    };
    child.on("exit", onDeath);
    child.on("error", onDeath);

    // 握手：initialize 请求 → initialized 通知
    const rootUri = `file:///${rootPath.replace(/\\/g, "/").replace(/^\/+/, "")}`;
    try {
      await this.requestRaw(language, proc, "initialize", {
        processId: child.pid ?? null,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: rootPath.split(/[\\/]/).pop() || rootPath }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: false, willSave: false },
            completion: { completionItem: { snippetSupport: true, labelDetailsSupport: true } },
            hover: { contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: { relatedInformation: false },
          },
          workspace: { configuration: false, workspaceFolders: false },
        },
      }, INITIALIZE_TIMEOUT_MS);
      this.notify(language, "initialized", {});
      proc.status = "running";
      this.onEvent(language, "lsp/status", this.snapshot(language, proc));
    } catch (e) {
      proc.status = "error";
      proc.error = (e as Error).message;
      this.kill(language, proc);
      this.onEvent(language, "lsp/status", { language, command, status: "error", error: proc.error });
    }
    return this.snapshot(language, proc);
  }

  /** 停止（幂等）：shutdown 请求（尽力）→ exit 通知 → 杀进程树。 */
  stop(language: string): void {
    const proc = this.procs.get(language);
    if (!proc) return;
    try {
      this.notifyRaw(language, proc, "shutdown", null);
      this.notifyRaw(language, proc, "exit", null);
    } catch { /* 管道可能已断 */ }
    this.kill(language, proc);
    this.onEvent(language, "lsp/status", { language, command: proc.command, status: "stopped" });
  }

  stopAll(): void {
    for (const language of [...this.procs.keys()]) this.stop(language);
  }

  /** 客户端→服务器请求（lsp.request RPC）。超时/错误响应 reject。 */
  async request(language: string, method: string, params?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const proc = this.procs.get(language);
    if (!proc || proc.status !== "running") throw new Error(`LSP 未运行: ${language}`);
    return this.requestRaw(language, proc, method, params, timeoutMs);
  }

  /** 客户端→服务器通知（lsp.notify RPC；未运行静默丢弃）。 */
  notify(language: string, method: string, params?: unknown): void {
    const proc = this.procs.get(language);
    if (!proc) return;
    this.notifyRaw(language, proc, method, params);
  }

  // ---- 内部 ----

  private dispatch(language: string, proc: LspProcess, msg: LspMessage): void {
    if (msg.id !== undefined && (msg.method !== undefined || msg.result !== undefined || msg.error !== undefined)) {
      const pending = proc.pending.get(msg.id);
      if (!pending) return;
      proc.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(`LSP ${msg.method ?? "request"}: ${msg.error.message}`));
      else pending.resolve(msg.result);
      return;
    }
    if (msg.method) this.onEvent(language, msg.method, msg.params); // server→client 通知
  }

  private requestRaw(language: string, proc: LspProcess, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = proc.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.pending.delete(id);
        reject(new Error(`LSP 请求超时: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);
      proc.pending.set(id, { resolve, reject, timer });
      try {
        proc.child.stdin!.write(buildMessage({ jsonrpc: "2.0", id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        proc.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  private notifyRaw(_language: string, proc: LspProcess, method: string, params: unknown): void {
    proc.child.stdin?.write(buildMessage({ jsonrpc: "2.0", method, params }));
  }

  private kill(language: string, proc: LspProcess): void {
    proc.status = proc.status === "running" ? "stopped" : proc.status;
    for (const [, p] of proc.pending) { clearTimeout(p.timer); p.reject(new Error("LSP 已停止")); }
    proc.pending.clear();
    const pid = proc.child.pid;
    if (pid && !proc.child.killed) {
      // shell 包装下直接 kill 只杀 shell——Windows 用 taskkill 收整棵进程树
      if (process.platform === "win32") {
        try { spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { /* 尽力 */ }
      } else {
        try { proc.child.kill("SIGTERM"); } catch { /* 尽力 */ }
      }
    }
    this.procs.set(language, proc);
  }

  private snapshot(language: string, proc: LspProcess): LspServerInfo {
    return { language, command: proc.command, status: proc.status, error: proc.error, pid: proc.child.pid };
  }
}
