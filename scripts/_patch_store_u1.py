import io

# ---- store.ts: PageKey 放宽 + pages/context 同步 ----
p = 'web/src/state/store.ts'
s = io.open(p, encoding='utf-8').read()
old = 'export type PageKey = "projects" | "log" | "changes" | "branches" | "tasks" | "bash" | "settings";'
new = 'export type PageKey = string; // 页面 id = 注册表键（内置 7 页 + 外部页 ext.<pkg>.<id>，ui-pluginization-plan.md U1a）'
assert s.count(old) == 1, "st0"
s = s.replace(old, new)

old = '''  /** Agent 流式输出缓冲（agent.stream 事件，10s 无增量自动清空） */
  agentStreamText: string | null;
}'''
new = '''  /** Agent 流式输出缓冲（agent.stream 事件，10s 无增量自动清空） */
  agentStreamText: string | null;
  /** U1 页面注册表快照（App/Sidebar 消费；由 uiRegistry 订阅同步） */
  pages: UIPageDef[];
  /** U1b 共享上下文（跨页联动与外部页读取；页面内仍可保局部镜像） */
  context: {
    selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
    selectedCommitSha: string | null;
  };
}'''
assert s.count(old) == 1, "st1"
s = s.replace(old, new)

old = '''  agentStreamText: null,
};'''
new = '''  agentStreamText: null,
  pages: [],
  context: { selectedFile: null, selectedCommitSha: null },
};

/** 共享上下文补丁（页面向 store 镜像选中态）。 */
export function setSharedContext(patch: {
  selectedFile?: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
  selectedCommitSha?: string | null;
}): void {
  setState({
    context: {
      selectedFile: patch.selectedFile !== undefined ? patch.selectedFile : getState().context.selectedFile,
      selectedCommitSha: patch.selectedCommitSha !== undefined ? patch.selectedCommitSha : getState().context.selectedCommitSha,
    },
  });
}'''
assert s.count(old) == 1, "st2"
s = s.replace(old, new)

old = "import { useSyncExternalStore } from \"react\";"
assert s.count(old) == 1, "st3"
s = s.replace(old, old + '\nimport type { UIPageDef } from "../uiRegistry";')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('store ✓')
