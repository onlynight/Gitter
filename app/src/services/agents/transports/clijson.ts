import { spawn, type ChildProcess } from "child_process";
import { renderArgs } from "../catalog";
import type { HarnessLaunchSpec } from "../types";
import { mapFrame, type FrameMapResult } from "../events";
import type { AgentSessionEvent } from "../types";

/**
 * cli-json 传输适配器（agent-harness-codex.md v2.0 §三 transports/json.ts）：
 * 管道子进程 + 逐行 JSONL → 声明式事件映射。主形态，不占 PTY；
 * 环境变量白名单过滤 + GITUI_* 标记注入；Windows 树杀（taskkill /T）防孤儿。
 */

/** 默认凭据类环境变量剔除清单（settings 可扩展，宿主不经手 agent 认证）。 */
export const DEFAULT_ENV_DENYLIST = [
  "GH_TOKEN", "GITHUB_TOKEN", "GITLAB_TOKEN",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AZURE_OPENAI_API_KEY",
  "SLACK_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
];

export interface CliJsonLaunch {
  spec: HarnessLaunchSpec;
  worktreePath: string;
  taskId: string;
  prompt: string | null;
  /** {sandbox} 占位符的值（来自包 configuration，缺省 workspace-write） */
  sandbox: string | null;
  /** 非空 = 续跑（spec.resume.args + externalSessionId） */
  externalSessionId: string | null;
  envDenylist: string[];
}

export interface CliJsonHandlers {
  onFrameResult: (r: FrameMapResult) => void;
  onEvent: (ev: AgentSessionEvent) => void;
  /** 进程退出（终态合成：帧内无 completed 时按 exit code 补） */
  onExit: (code: number | null) => void;
}

export interface CliJsonProcess {
  pid: number | undefined;
  kill(): void;
}

export function buildLaunchEnv(denylist: string[], extra: Record<string, string>): NodeJS.ProcessEnv {
  const deny = new Set([...DEFAULT_ENV_DENYLIST, ...denylist]);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (deny.has(k)) continue;
    env[k] = v as string;
  }
  return { ...env, ...extra };
}

export function launchCliJson(l: CliJsonLaunch, h: CliJsonHandlers): CliJsonProcess {
  const resuming = !!l.externalSessionId && !!l.spec.resume;
  const tpl = resuming ? l.spec.resume! : l.spec.spawn;
  // resume 模板只带 args——命令与 spawn 相同
  const command = l.spec.spawn.command;
  const vars: Record<string, string> = {
    worktree: l.worktreePath,
    taskId: l.taskId,
    externalSessionId: l.externalSessionId ?? "",
    sandbox: l.sandbox ?? "workspace-write",
  };
  const args = renderArgs(tpl.args, vars);
  const env = buildLaunchEnv(l.envDenylist, {
    ...l.spec.spawn.env,
    GITUI_HARNESS: l.spec.fullId,
    GITUI_TASK: l.taskId,
  });

  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: l.worktreePath,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    h.onEvent({ type: "log", level: "error", text: `进程启动失败：${(e as Error).message}` });
    h.onEvent({ type: "completed", outcome: "failed", summary: "进程启动失败", exitCode: -1 });
    h.onExit(-1);
    return { pid: undefined, kill: () => {} };
  }

  // 任务描述/反馈经 stdin（避免命令行长度与转义问题）
  if (tpl.promptStdin && l.prompt !== null && child.stdin) {
    child.stdin.write(l.prompt);
    child.stdin.end();
  } else if (child.stdin) {
    child.stdin.end();
  }

  // 行缓冲解析 stdout
  let buf = "";
  let sawTerminalEvent = false;
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        h.onEvent({ type: "log", level: "debug", text: `非 JSON 行：${line.slice(0, 200)}` });
        continue;
      }
      if (!l.spec.eventMap) {
        h.onEvent({ type: "log", level: "debug", text: `（无事件映射）${line.slice(0, 200)}` });
        continue;
      }
      const r = mapFrame(l.spec.eventMap, frame);
      if (r.completed) sawTerminalEvent = true;
      h.onFrameResult(r);
      for (const ev of r.events) h.onEvent(ev);
    }
  });

  const stderrTail: string[] = [];
  child.stderr?.on("data", (d: Buffer) => {
    for (const line of d.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      stderrTail.push(line);
      if (stderrTail.length > 50) stderrTail.shift();
    }
  });

  child.on("error", (e) => {
    h.onEvent({ type: "log", level: "error", text: `进程错误：${e.message}` });
  });

  child.on("close", (code) => {
    if (buf.trim()) {
      // 尾行无换行也尝试解析（部分实现末帧不带换行）
      try {
        const frame = JSON.parse(buf);
        if (l.spec.eventMap) {
          const r = mapFrame(l.spec.eventMap, frame);
          if (r.completed) sawTerminalEvent = true;
          h.onFrameResult(r);
          for (const ev of r.events) h.onEvent(ev);
        }
      } catch {
        /* 尾行非 JSON：忽略 */
      }
      buf = "";
    }
    if (!sawTerminalEvent) {
      const outcome = code === 0 ? "completed" : "failed";
      const summary = code === 0 ? undefined : `退出码 ${code}${stderrTail.length ? ` · ${stderrTail[stderrTail.length - 1].slice(0, 160)}` : ""}`;
      h.onEvent({ type: "completed", outcome, summary, exitCode: code });
    }
    h.onExit(code);
  });

  return {
    pid: child.pid,
    kill() {
      if (child.pid === undefined || child.exitCode !== null) return;
      if (process.platform === "win32") {
        // 树杀：codex 可能带子进程（shell/工具调用）
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGKILL");
      }
    },
  };
}
