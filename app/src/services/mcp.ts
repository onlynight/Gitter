import * as crypto from "crypto";
import * as net from "net";
import * as path from "path";
import { tryGit } from "./gitexec";
import { getStatus, stageFiles, commit } from "./gitstatus";
import { queryLog } from "./gitlog";
import { getBranches } from "./gitbranches";
import { listWorktrees } from "./worktrees";
import { readTrailers } from "./sessions";
import { writeFeedback } from "./feedback";
import type { IEventSink } from "./terminal";

// MCP 管道宿主（C# McpPipeHost + GitterMcpServer 移植，ai-native-redesign.md §7.2）：
// Windows 命名管道 \\.\pipe\gitter-mcp-<hash8>，stdio 按行 JSON-RPC（MCP 规范）。
// 工具面：repo.status/log/diff/branches/worktrees + review.submit_feedback；
// 写工具 repo.stage/repo.commit 走人审门（渲染层弹卡，超时 60s 视为拒绝）。

export interface McpOptions {
  /** 显式信任写操作（默认 false → 每次人审） */
  allowWrites: boolean;
  /** 单行请求处理前的日志钩子（调试用） */
  verbose?: boolean;
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
    private options: McpOptions = { allowWrites: false },
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
    const id = `appr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingApprovals.delete(id);
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);
      pendingApprovals.set(id, {
        resolve: (ok: boolean) => {
          clearTimeout(timer);
          resolve(ok);
        },
        description,
      });
      this.sink.send("evt", { method: "mcp.approval", params: { id, description, repo: path.basename(this.currentDir) } });
    });
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
        return jsonRpcResult(msg.id, { tools: toolList() });
      case "tools/call":
        return jsonRpcResult(msg.id, await this.toolCall(msg.params));
      case "ping":
        return jsonRpcResult(msg.id, {});
      default:
        return jsonRpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  private async toolCall(params: any): Promise<unknown> {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const text = await this.runTool(String(name), args).catch((e) => {
      // 工具执行失败以 MCP 约定的 isError 内容返回（不是协议错误）
      return "__toolerror__" + (e as Error).message.slice(0, 300);
    });
    if (text === null) return jsonRpcError(null, -32602, `Unknown tool: ${name}`);
    if (text.startsWith("__toolerror__")) {
      return { content: [{ type: "text", text: text.slice("__toolerror__".length) }], isError: true };
    }
    return { content: [{ type: "text", text }] };
  }

  private async runTool(name: string, args: any): Promise<string | null> {
    const wd = this.currentDir;
    switch (name) {
      case "repo.status": {
        const s = await getStatus(wd);
        const lines = [...s.staged, ...s.changes, ...s.unversioned, ...s.conflicts].map(
          (f) => `${f.category}: ${f.path} (+${f.added ?? 0}/-${f.deleted ?? 0})`,
        );
        return lines.length === 0 ? "clean" : lines.join("\n");
      }
      case "repo.log": {
        const limit = clamp(intArg(args, "limit") ?? LOG_LIMIT, 1, 200);
        const { commits, hasMore } = await queryLog(wd, { limit });
        const lines = commits.map((c) => {
          const meta = readTrailers(c.body);
          const agent = c.assistedBy[0] ?? meta.assistedBy;
          return `${c.shortSha} ${new Date(c.committerDate * 1000).toISOString().slice(0, 16).replace("T", " ")} ${c.author}: ${c.subject}${agent ? ` [ai:${agent}]` : ""}`;
        });
        return lines.join("\n") + `\n(${commits.length}${hasMore ? "+" : ""})`;
      }
      case "repo.diff": {
        const p = strArg(args, "path");
        if (p) {
          const r = await tryGit(wd, ["diff", "--cached", "--no-color", "--", p]);
          return r.stdout || `(no staged diff for ${p})`;
        }
        const s = await getStatus(wd);
        const chunks: string[] = [];
        for (const f of s.staged.slice(0, 50)) {
          const r = await tryGit(wd, ["diff", "--cached", "--no-color", "--", f.path]);
          if (r.stdout) chunks.push(r.stdout);
        }
        return chunks.length === 0 ? "(nothing staged)" : chunks.join("\n");
      }
      case "repo.branches": {
        const b = await getBranches(wd);
        return [
          ...b.local.map((x) => `local  ${x.isHead ? "*" : " "} ${x.name}`),
          ...b.remote.map((x) => `remote   ${x.name}`),
        ].join("\n");
      }
      case "repo.worktrees": {
        const wts = await listWorktrees(wd);
        return wts.map((w) => `${w.isMain ? "main " : "task "} ${w.branch.padEnd(20)} ${w.path}`).join("\n");
      }
      case "repo.stage": {
        const paths = strArrayArg(args, "paths");
        if (!paths || paths.length === 0) return "paths[] required";
        if (!(await this.requestApproval(`git add ${paths.length} 个文件（${paths.slice(0, 3).join(", ")}${paths.length > 3 ? " …" : ""}）`))) {
          return DENIED;
        }
        await stageFiles(wd, paths);
        return `staged ${paths.length} file(s)`;
      }
      case "repo.commit": {
        const message = strArg(args, "message");
        if (!message?.trim()) return "message required";
        if (!(await this.requestApproval(`git commit：${message.trim().split("\n")[0].slice(0, 80)}`))) {
          return DENIED;
        }
        const r = await commit(wd, message, false);
        return `committed ${r.sha ? r.sha.slice(0, 7) : "(none)"}`;
      }
      case "review.submit_feedback": {
        const note = strArg(args, "note");
        if (!note?.trim()) return "note required";
        writeFeedback(wd, note, strArg(args, "path") ?? null);
        return "feedback recorded; the person will see it in Gitter's Changes page.";
      }
      default:
        return null;
    }
  }
}

// 全局 pending 人审表（key = 审批 id；mcp.approve 桥方法消费）
export const pendingApprovals = new Map<string, { resolve: (ok: boolean) => void; description: string }>();

const DENIED =
  "write tools are disabled; start Gitter's MCP server with write permission or perform git writes yourself.";

function toolList() {
  return [
    { name: "repo.status", description: "Working tree status: changed/staged/untracked/conflict files." },
    { name: "repo.log", description: "Recent commits (sha, subject, author, date, ai agent). Optional: limit." },
    { name: "repo.diff", description: "Patch of staged changes vs HEAD (or one file). Optional: path." },
    { name: "repo.branches", description: "Local and remote branches." },
    { name: "repo.worktrees", description: "All worktrees of this repository." },
    { name: "repo.stage", description: "Stage files (git add). Requires human approval." },
    { name: "repo.commit", description: "Commit staged changes with a message. Requires human approval." },
    { name: "review.submit_feedback", description: "Submit human review feedback about a hunk/file. Params: note (required), path (optional)." },
  ];
}

function strArg(args: any, name: string): string | null {
  return typeof args?.[name] === "string" ? args[name] : null;
}
function intArg(args: any, name: string): number | null {
  return typeof args?.[name] === "number" ? args[name] : null;
}
function strArrayArg(args: any, name: string): string[] | null {
  if (!Array.isArray(args?.[name])) return null;
  return args[name].filter((x: unknown) => typeof x === "string");
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function jsonRpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}
