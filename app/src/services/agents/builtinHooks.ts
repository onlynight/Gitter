import { registerTurnHook } from "./seams";

/**
 * 内置 turn 钩子（§20.3.6/§20.5：与插件钩子同一接缝自举）：
 * todo 防腐——同一 in_progress 连续 2 个 turn 未变 → 产出提醒文本（宿主以 system-reminder 注入下一轮）。
 * 计数状态按 taskId 隔离；钩子异常由 runTurnHooks 统一软失败。
 */

interface TodoStaleState {
  content: string | null;
  count: number;
}

const states = new Map<string, TodoStaleState>();

registerTurnHook({
  id: "builtin.hook.todo-stale",
  order: 5,
  source: "builtin",
  hook: (info) => {
    const ip = info.todoState?.find((t) => t.status === "in_progress");
    const st = states.get(info.taskId) ?? { content: null, count: 0 };
    if (ip && ip.content === st.content) {
      st.count++;
    } else {
      st.count = 0;
      st.content = ip?.content ?? null;
    }
    states.set(info.taskId, st);
    if (st.count >= 2) {
      st.count = 0;
      return `任务清单的「${ip?.content ?? ""}」已连续多轮停留在进行中。如已完成请更新 todo_write；如受阻请说明原因或向用户提问。`;
    }
    return null;
  },
});
