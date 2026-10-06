import { spawn, type ChildProcess } from "child_process";
import type { ToolDef, ToolContext } from "./tools";

/**
 * 包声明的外部 MCP server 连接器（extension-system-v2.md §16.6 B 阶段遗留项，D 阶段补齐）：
 * 手写 stdio 按行 JSON-RPC 客户端（协议与服务端 mcp.ts 同源：initialize → notifications/initialized
 * → tools/list → tools/call），不依赖 SDK（规避 ESM/ABI 边界）。
 * 信任门：settings.externalMcpEnabled（默认关）——外部进程工具全部 source=mcp。
 */

export interface McpServerConfig {
  id: string; // mcp.<pkg>.<id>
  name: string;
  command: string;
  args: string[];
  description: string | null;
}

interface Conn {
  proc: ChildProcess;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  nextId: number;
  buffer: string;
  tools: { name: string; description: string }[];
}

export class McpClientManager {
  private conns = new Map<string, Conn>();

  connected(): string[] {
    return [...this.conns.keys()];
  }

  /** 连接并拉取工具入注册表（工具名 = <serverId>.<toolName> 命名空间）。 */
  async connect(cfg: McpServerConfig, registry: import("./tools").ToolRegistry): Promise<{ toolCount: number; error: string | null }> {
    if (this.conns.has(cfg.id)) return { toolCount: this.conns.get(cfg.id)!.tools.length, error: null };
    let proc: ChildProcess;
    try {
      proc = spawn(cfg.command, cfg.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      return { toolCount: 0, error: (e as Error).message };
    }
    const conn: Conn = { proc, pending: new Map(), nextId: 1, buffer: "", tools: [] };
    this.conns.set(cfg.id, conn);

    proc.stdout!.on("data", (d: Buffer) => {
      conn.buffer += d.toString("utf8");
      let idx: number;
      while ((idx = conn.buffer.indexOf("\n")) >= 0) {
        const line = conn.buffer.slice(0, idx).trim();
        conn.buffer = conn.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && conn.pending.has(msg.id)) {
            const p = conn.pending.get(msg.id)!;
            conn.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error.message ?? "mcp error"));
            else p.resolve(msg.result);
          }
        } catch { /* 非 JSON 行忽略 */ }
      }
    });
    proc.stderr!.on("data", () => { /* 服务端日志忽略 */ });
    proc.on("exit", () => {
      for (const [, p] of conn.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("mcp server exited"));
      }
      conn.pending.clear();
      this.conns.delete(cfg.id);
    });

    try {
      await this.request(conn, cfg, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "gitter", version: "0.1.0" },
      }, 10_000);
      this.notify(conn, "notifications/initialized", {});
      const listed = (await this.request(conn, cfg, "tools/list", {}, 10_000)) as { tools?: { name: string; description?: string }[] };
      conn.tools = (listed.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? "" }));
      for (const t of conn.tools) {
        const def: ToolDef = {
          name: `${cfg.id}.${t.name}`,
          description: t.description || cfg.description || cfg.name,
          // 外部工具权限未知：一律 read（无门直行）——写类外部工具的权限清单随 F 阶段落地
          permission: "read",
          execute: async (args, _ctx: ToolContext) => {
            const r = (await this.request(conn, cfg, "tools/call", { name: t.name, arguments: args }, 60_000)) as {
              content?: { type: string; text?: string }[];
              isError?: boolean;
            };
            const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
            return text;
          },
        };
        registry.register(def, "mcp", cfg.id);
      }
      return { toolCount: conn.tools.length, error: null };
    } catch (e) {
      this.disconnect(cfg.id);
      return { toolCount: 0, error: (e as Error).message };
    }
  }

  disconnect(id: string): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.conns.delete(id);
    try {
      conn.proc.kill();
    } catch { /* ignore */ }
  }

  disconnectAll(): void {
    for (const id of [...this.conns.keys()]) this.disconnect(id);
  }

  private request(conn: Conn, cfg: McpServerConfig, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = conn.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`${cfg.id} ${method} 超时`));
      }, timeoutMs);
      conn.pending.set(id, { resolve, reject, timer });
      conn.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private notify(conn: Conn, method: string, params: unknown): void {
    conn.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
}
