import * as crypto from "crypto";
import * as net from "net";
import * as path from "path";
import type { IEventSink } from "./terminal";
import type { ToolRegistry } from "./extensions/tools";

// MCP 管道宿主（C# McpPipeHost + GitterMcpServer 移植，ai-native-redesign.md §7.2）：
// Windows 命名管道 \\.\pipe\gitter-mcp-<hash8>，stdio 按行 JSON-RPC（MCP 规范）。
// 工具面：repo.status/log/diff/branches/worktrees + review.submit_feedback；
// 写工具 repo.stage/repo.commit 走人审门（渲染层弹卡，超时 60s 视为拒绝）。

export interface McpOptions {
  /** 显式信任写操作（默认 false → 每次人审） */
  allowWrites: boolean;
  /** 单行请求处理前的日志钩子（调试用） */
  verbose?: boolean;
  /** 统一工具总线（extension-system-v2.md §16.2 机制 2：内置/MCP/L2 同一注册表，自举） */
  tools: ToolRegistry;
}

const LOG_LIMIT = 20;
const APPROVAL_TIMEOUT_MS = 60_000;

export class McpPipeHost {
  private server: net.Server | null = null;
  private pipeName: string;
  private buffers = new Map<number, string>();
  private nextConnId = 1;

  constructor(
    public readonly currentDir: string,
    private sink: IEventSink,
    private options: McpOptions,
  ) {
    const hash = crypto.createHash("sha256").update(path.resolve(currentDir).toLowerCase()).digest("hex").slice(0, 8);
    this.pipeName = `\\\\.\\pipe\\gitter-mcp-${hash}`;
  }

  get name(): string {
    return this.pipeName;
  }

  start(): void {
    if (this.server) return;
    this.server = net.createServer((socket) => {
      const connId = this.nextConnId++;
      this.buffers.set(connId, "");
      socket.on("data", (d: Buffer) => {
        let buf = this.buffers.get(connId)! + d.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          void this.handleLine(line)
            .then((resp) => {
              if (resp !== null) socket.write(resp + "\n");
            })
            .catch(() => {
              socket.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "internal error" } }) + "\n");
            });
        }
        this.buffers.set(connId, buf);
      });
      socket.on("error", () => this.buffers.delete(connId));
      socket.on("close", () => this.buffers.delete(connId));
    });
    this.server.on("error", () => {
      // 管道被占（重复启动等）：静默，state 查询可见
      this.server = null;
    });
    try {
      this.server.listen(this.pipeName);
    } catch {
      this.server = null;
    }
  }

  stop(): void {
    try {
      this.server?.close();
    } catch {
      // ignore
    }
    this.server = null;
    this.buffers.clear();
  }

  get running(): boolean {
    return this.server !== null;
  }

  /** 写操作人审门：渲染层弹卡（mcp.approval 事件 → mcp.approve 调用），超时=拒绝。 */
  async requestApproval(description: string): Promise<boolean> {
    if (this.options.allowWrites) return true;
    return requestHumanApproval(this.sink, path.basename(this.currentDir), description, APPROVAL_TIMEOUT_MS);
  }

  // ---- JSON-RPC / MCP 协议层（对齐 GitterMcpServer.HandleAsync）----

  private async handleLine(line: string): Promise<string | null> {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return jsonRpcError(null, -32700, "Parse error");
    }
    if (!msg || msg.jsonrpc !== "2.0") return jsonRpcError(msg?.id ?? null, -32600, "Invalid Request");
    if (!("method" in msg)) return null;
    if (msg.id === undefined || msg.id === null) return null; // 通知（notifications/initialized）

    switch (msg.method) {
      case "initialize":
        return jsonRpcResult(msg.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "gitter", version: "0.1.0" },
        });
      case "tools/list":
        return jsonRpcResult(msg.id, {
          tools: this.options.tools.list().map((t) => ({ name: t.name, description: t.description })),
        });
      case "tools/call":
        return await this.toolCall(msg.id, msg.params);
      case "ping":
        return jsonRpcResult(msg.id, {});
      default:
        return jsonRpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  private async toolCall(id: unknown, params: any): Promise<string> {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const text = await this.runTool(String(name), args).catch((e) => {
      // 工具执行失败以 MCP 约定的 isError 内容返回（不是协议错误）
      return "__toolerror__" + (e as Error).message.slice(0, 300);
    });
    if (text === null) return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
    if (text.startsWith("__toolerror__")) {
      return jsonRpcResult(id, { content: [{ type: "text", text: text.slice("__toolerror__".length) }], isError: true });
    }
    return jsonRpcResult(id, { content: [{ type: "text", text }] });
  }

  private async runTool(name: string, args: any): Promise<string | null> {
    return this.options.tools.call(String(name), args ?? {}, {
      workDir: this.currentDir,
      requestApproval: (d) => this.requestApproval(d),
    });
  }
}

/** 人审门公共实现（管道宿主与 AgentLoop 人审路由共用）。 */
export function requestHumanApproval(sink: { send(channel: string, payload: unknown): void }, repoName: string, description: string, timeoutMs = 60_000): Promise<boolean> {
  const id = `appr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      resolve(false);
    }, timeoutMs);
    pendingApprovals.set(id, {
      resolve: (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      },
      description,
    });
    sink.send("evt", { method: "mcp.approval", params: { id, description, repo: repoName } });
  });
}

// 全局 pending 人审表（key = 审批 id；mcp.approve 桥方法消费）
export const pendingApprovals = new Map<string, { resolve: (ok: boolean) => void; description: string }>();




function jsonRpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}
