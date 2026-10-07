import type { LoopOptions, LoopResult } from "./loop";

/**
 * 插件循环适配（agent-harness-v4.md §14.3）：
 * ctx.registerLoop 注册的实现（AgentRunRequest 契约，extensions/agentLoop.ts）经本适配器
 * 接入统一 runLoop。工具执行走宿主授权门透传；需要完整 agent 工具面的循环应改用
 * registerHarnessLoop（LoopOptions 契约）注册。
 */

export function registeredLoopIds(): string[] {
  // 延迟 require 避免 main 启动顺序耦合（extensions/agentLoop 无重依赖，安全）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../extensions/agentLoop") as typeof import("../extensions/agentLoop");
  return mod.registeredLoops();
}

export async function runAdaptedLoop(id: string, o: LoopOptions): Promise<LoopResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../extensions/agentLoop") as typeof import("../extensions/agentLoop");
  const lastUser = [...o.messages].reverse().find((m) => m.role === "user");
  const textOf = (c: unknown): string => {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text?: string }).text ?? "") : "")).join("");
    }
    return "";
  };
  // §20.3.4 P0 修复：授权经宿主真门（requestPermission 挂起等待回执），拒绝返回 false——
  // 旧实现发 permission 事件后立即 resolve，授权卡是摆设。无服务代理面（理论上不可达）→ 安全缺省拒绝。
  let callSeq = 0;
  const requestApproval = async (description: string): Promise<boolean> => {
    if (!o.services) return false;
    callSeq++;
    return o.services.requestPermission(`loop.${id}`, {
      title: "插件循环授权请求",
      detail: description.slice(0, 200),
      command: description.slice(0, 120),
      payload: { kind: "plugin", source: id },
      rememberable: false,
    });
  };
  const req = {
    workDir: o.worktreePath ?? process.cwd(),
    system: o.system,
    user: textOf(lastUser?.content) || "继续",
    skills: [],
    toolNames: [],
    maxSteps: o.maxSteps ?? 20,
    requestApproval,
    onDelta: (delta: string) => o.onEvent({ type: "output", text: delta, stream: "assistant" }),
    onStep: (step: { kind: string; text?: string; tool?: string; args?: unknown; result?: string }) => {
      if (step.kind === "tool" && step.tool) {
        const callId = `adapt-${id}-${callSeq}-${Date.now().toString(36)}`;
        o.onEvent({ type: "tool", phase: "start", callId, name: step.tool, args: step.args });
        o.onEvent({ type: "tool", phase: "end", callId, name: step.tool, args: step.args, result: step.result?.slice(0, 4000) });
      }
    },
  };
  const r = await mod.runRegisteredLoop(id, req as never, {
    endpoint: "",
    model: "",
    apiKey: null,
  } as never);
  return { outcome: "completed", lastMessage: r.text, usage: null };
}
