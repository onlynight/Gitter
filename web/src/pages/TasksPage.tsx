import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DiffView, renderMarkdown, Select } from "../kit";
import type {
  AgentCheckpointDTO, AgentContextStatsDTO, AgentEventDTO, AgentHarnessDTO, AgentShellDTO, AgentTaskDTO,
  AgentTaskFileDTO, DiffDTO, ModelProfileDTO, TaskTypeDTO, WorktreeDTO,
} from "../bridge/types";
import { pageSdk, useAppState, useTaskFocus } from "../pageSdk";
import {
  registerAgentUI, resolveTimelineRenderer, composerProviders, useAgentUIVersion,
  type TimelineRendererDef, type ComposerMentionProviderDef, type TimelineCardCtx,
} from "../external/agentUIShim";
import { TlIcon, toolIconName, type TlIconName } from "./taskIcons";
import { TaskChangesPanel } from "./TaskChangesPanel";
import {
  TOOL_LABELS, BUILTIN_TIMELINE_RENDERERS, pushCap, reduceBlocks, closeRunningTools, groupLogs, groupTurns, permOptions,
  type Block, type Todo, type TurnGroup, type PermOption,
  TodoList, PermissionCard, QuestionCard, PlanCard, SubtaskBlock, FileGroup,
} from "./TaskTimeline";
import { Composer, MentionPopover, SlashPopover, BUILTIN_COMPOSER_PROVIDERS, MODE_ORDER, MODE_META, THINKING_META, type ModelGroupVM } from "./TaskComposer";
import { ChangesTab, CheckpointsTab, ShellsTab, SubagentsTab } from "./TaskDetailPages";
import { TaskWrapupDialog, TaskFeedbackDialog } from "./TaskWrapupDialog";
// 任务页 v3（docs/task-page-v2-design.md）：Codex 信息架构（任务卡列表 + 对话/改动/检查点三独立页）
// × ZCode 交互（⏺ 工具卡折叠/⎿ 结果、编号授权选项、todo 清单、Esc/Esc×2、Shift+Tab 模式循环、
// 上下文条、发送/停止合一图标按钮）。页签为全局导航，改动/检查点为完全独立页（无对话元素）。
const { call, on: onEvent, t, openSettings, notifyRepoChanged } = pageSdk;

const LIVE_STATES = new Set(["starting", "working", "awaiting-input", "awaiting-permission"]);
const BUSY_STATES = new Set(["starting", "working", "awaiting-permission"]);

/** 内置斜杠命令表（§20.3.8 数据化自举：补全列表与分发表同一数据源；包命令走 agent.command 贡献） */
const BUILTIN_SLASH: { name: string; arg?: string; hint: string; template?: string }[] = [
  { name: "compact", hint: "立即压缩上下文" },
  { name: "clear", hint: "重置会话（保留 worktree/checkpoint）" },
  { name: "plan", hint: "切计划模式" },
  { name: "default", hint: "切默认模式" },
  { name: "yolo", hint: "切完全访问模式" },
  { name: "approvals", hint: "切换审批模式（同 Shift+Tab）" },
  { name: "stop", hint: "中断当前轮" },
  { name: "model", arg: "<id>", hint: "切换模型档案" },
  { name: "thinking", arg: "<level>", hint: "切换思考深度" },
  { name: "fork", hint: "分叉任务" },
  { name: "skill", arg: "<名称>", hint: "注入技能指引" },
  { name: "export", hint: "导出会话为 Markdown 文件" },
  { name: "cp", hint: "立即创建检查点" },
  { name: "diff", hint: "查看当前改动" },
  { name: "attach", hint: "附加图片（随下条消息发送）" },
  // 模板命令（D3/D4）：与包命令同一分发语义（busy 排队 / idle 续跑，零新增 RPC）
  { name: "review", hint: "审查当前工作区改动（review 子代理）",
    template: "请用 task 工具（mode=review）审查当前工作区改动：先 repo_status / repo_diff 获取变更，逐文件审查正确性、边界条件与测试影响，产出问题清单（文件:行号 + 高/中/低 + 修复建议），最后给出可合并结论。${input}" },
  { name: "init", hint: "分析仓库并生成/更新 AGENTS.md",
    template: "请分析当前仓库（目录结构、构建/测试/lint 命令、代码约定、现有文档），在仓库根生成或更新 AGENTS.md：项目简介、常用命令、目录导览、代码约定与注意事项。已存在时合并改进而非覆盖。${input}" },
];


function stateChip(s: AgentTaskDTO["state"], awaitKind?: "question" | "plan" | null): { label: string; color: string } {
  // awaiting-input 按 awaitKind 细分（v3.3）：question=等你回答 / plan=待确认计划 / null=已完成
  if (s === "awaiting-input") {
    if (awaitKind === "question") return { label: "等你回答", color: "var(--c-amber)" };
    if (awaitKind === "plan") return { label: "待确认计划", color: "var(--c-chip-purple-fg, #b490ff)" };
    return { label: "已完成", color: "var(--c-text3)" };
  }
  switch (s) {
    case "starting": return { label: "启动中", color: "var(--c-text3)" };
    case "working": return { label: "执行中", color: "var(--c-green)" };
    case "awaiting-permission": return { label: "待确认", color: "var(--c-amber)" };
    case "completed": return { label: "已完成", color: "var(--c-accent)" };
    case "failed": return { label: "失败", color: "var(--c-red)" };
    case "interrupted": return { label: "已中断", color: "var(--c-amber)" };
    case "stopped": return { label: "已停止", color: "var(--c-text3)" };
  }
}

/** 列表筛选归类（v3.3 工作流 A）：进行中 / 待处理（授权+提问+计划）/ 已完成 / 失败·中断。 */
function taskCategory(t: AgentTaskDTO): "run" | "ask" | "done" | "err" {
  if (t.state === "starting" || t.state === "working") return "run";
  if (t.state === "awaiting-permission") return "ask";
  if (t.state === "awaiting-input") return t.awaitKind ? "ask" : "done";
  if (t.state === "failed" || t.state === "interrupted" || t.state === "stopped") return "err";
  return "done";
}

/** 日期分组（lastActiveAt ?? createdAt → 今天/昨天/近 7 天/更早）。 */
function dateGroupOf(iso: string | null): "today" | "yesterday" | "week" | "older" {
  const ts = iso ? new Date(iso).getTime() : 0;
  if (!ts) return "older";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "today";
  if (ts >= startOfToday - 86400_000) return "yesterday";
  if (ts >= startOfToday - 7 * 86400_000) return "week";
  return "older";
}
const DATE_GROUPS: { id: "today" | "yesterday" | "week" | "older"; label: string }[] = [
  { id: "today", label: "今天" }, { id: "yesterday", label: "昨天" }, { id: "week", label: "近 7 天" }, { id: "older", label: "更早" },
];

// ---- ZCode 式交互组件 ----

function ErrorFloat(props: { text: string; maxWidth: number | string; go?: { label: string; section: string } | null; onGo?: (section: string) => void; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const textRef = useRef<HTMLSpanElement | null>(null);
  // 换新错误时回到折叠态，并按当前宽度重测是否被截断
  useEffect(() => {
    setOpen(false);
    const el = textRef.current;
    setTruncated(!!el && el.scrollWidth > el.clientWidth + 1);
  }, [props.text]);
  return (
    <div className="banner error" style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 30, margin: 0, maxWidth: props.maxWidth, boxShadow: "0 8px 20px color-mix(in srgb, #000 25%, transparent)" }}>
      <span ref={textRef} className="banner-text"
        style={open ? { whiteSpace: "normal", wordBreak: "break-word", maxHeight: "40vh", overflowY: "auto", userSelect: "text" } : undefined}>
        {props.text}
      </span>
      {(truncated || open) && (
        <button className="tool-btn" style={{ flex: "none" }} onClick={() => setOpen((v) => !v)}>{open ? "收起" : "展开"}</button>
      )}
      {props.go && props.onGo && (
        <button className="tool-btn" title={`打开设置 · ${props.go.section}`}
          style={{ flex: "none", color: "var(--c-link)", textDecoration: "underline", textUnderlineOffset: 2 }}
          onClick={() => props.onGo!(props.go!.section)}>{props.go.label}</button>
      )}
      <button className="tool-btn" style={{ flex: "none" }} onClick={props.onClose}>✕</button>
    </div>
  );
}



// ---- 内置时间线渲染器自举（agent-harness-v4.md §20.3.7 第 2 期迁移）----
// 十类展示块经 registerAgentUI 与插件包同接缝竞争（层级 builtin：用户包可替换，宿主缺省兜底）；
// 交互卡（授权/提问/计划）是裁决面 UI，不开放替换（§20.9），仍硬接线在 renderBlock。
// @文件 mention 同批迁移为内置 composer provider（插件可加新前缀，同 prefix 用户包覆盖）。


let builtinAgentUIDone = false;
function registerBuiltinAgentUI(): void {
  if (builtinAgentUIDone || typeof window === "undefined" || !window.GITTER_UI) return;
  builtinAgentUIDone = true;
  registerAgentUI({ timelineRenderers: BUILTIN_TIMELINE_RENDERERS, composerProviders: BUILTIN_COMPOSER_PROVIDERS });
}
registerBuiltinAgentUI();

// ---- 页面 ----

export function TasksPage() {
  const app = useAppState();
  const repo = app.repo;
  const [worktrees, setWorktrees] = useState<WorktreeDTO[] | null>(null);
  const [harnesses, setHarnesses] = useState<AgentHarnessDTO[] | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTaskDTO[] | null>(null);
  // v3.3 列表管理（工作流 A）：搜索 / 状态筛选 / 日期分组 / 归档查看 / 行内重命名 / 删除确认
  const [listQuery, setListQuery] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "run" | "ask" | "done" | "err">(() => {
    const v = localStorage.getItem("gitter.taskListFilter");
    return v === "run" || v === "ask" || v === "done" || v === "err" ? v : "all";
  });
  // v3.4 工具条（task-page-wrapup-and-list-design.md）：排序下拉 / 筛选下拉 / 批量归档选择态
  const [listSort, setListSort] = useState<"active" | "created" | "title">(() => {
    const v = localStorage.getItem("gitter.taskListSort");
    return v === "created" || v === "title" ? v : "active";
  });
  const [listPop, setListPop] = useState<"filter" | "sort" | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [archOpen, setArchOpen] = useState(() => localStorage.getItem("gitter.taskArchOpen") === "1");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [delPopId, setDelPopId] = useState<string | null>(null);
  const [shellRunning, setShellRunning] = useState(0);
  const [subagentCount, setSubagentCount] = useState(0);
  // 「后台」页签跳转锚（design v2 §5）：卡片点 ⤴ 后台 → 切 tab 并自动展开对应 shellId 详情
  const [shellFocus, setShellFocus] = useState<{ shellId: string; ts: number } | null>(null);
  // 「子代理」页签跳转锚（v4.9 设计稿 §3）：会话内单行化子代理卡点「← 查看详情」→ 切 tab 并打开该 subtaskId 详情
  const [subagentFocus, setSubagentFocus] = useState<{ subtaskId: string; ts: number } | null>(null);
  // 子代理运行条耗时兜底：subtask block 首次出现时记录挂载时间（后端 durationMs 只在结束时才回填，
  // 运行中用当前时间减首见时间即可显示实时秒数；subtask block 一旦出现在 evMap 就不再变化）
  const subtaskStartRef = useRef<Map<string, number>>(new Map());
  const subtaskStartAt = (b: { subtaskId: string }): number => {
    const m = subtaskStartRef.current;
    if (!m.has(b.subtaskId)) m.set(b.subtaskId, Date.now());
    return m.get(b.subtaskId)!;
  };
  const [wrapupOpen, setWrapupOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [taskTypes, setTaskTypes] = useState<TaskTypeDTO[]>([]);
  const [modelProfiles, setModelProfiles] = useState<ModelProfileDTO[]>([]);
  const [taskTypeId, setTaskTypeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<"plan" | "default" | "yolo">("default");
  const [tab, setTab] = useState<"chat" | "diff" | "cp" | "subagents" | "shells">("chat");
  // 详细模式（v4.7 §4.3，照抄 ZCode ctrl+o）：工具结果/思考默认全展开
  const [verboseTimeline, setVerboseTimeline] = useState(false);
  // 分支模式提示浮层（收进图标按钮，不再占用会话流版面）
  const [branchHintOpen, setBranchHintOpen] = useState(false);
  // 悬浮输入框 dock / 流内容 ref：流底留白随 dock 实际高度自适应（v4.7）
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const streamInnerRef = useRef<HTMLDivElement | null>(null);
  // 切回对话页：恢复离开时的滚动位置（面板保持挂载，无需重新加载历史）
  useEffect(() => {
    if (tab !== "chat") return;
    requestAnimationFrame(() => {
      const el = timelineRef.current;
      if (!el) return;
      const saved = lastChatScrollRef.current;
      if (saved != null) { el.scrollTop = saved; lastChatScrollRef.current = null; }
      else scrollTimelineToBottom(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [evMap, setEvMap] = useState<Record<string, Block[]>>({});
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [focusTaskId, consumeTaskFocus] = useTaskFocus();
  useEffect(() => {
    if (!focusTaskId) return;
    setSelectedTask(focusTaskId);
    consumeTaskFocus();
  }, [focusTaskId]);
  const [error, setError] = useState<string | null>(null);
  // 「去设置」跳转：仅与 setConfigError 设置的那条错误配对（普通 setError 不带跳转）
  const [errorGo, setErrorGo] = useState<{ label: string; section: string } | null>(null);
  const errorGoFor = useRef<string | null>(null);
  const setConfigError = (text: string, label: string, section: string) => {
    errorGoFor.current = text;
    setErrorGo({ label, section });
    setError(text);
  };
  useEffect(() => {
    if (error !== errorGoFor.current) setErrorGo(null);
  }, [error]);
  const [inputText, setInputText] = useState("");
  const [composeText, setComposeText] = useState("");
  // 思考深度：跟随所选模型的档案默认值（添加模型时配置；分组按实际成员取），任务打开时用其持久值
  const defaultProfile = modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
  /** 模型引用 → 分组主条目（成员引用 `分组id#模型id` 归到所属分组卡片）。 */
  const resolveRefProfile = (ref: string | null | undefined): ModelProfileDTO | undefined => {
    if (!ref) return undefined;
    const gid = ref.split("#")[0];
    return modelProfiles.find((m) => m.id === ref) ?? modelProfiles.find((m) => m.id === gid);
  };
  /** 模型引用 → 该成员的视觉能力（成员可与首成员不同，D1 门控按实际选中成员判定）。 */
  const resolveRefVision = (ref: string | null | undefined): boolean => {
    const profile = resolveRefProfile(ref);
    if (!profile) return false;
    const gid = profile.groupId;
    if (ref && ref.startsWith(`${gid}#`) && profile.groupModels) {
      const mem = profile.groupModels.find((g) => g.modelId === ref.slice(gid.length + 1));
      if (mem) return mem.vision;
    }
    return profile.capabilities.vision ?? false;
  };
  /** 模型引用 → 该成员的默认思考深度（选择/切换模型时带入）。 */
  const resolveRefThinking = (ref: string | null | undefined): "off" | "low" | "medium" | "high" => {
    const profile = resolveRefProfile(ref);
    if (!profile) return "medium";
    const gid = profile.groupId;
    if (ref && ref.startsWith(`${gid}#`) && profile.groupModels) {
      const mem = profile.groupModels.find((g) => g.modelId === ref.slice(gid.length + 1));
      if (mem) return mem.thinking;
    }
    return profile.thinking ?? "medium";
  };
  const [thinking, setThinking] = useState<"off" | "low" | "medium" | "high">(defaultProfile?.thinking ?? "medium");
  // 新建任务：模型未显式指定时跟随设置里的默认模型（含具体成员），切换选择即带入其思考深度
  useEffect(() => {
    if (!selectedTask) setThinking(resolveRefThinking(modelId || app.settings?.defaultModelId || defaultProfile?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, modelProfiles]);
  const [sending, setSending] = useState(false);
  // 发送互斥用同步 ref（React state 异步提交，同一渲染帧内的第二次 Enter 拦不住 → 重复建任务）
  const sendingRef = useRef(false);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<AgentContextStatsDTO | null>(null);
  const [changesTick, setChangesTick] = useState(0);
  const [mention, setMention] = useState<{ start: number; prefix: string; query: string } | null>(null);
  const [mentionItems, setMentionItems] = useState<{ label: string; insert: string }[]>([]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashSel, setSlashSel] = useState(0);
  const [mentionSel, setMentionSel] = useState(0);
  const [pkgCommands, setPkgCommands] = useState<{ name: string; template: string; packageId: string }[]>([]);
  const [permSel, setPermSel] = useState<Record<string, number>>({});
  // 轮次折叠：已结束轮默认折叠；用户手动展开的组按组锚（块对象引用）记忆
  const [expandedTurns, setExpandedTurns] = useState<Set<unknown>>(() => new Set());
  const toggleTurn = (anchor: unknown) => {
    setExpandedTurns((s) => { const n = new Set(s); if (n.has(anchor)) n.delete(anchor); else n.add(anchor); return n; });
  };
  const [maxSubagents, setMaxSubagents] = useState(3);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  // D1 图片输入（§21.2.1）：粘贴/拖拽附件（继续对话与新任务 composer 共用，互斥显示）
  const [pendingImages, setPendingImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const addImages = useCallback((files: { name: string; dataUrl: string }[]) => {
    setPendingImages((cur) => {
      const next = [...cur, ...files].slice(0, 4);
      return next;
    });
  }, []);
  const filesToImages = useCallback((files: File[]) => {
    const imgs = files.filter((f) => /^image\//.test(f.type)).slice(0, 4);
    for (const f of imgs) {
      if (f.size > 4 * 1024 * 1024) { setError(`图片超过 4MB 上限：${f.name}`); continue; }
      const reader = new FileReader();
      reader.onload = () => addImages([{ name: f.name || "image.png", dataUrl: String(reader.result) }]);
      reader.readAsDataURL(f);
    }
  }, [addImages]);
  // v3.1 实时变更面板（docs/task-page-live-changes.md）：对话 4/7 + 变更 3/7 分栏；
  // 对话流 查看/预览 一律驱动面板（右侧 = 主预览面），不再开 Modal / 跳改动页
  const [changesPanelOpen, setChangesPanelOpen] = useState(false); // 右侧面板默认不显示（v4.7）
  // 已排队尚未注入的输入（乐观渲染）：排队投递在主进程内以 reminder 包装注入下一轮，
  // 不会在会话流产生 user 消息——不本地记入时间线时，用户按回车后输入框被清空、
  // 自己发的内容凭空消失，只有页头「排队 N」角标可查。渲染层补一条提示（不回放，
  // 与主进程 journal 的「排队：…」注记同源，不会重复展示原文）
  const [queuedHints, setQueuedHints] = useState<Record<string, string[]>>({});
  const addQueuedHint = (taskId: string, text: string) =>
    setQueuedHints((m) => {
      const cur = m[taskId] ?? [];
      const next = [text];
      next.splice(0, 1, ...cur.slice(-5));
      return { ...m, [taskId]: next };
    });
  const clearQueuedHints = (taskId: string) =>
    setQueuedHints((m) => { if (!(m[taskId] ?? []).length) return m; const { [taskId]: _d, ...rest } = m; return rest; });
  // 标题栏页动作（v3.2 设计稿：分屏/新窗口在 app titlebar）：页面被 keep-alive 隐藏时经
  // IntersectionObserver 感知并摘除 portal 按钮；slot 容器由宿主 TitleBar 渲染，晚于页面
  // 挂载时轮询补一帧渲染（harness 无 TitleBar 时自然不渲染按钮）。
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [pageVisible, setPageVisible] = useState(true);
  const [, setTitlebarTick] = useState(0);
  useEffect(() => {
    const el = detailRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setPageVisible(entries[entries.length - 1]?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (document.getElementById("tbPageActions")) { setTitlebarTick((x) => x + 1); return; }
    let tries = 0;
    const timer = window.setInterval(() => {
      if (document.getElementById("tbPageActions") || ++tries > 50) { window.clearInterval(timer); setTitlebarTick((x) => x + 1); }
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  // 分栏布局：左任务列表分割线按像素持久化（比例在不同窗口宽度下位置漂移，观感奇怪——用户反馈）；
  // 右侧对话|变更分栏仍记比例（fr 份额）。拖拽实时调、松手落 localStorage。
  const TASK_LIST_MIN_W = 210;
  const TASK_LIST_MAX_W = 520;
  const [listWidth, setListWidth] = useState(() => {
    const v = Number(localStorage.getItem("gitter.taskListWidth"));
    if (Number.isFinite(v) && v >= TASK_LIST_MIN_W && v <= TASK_LIST_MAX_W) return Math.round(v);
    // 旧比例键一次性迁移：按当前窗口宽换算成像素后即弃用
    const legacy = Number(localStorage.getItem("gitter.taskListRatio"));
    localStorage.removeItem("gitter.taskListRatio");
    if (Number.isFinite(legacy) && legacy >= 0.12 && legacy <= 0.5) {
      return Math.max(TASK_LIST_MIN_W, Math.min(TASK_LIST_MAX_W, Math.round(legacy * window.innerWidth)));
    }
    return 300;
  });
  const [splitRatio, setSplitRatio] = useState(() => {
    localStorage.removeItem("gitter.taskSplitChatW");
    const v = Number(localStorage.getItem("gitter.taskSplitRatio"));
    return Number.isFinite(v) && v >= 0.2 && v <= 0.85 ? v : 4 / 7; // 默认 4fr/3fr
  });
  // ── 面板展开/收起动画（400ms，v3.2 设计稿）：transform 滑动，不做布局动画。
  // 逐帧补间 grid 模板 = 逐帧全量重排两个面板（时间线数百节点）——掉帧 + 轨道亚像素取整
  // 来回跳（用户实测左右抖动）。改为「状态一次落位 + transform 滑动」（纯合成器动画，
  // 零逐帧布局，transform 过渡在所有环境可靠插值）：
  //   展开 = 网格瞬落 3 列（对话列一次让位），面板在自身轨道内 translateX(100%→0) 滑入；
  //   收起 = 面板提升为绝对定位覆盖（宽度冻结=轨道宽），网格瞬落 1 列（对话列一次回占），
  //          面板 translateX(0→100%) 滑出后卸载（抽屉式）。
  // 中断（快速连点）只重定 transform 目标，从当前位置续滑；结束清理是惰性写入
  // （transform:none == translateX(0)，无布局变更，不闪）。锁宽/ResizeObserver 机制随
  // 布局动画一并移除——轨道不再逐帧变化，内容跟随 flex 自然填充，无挤压问题。
  // 轨道值必须绝对干净：内联 grid-template-columns 里只要出现一个非法轨道（NaNfr/
  // undefinedfr），CSSOM 会把整条声明丢弃，网格退化成按内容宽度的隐式轨道——对话列
  // 被 overflow 裁切、面板缩成内容宽、右侧留出整条空带（实测截图复现）。入参钳位兜底
  // 之外，.tk-detail 的 CSS 兜底模板再保一层（内联合法时始终覆盖它，见 styles.css）。
  const panelTemplate = (r: number) => {
    const rr = Number.isFinite(r) ? Math.min(0.85, Math.max(0.2, r)) : 4 / 7;
    return `minmax(280px, ${rr.toFixed(4)}fr) 6px minmax(280px, ${(1 - rr).toFixed(4)}fr)`;
  };
  const PANEL_TRANSFORM_TRANSITION = "transform 400ms var(--ease-std)";
  const panelWrapRef = useRef<HTMLDivElement | null>(null);
  const panelTimerRef = useRef<number | null>(null);
  const closeWRef = useRef(0); // 收起覆盖态冻结的面板宽
  // 动画目标态：点击即翻转（不等 React 提交），快速连点时 toggle 按意图取反而非按
  // 仍在动画中的旧状态；不随渲染回写（动画期间 changesPanelOpen 尚未提交）。
  const panelTargetRef = useRef(true);
  const [panelClosing, setPanelClosing] = useState(false); // 收起滑出中（覆盖态）
  const panelClosingRef = useRef(false);
  const openRef = useRef(changesPanelOpen);
  panelClosingRef.current = panelClosing;
  openRef.current = changesPanelOpen;
  const clearPanelTimer = () => {
    if (panelTimerRef.current != null) { window.clearTimeout(panelTimerRef.current); panelTimerRef.current = null; }
  };
  // 入场结束的惰性清理：transform:none 与 translateX(0) 视觉等价，纯合成器无布局变更
  const finishOpenCleanup = () => {
    const wrap = panelWrapRef.current;
    if (wrap) { wrap.style.transition = ""; wrap.style.transform = ""; }
    panelTimerRef.current = null;
  };
  const slideWrap = (offscreen: boolean) => {
    const wrap = panelWrapRef.current;
    if (!wrap) return;
    wrap.style.transition = PANEL_TRANSFORM_TRANSITION;
    wrap.style.transform = offscreen ? "translateX(100%)" : "translateX(0)";
  };
  const animatePanel = (open: boolean) => {
    panelTargetRef.current = open; // 目标即翻转：toggle 按意图取反，不依赖提交态
    clearPanelTimer();
    if (open) {
      if (panelClosingRef.current) { setPanelClosing(false); return; } // 覆盖滑出中 → 拉回续滑到 0（flip effect）
      if (openRef.current) return; // 稳态开
      setChangesPanelOpen(true); // 未挂载 → 入场 effect 滑入
    } else {
      if (!openRef.current) return; // 稳态关
      if (panelClosingRef.current) return; // 已在收起滑出，幂等
      const wrap = panelWrapRef.current;
      if (!wrap) { setChangesPanelOpen(false); return; }
      closeWRef.current = wrap.offsetWidth; // 布局宽（不含 transform），冻结覆盖尺寸
      setPanelClosing(true); // flip effect 滑出 + 卸载
    }
  };
  const openPanel = () => animatePanel(true);
  const closePanel = () => animatePanel(false);
  const togglePanel = () => animatePanel(!panelTargetRef.current);
  // 入场（从未挂载 → 挂载）：先同步置 100%（首帧不可见，防提交帧全开闪现），强制回流后
  // 开过渡滑入
  const prevOpenRef = useRef(changesPanelOpen);
  useLayoutEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = changesPanelOpen;
    if (!changesPanelOpen || wasOpen) return;
    const wrap = panelWrapRef.current;
    if (!wrap) return;
    wrap.style.transition = "none";
    wrap.style.transform = "translateX(100%)";
    void wrap.offsetWidth;
    slideWrap(false);
    panelTimerRef.current = window.setTimeout(finishOpenCleanup, 420);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changesPanelOpen]);
  // 覆盖态切换：进入 = 从当前位置滑出屏幕（结束卸载）；退出（被展开打断）= 拉回续滑到 0
  const prevClosingRef = useRef(panelClosing);
  useLayoutEffect(() => {
    const was = prevClosingRef.current;
    prevClosingRef.current = panelClosing;
    if (panelClosing && !was) {
      const wrap = panelWrapRef.current;
      if (!wrap) { setChangesPanelOpen(false); setPanelClosing(false); return; }
      void wrap.offsetWidth; // 覆盖样式（absolute + 冻结宽）已提交
      slideWrap(true);
      panelTimerRef.current = window.setTimeout(() => {
        panelTimerRef.current = null;
        setChangesPanelOpen(false);
        setPanelClosing(false);
      }, 420);
    } else if (!panelClosing && was && openRef.current) {
      slideWrap(false); // 拉回网格内续滑到 0
      panelTimerRef.current = window.setTimeout(finishOpenCleanup, 420);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelClosing]);
  // 左列表分割线拖拽：拖拽中直写 grid 列（不经 React 渲染，无抖动），松手落像素值
  const startListDrag = (e: { currentTarget: HTMLElement; preventDefault(): void }) => {
    e.preventDefault();
    const grip = e.currentTarget;
    const main = grip.parentElement;
    if (!main) return;
    grip.classList.add("drag");
    let px = listWidth;
    const move = (ev: PointerEvent) => {
      const rect = main.getBoundingClientRect();
      // 上限取像素帽与「留 340px 给对话列」的较小者（窄窗不挤破右侧）
      px = Math.round(Math.max(TASK_LIST_MIN_W, Math.min(TASK_LIST_MAX_W, ev.clientX - rect.left, rect.width - 346)));
      main.style.gridTemplateColumns = `${px}px 6px minmax(0, 1fr)`;
    };
    const up = () => {
      grip.classList.remove("drag");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setListWidth(px);
      localStorage.setItem("gitter.taskListWidth", String(px));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const startSplitDrag = (e: { currentTarget: HTMLElement; preventDefault(): void }) => {
    e.preventDefault();
    const grip = e.currentTarget;
    const split = grip.parentElement;
    if (!split) return;
    grip.classList.add("drag");
    const move = (ev: PointerEvent) => {
      const rect = split.getBoundingClientRect();
      const r = Math.max(0.2, Math.min(0.8, (ev.clientX - rect.left - 3) / rect.width));
      split.style.gridTemplateColumns = `minmax(340px, ${r.toFixed(4)}fr) 6px minmax(280px, ${(1 - r).toFixed(4)}fr)`;
    };
    const up = () => {
      grip.classList.remove("drag");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const m = split.style.gridTemplateColumns.match(/([0-9.]+)fr/);
      if (m) { const r = Number(m[1]); setSplitRatio(r); localStorage.setItem("gitter.taskSplitRatio", String(r)); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [panelReq, setPanelReq] = useState<{ path: string; mode: "preview" | "diff"; ts: number } | null>(null);
  const previewFile = useCallback((path: string) => {
    setPanelReq({ path, mode: "preview", ts: Date.now() });
    setTab("chat");
    animatePanel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [cpCount, setCpCount] = useState(0);
  const [diffCount, setDiffCount] = useState(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  // 贴底跟随开关：视窗停在底部附近才随新内容自动滚底；用户上滚阅读即停用，回到底部（含浮钮）
  // 自动恢复。程序化贴底与回补位置也会触发 scroll 事件，状态在这里统一收敛。
  const stickBottomRef = useRef(true);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  // 最近一次时间线滚动位置：切改动/检查点后切回对话时恢复，避免回顶
  const lastChatScrollRef = useRef<number | null>(null);
  // 稳定引用：onScroll 回调通过 ref 调用 loadOlder，避免闭包依赖
  const loadOlderRef = useRef<(() => void) | null>(null);
  // 距底超过 80px 才显示「返回底部」浮钮：滚轮微动不闪烁，接近底部即隐藏
  const onTimelineScroll = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
    stickBottomRef.current = !away;
    setAwayFromBottom((v) => (v === away ? v : away));
    // 持续记录滚动位置：切改动/检查点再切回时恢复（面板保持挂载，不重载）
    lastChatScrollRef.current = el.scrollTop;
    // 距顶 < 160px 触发加载更早；由 loadOlder 内部的 guard 去重
    if (el.scrollTop < 160) void loadOlderRef.current?.();
  }, []);
  const replied = useRef(new Set<string>());
  const inputHistory = useRef<string[]>([]);
  const historyIdx = useRef(-1);
  const escTs = useRef(0);
  const oldestTs = useRef<string | null>(null);
  const composeRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  // composer 自动增高由 Composer 组件内部按 minH/maxH props 处理（此处旧的重复 effect 会覆盖组件内高度）
  const [, forceTick] = useState(0);
  // agent UI 注册表版本订阅：包热插拔（用户包注册/卸载渲染器、provider）时时间线重渲染
  useAgentUIVersion();
  // 模块级自举错过注入窗口时（宿主内置组件语境）由组件体补注册（幂等）
  registerBuiltinAgentUI();

  const scrollTimelineToBottom = useCallback((smooth?: boolean) => {
    const doScroll = () => {
      const el = timelineRef.current;
      if (!el) return;
      if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else el.scrollTop = el.scrollHeight;
      // 程序化设置 scrollTop 不一定触发 scroll 事件（尤其 IAB/Playwright），
      // 显式同步浮钮与贴底跟随状态，避免「已到底部但按钮仍在/跟随仍停用」
      stickBottomRef.current = true;
      setAwayFromBottom(false);
    };
    // 立即滚一次（覆盖点击当时的状态），再在下一帧滚一次吸收新增 DOM 布局
    doScroll();
    requestAnimationFrame(doScroll);
  }, []);

  // 新任务（按钮 / Ctrl+N）：回到新任务 composer 并聚焦输入框。
  // 快捷键在 window 上监听、随本页卸载清理——仅任务页挂载期间生效，其他页面不受影响。
  const startNewTask = useCallback(() => {
    setSelectedTask(null);
    setTab("chat");
    requestAnimationFrame(() => requestAnimationFrame(() => composeRef.current?.focus()));
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        startNewTask();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [startNewTask]);

  const reloadWorktrees = useCallback(async () => {
    if (!repo) return;
    try { setWorktrees(await call<WorktreeDTO[]>("tasks.list")); } catch (e) { setError((e as Error).message); }
  }, [repo]);

  const reloadAgents = useCallback(async () => {
    if (!repo) return;
    try {
      setHarnesses(await call<AgentHarnessDTO[]>("agents.list"));
      // includeArchived：归档查看/恢复（v3.3 工作流 A）——量级小，一次拉全，前端过滤
      setAgentTasks(await call<AgentTaskDTO[]>("agent.tasks", { includeArchived: true }));
      setTaskTypes(await call<TaskTypeDTO[]>("agent.taskTypes.list"));
      setModelProfiles(await call<ModelProfileDTO[]>("models.list"));
      const cmds = await call<{ id: string; action?: string; packageId?: string; args?: unknown }[]>("commands.list");
      setPkgCommands(
        cmds
          .filter((c) => c.action === "agent.command")
          .map((c) => {
            const a = (c.args ?? {}) as { slash?: string; template?: string };
            const short = c.packageId?.split(".").pop() ?? "pkg";
            return { name: `${short}:${a.slash ?? c.id}`, template: a.template ?? "${input}", packageId: c.packageId ?? "" };
          }),
      );
    } catch (e) { setError((e as Error).message); }
  }, [repo]);

  useEffect(() => {
    void reloadWorktrees();
    void reloadAgents();
  }, [repo, app.refreshTick, reloadWorktrees, reloadAgents]);

  useEffect(() => {
    void call<{ agentsMaxSubagents?: number; agentsBusySend?: "queue" | "interrupt" | "block" }>("settings.get").then((s) => {
      if (s?.agentsMaxSubagents) setMaxSubagents(s.agentsMaxSubagents);
      if (s?.agentsBusySend) setBusySend(s.agentsBusySend);
    }).catch(() => {});
  }, []);
  // 运行中发送策略：queue=排队（默认）/ interrupt=插话（中断当前轮立即注入）/ block=禁止
  const [busySend, setBusySend] = useState<"queue" | "interrupt" | "block">("queue");

  // 事件摄入 → 时间线块
  useEffect(
    () =>
      onEvent("agent.event", (p) => {
        const { taskId, event } = p as { taskId: string; event: AgentEventDTO };
        setEvMap((m) => ({ ...m, [taskId]: reduceBlocks(m[taskId] ?? [], event) }));
        // 已排队的输入被注入为新一轮（主进程 agent.event 只带计数与轮号，不带原文）：
        // 按序清除先前显示的提示，提示从「排队」变成「已注入」，轮次收尾后整体滚动
        if (event.type === "queued-drained" && (event.queuedDrained ?? 0) > 0) {
          setQueuedHints((m) => {
            const n = Math.min(event.queuedDrained ?? 0, (m[taskId] ?? []).length);
            if (n === 0) return m;
            const left = (m[taskId] ?? []).slice(n);
            const out: Record<string, string[]> = {};
            for (const [k, v] of Object.entries(m)) if (v.length) out[k] = v;
            out[taskId] = left;
            if (!left.length) delete out[taskId];
            return out;
          });
        }
        if (event.type === "turn-completed" || event.type === "completed") {
          void reloadAgents();
          setChangesTick((n) => n + 1);
        }
        // file-change / checkpoint 即时驱动改动·检查点徽标与对应页签数据刷新（不等轮次结束）
        if (event.type === "file-change" || event.type === "checkpoint") setChangesTick((n) => n + 1);
      }),
    [reloadAgents],
  );
  useEffect(
    () => onEvent("agent.tasks.changed", () => void reloadAgents()),
    [reloadAgents],
  );

  // 顶部页签徽标数量：不依赖改动/检查点页签挂载——文件变更/检查点/轮次结束事件（tick）
  // 驱动父级直接拉取，停留在对话页时徽标也实时更新；页签打开后组件内 onCount 上报同源数据自然一致
  useEffect(() => {
    if (!selectedTask) { setDiffCount(0); setCpCount(0); return; }
    let cancelled = false;
    void call<AgentTaskFileDTO[]>("agent.task.files", { taskId: selectedTask })
      .then((fs) => { if (!cancelled) setDiffCount(fs.length); })
      .catch(() => {});
    void call<AgentCheckpointDTO[]>("agent.task.checkpoints", { taskId: selectedTask })
      .then((x) => { if (!cancelled) setCpCount(x.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTask, changesTick]);

  const selected = agentTasks?.find((x) => x.taskId === selectedTask) ?? null;
  const runningCount = (agentTasks ?? []).filter((x) => LIVE_STATES.has(x.state)).length;

  // 列表过滤 + 日期分组（纯前端，v3.3 工作流 A）：命中 title/lastMessage/id 前 8 位；归档行仅在开关开 + 「全部」时混入
  const listQ = listQuery.trim().toLowerCase();
  const listHit = (t: AgentTaskDTO) =>
    !listQ || t.title.toLowerCase().includes(listQ) || (t.lastMessage ?? "").toLowerCase().includes(listQ) || t.taskId.slice(0, 8).includes(listQ);
  const visibleTasks = (agentTasks ?? []).filter((t) => {
    if (t.archived) return archOpen && listFilter === "all" && listHit(t);
    if (listFilter !== "all" && taskCategory(t) !== listFilter) return false;
    return listHit(t);
  });
  const listCounts = {
    all: (agentTasks ?? []).filter((t) => !t.archived).length,
    run: (agentTasks ?? []).filter((t) => !t.archived && taskCategory(t) === "run").length,
    ask: (agentTasks ?? []).filter((t) => !t.archived && taskCategory(t) === "ask").length,
    done: (agentTasks ?? []).filter((t) => !t.archived && taskCategory(t) === "done").length,
    err: (agentTasks ?? []).filter((t) => !t.archived && taskCategory(t) === "err").length,
    arch: (agentTasks ?? []).filter((t) => t.archived).length,
  };
  // v3.4 排序（组内排序，日期分组保持）：active=账本次序（新→旧）/ created=创建时间新→旧 / title=标题
  const sortRows = (rows: AgentTaskDTO[]) => {
    if (listSort === "title") return [...rows].sort((a, b) => a.title.localeCompare(b.title, "zh"));
    if (listSort === "created") return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  };
  const groupedTasks = DATE_GROUPS
    .map((g) => ({ ...g, tasks: sortRows(visibleTasks.filter((t) => dateGroupOf(t.lastActiveAt ?? t.createdAt) === g.id)) }))
    .filter((g) => g.tasks.length > 0);

  // 下拉点外关闭
  useEffect(() => {
    if (!listPop) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".tk-pop, .tk-tbtn")) return;
      setListPop(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [listPop]);

  // v3.4 批量归档：选择态 + 循环 archive
  const enterSelect = () => { setListPop(null); setPicked(new Set()); setSelecting(true); };
  const exitSelect = () => { setSelecting(false); setPicked(new Set()); };
  const togglePick = (taskId: string) => setPicked((s) => { const n = new Set(s); if (n.has(taskId)) n.delete(taskId); else n.add(taskId); return n; });
  const pickAllVisible = () => setPicked(new Set(visibleTasks.filter((t) => !t.archived).map((t) => t.taskId)));
  const archivePicked = async () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    try {
      for (const id of ids) await call("agent.task.archive", { taskId: id, archived: true });
      exitSelect();
      await reloadAgents();
    } catch (e) { setError((e as Error).message); }
  };

  // 运行中工具 + 子代理计数 + 上下文用量
  // design v2 §3.1：任务非 live 时，仍在 running 的工具不再计时（渲染层同步归约为 aborted）
  // lastActiveAt = 本轮运行起点（创建/续跑时写入）：更早开始的 running 工具是上一轮残留
  // （end 事件已丢失），不计入 chip——否则命令时长从旧起点累计，会超过任务总时长。
  const runningTool = (() => {
    if (!selectedTask) return null;
    if (!selected || !LIVE_STATES.has(selected.state)) return null;
    const blocks = evMap[selectedTask] ?? [];
    const runStartMs = selected.lastActiveAt ? new Date(selected.lastActiveAt).getTime() : 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind === "tool" && b.state === "running") return b.startTs >= runStartMs ? b : null;
    }
    return null;
  })();
  // 子代理运行数：仅任务正在运行（starting/working）时统计——awaiting-input/awaiting-permission
  // 是 LIVE 状态但任务列表显示"已完成"，此时子代理不应显示运行中。
  // 参照 taskCategory：只有 "run" 分类才统计 running 子代理。
  const runningSubs = selectedTask && selected && taskCategory(selected) === "run"
    ? (evMap[selectedTask] ?? []).filter((b) => b.kind === "subtask" && b.state === "running").length
    : 0;

  // 切任务即复位：避免上一个任务的用量残留到新任务（轮询数据到达前短暂空窗，正确优于误导）
  useEffect(() => { setStats(null); }, [selectedTask]);
  useEffect(() => { setExpandedTurns(new Set()); }, [selectedTask]);
  useEffect(() => {
    if (!selectedTask) { setShellRunning(0); return; }
    let cancelled = false;
    const pull = () => {
      void call<AgentContextStatsDTO | null>("agent.context.stats", { taskId: selectedTask })
        .then((s) => { if (!cancelled) setStats(s); })
        .catch(() => {});
      // 后台 shell 运行数（页签徽标；仅 live 有数据）
      void call<AgentShellDTO[]>("agent.task.shells", { taskId: selectedTask })
        .then((x) => { if (!cancelled) setShellRunning(x.filter((s) => s.running).length); })
        .catch(() => {});
    };
    pull();
    const iv = setInterval(pull, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [selectedTask, changesTick]);

  // 删除确认浮层：点外部 / Esc 关闭
  useEffect(() => {
    if (!delPopId) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".tk-delpop")) return;
      setDelPopId(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setDelPopId(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [delPopId]);

  useEffect(() => {
    if (!runningTool) return;
    const iv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [runningTool]);

  const eventsToBlocks = (events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]): Block[] => {
    let blocks: Block[] = [];
    for (const je of events) {
      if (je.kind === "text") {
        // 新的用户消息说明上一轮已结束：仍在 running 的工具卡是丢失了 end 事件的残留，归约为 aborted
        blocks = closeRunningTools(blocks);
        blocks = pushCap(blocks, { kind: "human", text: je.text ?? "" });
      }
      else blocks = reduceBlocks(blocks, je.event as AgentEventDTO, je.ts);
    }
    return blocks;
  };

  // 历史回填（分页 + 加载更早）
  useEffect(() => {
    if (!selectedTask) return;
    if ((evMap[selectedTask] ?? []).length > 0) return;
    let cancelled = false;
    void call<{ events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]; hasMore?: boolean }>(
      "agent.task.history", { taskId: selectedTask, limit: 100 },
    )
      .then((h) => {
        if (cancelled) return;
        const blocks = eventsToBlocks(h.events);
        oldestTs.current = h.events[0]?.ts ?? null;
        setEvMap((m) => (m[selectedTask]?.length ? m : { ...m, [selectedTask]: blocks }));
        setHasMoreHistory(!!h.hasMore);
        scrollTimelineToBottom();
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTask, evMap, scrollTimelineToBottom]);

  const loadOlder = async () => {
    if (!selectedTask || loadingOlder || !oldestTs.current) return;
    const el = timelineRef.current;
    setLoadingOlder(true);
    // 记录加载前的位置，加载完成后按新增高度补偿 scrollTop，视角停在原来那条消息上
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    try {
      const h = await call<{ events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]; hasMore?: boolean }>(
        "agent.task.history", { taskId: selectedTask, before: oldestTs.current, limit: 100 },
      );
      const older = eventsToBlocks(h.events);
      if (h.events[0]?.ts) oldestTs.current = h.events[0].ts;
      setHasMoreHistory(!!h.hasMore);
      if (older.length > 0) {
        // 预置抑制位：evMap 变更后触发的自动滚底 effect 会跳过一次
        skippingAutoScroll.current = true;
        setEvMap((m) => ({ ...m, [selectedTask]: [...older, ...(m[selectedTask] ?? [])] }));
        // 下一帧 DOM 提交后补偿滚动位置
        requestAnimationFrame(() => {
          const e2 = timelineRef.current;
          if (!e2) return;
          const delta = e2.scrollHeight - prevScrollHeight;
          if (delta > 0) e2.scrollTop = prevScrollTop + delta;
        });
      }
    } catch (e) { setError((e as Error).message); } finally { setLoadingOlder(false); }
  };
  // 稳定引用：onScroll 回调通过 ref 调用 loadOlder，避免闭包依赖
  loadOlderRef.current = loadOlder;
  // 上滚加载更早时置位，抑制「回填后自动滚底」副作用（loadOlder 内已按新增高度补偿 scrollTop）
  const skippingAutoScroll = useRef(false);

  // 切任务恢复贴底跟随（任务打开默认展示最新内容）
  useEffect(() => { stickBottomRef.current = true; }, [selectedTask]);

  useEffect(() => {
    if (skippingAutoScroll.current) { skippingAutoScroll.current = false; return; }
    // 用户上滚阅读时不再强制拽回底部（否则与滚动操作打架）：仅视窗停在底部附近才跟随新内容
    if (!stickBottomRef.current) return;
    scrollTimelineToBottom();
  }, [evMap, selectedTask, scrollTimelineToBottom]);

  // Esc：一次=中断；500ms 内两次=打开检查点页（ZCode rewind）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !selectedTask) return;
      const now = Date.now();
      if (now - escTs.current < 500) {
        setTab("cp");
        escTs.current = 0;
      } else {
        escTs.current = now;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedTask]);

  // Ctrl+O 详细模式切换（v4.7 §4.3）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setVerboseTimeline((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  // 流底留白自适应：dock（composer 容器）高度变化 → 写入流内容 padding-bottom
  useEffect(() => {
    const dock = composerDockRef.current, inner = streamInnerRef.current;
    if (!dock || !inner || typeof ResizeObserver === "undefined") return;
    const fit = () => { inner.style.paddingBottom = `${dock.offsetHeight + 56}px`; };
    const ro = new ResizeObserver(fit);
    ro.observe(dock);
    fit();
    return () => ro.disconnect();
  }, [selected]);

  const pendingPerm = (() => {
    if (!selectedTask) return null;
    const blocks = evMap[selectedTask] ?? [];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind === "permission" && !decided[b.requestId]) return b;
    }
    return null;
  })();

  const replyPerm = useCallback(async (requestId: string, ok: boolean, remember?: boolean, rulePrefix?: string | null) => {
    setDecided((d) => ({ ...d, [requestId]: ok ? (rulePrefix ? "rule" : "ok") : "deny" }));
    try {
      if (rulePrefix) {
        // 总是允许前缀 → 写持久规则（settings.agentRules，deny>allow>基线）
        const tool = (evMap[selectedTask ?? ""] ?? []).find((b) => b.kind === "permission" && b.requestId === requestId);
        const ruleTool = tool && tool.kind === "permission" ? tool.toolName : "";
        const s = await call<{ agentRules?: { id: string; tool: string; pattern: string | null; effect: "allow" | "deny"; scope: "global" | "repo"; createdAt: string }[] }>("settings.get");
        const rules = [
          ...(s.agentRules ?? []),
          { id: `rule-${Date.now().toString(36)}`, tool: ruleTool, pattern: rulePrefix, effect: "allow" as const, scope: "global" as const, createdAt: new Date().toISOString() },
        ];
        await call("settings.set", { agentRules: rules });
        await call("agent.perm.reply", { requestId, ok: true, remember: true });
      } else {
        await call("agent.perm.reply", { requestId, ok, remember });
      }
    } catch (e) { setError((e as Error).message); }
  }, [selectedTask, evMap]);

  // Codex 式升级：批准当前请求并把任务切到完全访问（yolo）——后续免授权，仅 ask_user 提问照常
  const replyFullAccess = useCallback(async (requestId: string) => {
    if (!selected) return;
    setDecided((d) => ({ ...d, [requestId]: "ok" }));
    try {
      await call("agent.perm.reply", { requestId, ok: true, remember: true });
      await call("agent.task.setMode", { taskId: selected.taskId, mode: "yolo" });
      setMode("yolo");
      await reloadAgents();
    } catch (e) { setError((e as Error).message); }
  }, [selected, reloadAgents]);

  // 授权卡键盘：↑↓/Enter/数字直选（焦点不在输入框时）
  const showFullAccess = (selected?.permissionMode ?? "default") !== "yolo";
  useEffect(() => {
    if (!pendingPerm || !selectedTask) return;
    const requestId = pendingPerm.requestId;
    const opts = permOptions(pendingPerm, showFullAccess);
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const cur = permSel[requestId] ?? 0;
      const apply = (idx: number) => {
        const o = opts[Math.min(idx, opts.length - 1)];
        if (o.reply.fullAccess) void replyFullAccess(requestId);
        else if (o.reply.rulePrefix !== undefined && o.reply.rulePrefix !== null && o.reply.ok) replyPerm(requestId, true, true, o.reply.rulePrefix);
        else replyPerm(requestId, o.reply.ok, o.reply.remember);
      };
      if (e.key === "ArrowDown") { e.preventDefault(); setPermSel((m) => ({ ...m, [requestId]: Math.min(cur + 1, opts.length - 1) })); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setPermSel((m) => ({ ...m, [requestId]: Math.max(cur - 1, 0) })); }
      else if (e.key === "Enter") { e.preventDefault(); apply(cur); }
      else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < opts.length) { e.preventDefault(); apply(idx); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [pendingPerm, selectedTask, permSel, replyPerm, replyFullAccess, showFullAccess]);

  // Shift+Tab 权限模式循环
  const cycleMode = useCallback(() => {
    if (!selected) return;
    const cur = selected.permissionMode ?? "default";
    const next = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
    void call("agent.task.setMode", { taskId: selected.taskId, mode: next }).then(reloadAgents).catch((e) => setError((e as Error).message));
  }, [selected, reloadAgents]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); cycleMode(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cycleMode]);

  if (!repo) {
    return <div className="empty-state"><div className="big">🗂</div>{t("Common_NoProjectSelected")}</div>;
  }

  const timeline = selectedTask ? evMap[selectedTask] ?? [] : [];
  const modelInfo = harnesses?.[0]?.detect;

  const replyAnswer = async (requestId: string, answer?: string, optionIndex?: number) => {
    setDecided((d) => ({ ...d, [requestId]: answer ?? `#${(optionIndex ?? 0) + 1}` }));
    try { await call("agent.perm.reply", { requestId, ok: true, answer, optionIndex }); } catch (e) { setError((e as Error).message); }
  };
  const replyPlan = async (requestId: string, ok: boolean, feedback?: string) => {
    setDecided((d) => ({ ...d, [requestId]: ok ? "ok" : "revised" }));
    try { await call("agent.perm.reply", { requestId, ok, answer: feedback }); } catch (e) { setError((e as Error).message); }
  };

  // 互斥壳：同一时刻只放行一次发送/创建（state 异步，必须用同步 ref 拦同一帧内的重复触发）
  const sendInput = async () => {
    if (!selected || !inputText.trim() || sendingRef.current) return;
    sendingRef.current = true;
    try { await sendInputInner(); } finally { sendingRef.current = false; }
  };

  const sendInputInner = async () => {
    if (!selected || !inputText.trim()) return;
    const text = inputText.trim();

    if (text.startsWith("/")) {
      const [cmdRaw, ...rest] = text.split(/\s+/);
      const cmd = cmdRaw;
      const arg = rest.join(" ").trim();
      const builtin = BUILTIN_SLASH.find((c) => c.name === cmd.slice(1));
      try {
        if (builtin) {
          const name = builtin.name;
          if (name === "export") {
            // D6 会话导出：主进程生成 markdown 并弹保存框
            try {
              await call<{ canceled: boolean; path?: string }>("agent.task.export", { taskId: selected.taskId });
            } catch (err) { setError((err as Error).message); }
            setInputText("");
            return;
          }
          if (builtin.template) {
            // 模板命令（review/init）：展开后走 resume/queue（同包命令语义）
            const expanded = builtin.template.replace(/\$\{input\}/g, arg);
            if (BUSY_STATES.has(selected.state)) { await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded }); addQueuedHint(selected.taskId, expanded); }
            else await call("agent.task.resume", { taskId: selected.taskId, prompt: expanded, thinking, mode });
            setInputText("");
            return;
          }
          if (name === "compact") await call("agent.task.compact", { taskId: selected.taskId });
          else if (name === "clear") await call("agent.task.clear", { taskId: selected.taskId });
          else if (name === "cp") { await call("agent.task.checkpoint", { taskId: selected.taskId, summary: arg || "手动检查点（/cp）" }); notifyRepoChanged(); }
          else if (name === "diff") { setTab("diff"); setInputText(""); return; }
          else if (name === "attach") { imageInputRef.current?.click(); setInputText(""); return; }
          else if (name === "plan" || name === "default" || name === "yolo" || name === "approvals") {
            const m = name === "approvals" ? MODE_ORDER[(MODE_ORDER.indexOf(selected.permissionMode ?? "default") + 1) % MODE_ORDER.length] : name;
            await call("agent.task.setMode", { taskId: selected.taskId, mode: m });
            setMode(m as "plan" | "default" | "yolo");
          } else if (name === "stop") await call("agent.task.stop", { taskId: selected.taskId });
          else if (name === "model") {
            const id = arg || (selected.modelRef ?? "");
            await call("agent.task.setModel", { taskId: selected.taskId, model: id });
          } else if (name === "thinking") {
            const v = arg as "off" | "low" | "medium" | "high";
            if (["off", "low", "medium", "high"].includes(v)) {
              // 仅记录本地配置，不打断/唤醒 agent；下次发送消息时随 resume 生效
              setThinking(v);
            } else setError("/thinking 用法：/thinking off|low|medium|high");
          } else if (name === "fork") {
            const forked = await call<AgentTaskDTO>("agent.task.fork", { taskId: selected.taskId, model: arg || undefined });
            setSelectedTask(forked.taskId);
            await reloadAgents();
          } else if (name === "skill") {
            const skills = await call<{ id: string; name: string; description: string; instructions: string }[]>("skills.list");
            const target = arg ? skills.find((s) => s.id.endsWith(`.${arg}`) || s.name === arg || s.id === arg) : undefined;
            if (!arg) setError(`可用技能：${skills.map((s) => s.name).join("、") || "（无）"}——用法 /skill <名称>`);
            else if (!target) setError(`未找到技能 ${arg}`);
            else if (BUSY_STATES.has(selected.state)) setError("agent 运行中，请在轮次结束后注入技能");
            else await call("agent.task.resume", { taskId: selected.taskId, prompt: `<system-reminder>\n请应用以下技能指引继续工作：\n\n${target.instructions}\n</system-reminder>`, thinking, mode });
          }
        } else {
          const pc = pkgCommands.find((c) => c.name === cmd.slice(1));
          if (pc) {
            const expanded = pc.template.replace(/\$\{input\}/g, arg);
            if (BUSY_STATES.has(selected.state)) { await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded }); addQueuedHint(selected.taskId, expanded); }
            else await call("agent.task.resume", { taskId: selected.taskId, prompt: expanded, thinking, mode });
          } else {
            const pkgHint = pkgCommands.length > 0 ? `；包命令：${pkgCommands.map((c) => "/" + c.name).join(" ")}` : "";
            setError(`未知命令 ${cmd}（内置：${BUILTIN_SLASH.map((c) => "/" + c.name).join(" ")}${pkgHint}）`);
          }
        }
      } catch (e) { setError((e as Error).message); }
      setInputText("");
      return;
    }

    const busy = BUSY_STATES.has(selected.state);
    // 运行中发送策略（设置 → Agent 运行时）：queue=排队 / interrupt=插话（中断当前轮立即注入）/ block=禁止
    if (busy && busySend === "block") {
      setError("agent 正在运行，发送已被禁止——可在 设置 → Agent 运行时 →「运行中发送」改为排队/插话，或先停止本轮");
      return;
    }
    if (pendingImages.length > 0 && !visionOk) {
      setConfigError("当前模型档案未声明视觉（vision）能力，无法发送图片——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models");
      return;
    }
    inputHistory.current = [text, ...inputHistory.current.filter((x) => x !== text)].slice(0, 20);
    historyIdx.current = -1;
    setEvMap((m) => ({ ...m, [selected.taskId]: pushCap(m[selected.taskId] ?? [], { kind: "human", text }) }));
    setInputText("");
    setSending(true);
    const attachments = attachmentsPayload;
    setPendingImages([]);
    try {
      if (busy) {
        // 排队轮不支持多模态注入：busy 时图片随文本提示走下轮（主进程忽略排队附件）
        if (attachments.length > 0) setError("任务运行中：图片将不随排队消息注入，请等本轮结束再发送");
        await call("agent.task.queue", { taskId: selected.taskId, prompt: text, ...(busySend === "interrupt" ? { interrupt: true } : {}) });
        // 乐观提示（非插话）：输入已排队、尚未注入，用户需看到自己发了什么
        if (busySend !== "interrupt") addQueuedHint(selected.taskId, text);
      } else {
        try {
          await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking, mode, ...(attachments.length > 0 ? { attachments } : {}) });
        } catch (e) {
          // 「等你回答/待确认计划」时轮次仍挂起，resume 会被拒 → 降级为排队投递，轮次结束后自动注入
          const msg = (e as Error).message ?? "";
          if (!/排队/.test(msg)) throw e;
          setError("agent 正在等待你对上方卡片的回答：输入已排队，回合结束后自动注入");
          await call("agent.task.queue", { taskId: selected.taskId, prompt: text });
          addQueuedHint(selected.taskId, text);
        }
      }
      await reloadAgents();
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const createFromCompose = async () => {
    if (!composeText.trim() || sendingRef.current) return;
    sendingRef.current = true;
    // 新任务页的斜杠命令：/attach 是纯 UI 动作可直接执行；其余命令需要具体任务上下文
    if (composeText.trim().startsWith("/")) {
      const cmd = composeText.trim().split(/\s+/)[0].slice(1);
      if (cmd === "attach") { imageInputRef.current?.click(); setComposeText(""); sendingRef.current = false; return; }
      setError(`命令 /${cmd} 需在具体任务的对话中使用（新任务页仅支持 /attach）`);
      sendingRef.current = false;
      return;
    }
    setSending(true);
    try {
      if (pendingImages.length > 0) {
        const chosenRef = modelId || modelProfiles.find((m) => m.isDefault)?.id;
        if (!resolveRefVision(chosenRef)) {
          setConfigError("所选模型档案未声明视觉（vision）能力，无法带图创建任务——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models");
          return;
        }
      }
      const record = await call<AgentTaskDTO>("agent.task.create", {
        prompt: composeText.trim(), taskType: taskTypeId || undefined, model: modelId || undefined,
        thinking, mode,
        ...(pendingImages.length > 0 ? { attachments: attachmentsPayload } : {}),
      });
      setComposeText("");
      setPendingImages([]);
      setSelectedTask(record.taskId);
      setEvMap((m) => ({ ...m, [record.taskId]: [{ kind: "human", text: composeText.trim() }] }));
      await reloadAgents();
    } catch (e) { setError((e as Error).message); } finally { sendingRef.current = false; setSending(false); }
  };

  const stopTask = async (taskId: string) => {
    try { await call("agent.task.stop", { taskId }); await reloadAgents(); } catch (e) { setError((e as Error).message); }
  };

  // 任务卡右侧操作（v3.3）：分叉 / 归档·恢复 / 删除（带清理勾选）；双击标题 = 行内重命名
  const forkTask = async (taskId: string) => {
    try {
      const forked = await call<AgentTaskDTO>("agent.task.fork", { taskId });
      await reloadAgents();
      setSelectedTask(forked.taskId);
      setTab("chat");
    } catch (e) { setError((e as Error).message); }
  };
  const archiveTask = async (taskId: string, archived: boolean) => {
    try {
      await call("agent.task.archive", { taskId, archived });
      if (archived && selectedTask === taskId) setSelectedTask(null);
      await reloadAgents();
    } catch (e) { setError((e as Error).message); }
  };
  const renameTask = async (taskId: string, title: string) => {
    try { await call("agent.task.rename", { taskId, title }); await reloadAgents(); }
    catch (e) { setError((e as Error).message); }
  };
  const deleteTaskRow = async (taskId: string, cleanup: boolean) => {
    try {
      const r = await call<{ ok: boolean; cleanup?: { worktreeRemoved: boolean; branchDeleted: boolean } }>("agent.task.delete", { taskId, cleanup });
      setDelPopId(null);
      if (selectedTask === taskId) setSelectedTask(null);
      await reloadAgents();
      if (cleanup && r.cleanup && !r.cleanup.worktreeRemoved) {
        setError("记录已删除；worktree/分支清理失败（可能被占用），可到 Worktree 页手动移除");
      }
    } catch (e) { setError((e as Error).message); }
  };

  const setTaskMode = async (taskId: string, m: string) => {
    try { await call("agent.task.setMode", { taskId, mode: m }); await reloadAgents(); } catch (e) { setError((e as Error).message); }
  };

  // @ / 插件前缀提及（§20.3.7 composerProviders：前缀不竞争并存；内置 @文件 为 builtin 层自举）
  const onComposeChange = (value: string, setter: (v: string) => void) => {
    setter(value);
    const el = document.activeElement as HTMLTextAreaElement | null;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    // 斜杠命令：检测 / 前缀，过滤匹配的命令
    const slashM = /(^|\s)\/([\w-]*)$/.exec(before);
    if (slashM) {
      setSlashQuery(slashM[2]);
      setSlashSel(0);
      setMention(null);
      return;
    }
    setSlashQuery(null);
    // 长前缀优先匹配（@ 与 @issue 并存时 @issue 先试）
    const providers = [...composerProviders()].sort((a, b) => b.prefix.length - a.prefix.length);
    if (providers.length === 0) { setMention(null); return; }
    const esc = providers.map((x) => x.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const m = new RegExp(`(^|\\s)(${esc})([\\w./\\-]*)$`).exec(before);
    if (!m) { setMention(null); return; }
    const prefix = m[2];
    const query = m[3];
    setMention({ start: caret - query.length, prefix, query });
    setMentionSel(0);
    const provider = providers.find((x) => x.prefix === prefix);
    if (!provider) { setMentionItems([]); return; }
    void Promise.resolve(provider.source(query).catch(() => []))
      .then((items) => {
        // D7 @任务：本仓库其他任务混入补全（insert 短 id，宿主 resume/queue 解析展开）
        if (prefix !== "@") { setMentionItems(items.slice(0, 50)); return; }
        const q = query.toLowerCase();
        const taskItems = (agentTasks ?? [])
          .filter((t) => t.taskId !== selected?.taskId)
          .filter((t) => !q || t.title.toLowerCase().includes(q) || t.taskId.startsWith(query))
          .slice(0, 6)
          .map((t) => ({ label: `任务：${t.title}`, insert: t.taskId.slice(0, 8) }));
        setMentionItems([...taskItems, ...items].slice(0, 50));
      });
  };
  const insertMention = (insert: string, setter: (v: string) => void, current: string) => {
    if (!mention) return;
    const next = current.slice(0, mention.start) + insert + " " + current.slice(mention.start + mention.query.length);
    setter(next);
    setMention(null);
  };

  // 斜杠命令插入：替换光标前的 /query 片段并收起弹出层
  const pickSlash = (insert: string, setText: (v: string) => void, current: string) => {
    const el = document.activeElement as HTMLTextAreaElement | null;
    const caret = el?.selectionStart ?? current.length;
    const before = current.slice(0, caret);
    const m = /(^|\s)\/[\w-]*$/.exec(before);
    setText(m ? current.slice(0, caret - m[0].length + m[1].length) + (insert || "") + " " : current);
    setSlashQuery(null);
  };
  // 弹出层（斜杠命令 / @提及）打开时接管方向键与 Enter：上下选择、Enter 确认、Esc 关闭，不移动输入框光标
  const navKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, text: string, setText: (v: string) => void): boolean => {
    const matches = slashQuery !== null
      ? slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8)
      : [];
    if (matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashSel((s) => (s + 1) % matches.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashSel((s) => (s - 1 + matches.length) % matches.length); return true; }
      if (e.key === "Enter") { e.preventDefault(); pickSlash(matches[Math.min(slashSel, matches.length - 1)].insert, setText, text); return true; }
      if (e.key === "Escape") { e.stopPropagation(); setSlashQuery(null); return true; }
    } else if (mention && mentionItems.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionSel((s) => (s + 1) % mentionItems.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionSel((s) => (s - 1 + mentionItems.length) % mentionItems.length); return true; }
      if (e.key === "Enter") { e.preventDefault(); insertMention(mentionItems[Math.min(mentionSel, mentionItems.length - 1)].insert, setText, text); return true; }
      if (e.key === "Escape") { e.stopPropagation(); setMention(null); return true; }
    }
    return false;
  };

  // 聊天/新任务 composer 共用键盘处理：Enter 发送，Shift+Enter 换行，Shift+Tab 切模式。
  // IME 组合中的按键（选词/上屏，isComposing / keyCode 229）一律忽略——中文输入按 Enter
  // 上屏会误触发送，连续上屏就是「创建任务多出同样会话」的常见来源。
  const chatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (navKeyDown(e, inputText, setInputText)) return;
    if (e.key === "Enter" && !e.repeat && !e.shiftKey) { e.preventDefault(); void sendInput(); return; }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]); return; }
  };
  const composeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (navKeyDown(e, composeText, setComposeText)) return;
    if (e.key === "Enter" && !e.repeat && !e.shiftKey) { e.preventDefault(); void createFromCompose(); return; }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]); return; }
  };

  // 可选模型两级化：一级供应商（用户分组/包档案），二级组内具体模型（与设置页 models.list 同源）
  const fmtCtx = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  const modelGroups: ModelGroupVM[] = (modelProfiles ?? []).filter((m) => m.configured).map((m) => ({
    id: m.id,
    name: m.name,
    hint: m.isDefault ? "默认" : m.source === "package" ? "包" : undefined,
    members: (m.groupModels && m.groupModels.length > 1)
      ? m.groupModels.map((g, i) => ({
          // 首成员复用分组 id（与后端约定一致），其余 `<分组id>#<模型id>`
          id: i === 0 ? m.id : `${m.groupId}#${g.modelId}`,
          name: g.modelId,
          sub: [g.vision ? "视觉" : null, g.contextTokens ? `${fmtCtx(g.contextTokens)} ctx` : null].filter(Boolean).join(" · ") || undefined,
        }))
      : [{ id: m.id, name: m.modelId }],
  }));

  // 斜杠命令：内置 / 唤起 + 已安装包注册的命令
  // 补全列表与分发表同一数据源（§20.3.8）：BUILTIN_SLASH + 包命令，避免两表漂移
  const slashItems = (() => {
    const list: { name: string; hint: string; insert: string }[] = BUILTIN_SLASH.map((c) => ({ name: `/${c.name}`, hint: c.hint, insert: `/${c.name}` }));
    for (const c of pkgCommands) list.push({ name: `/${c.name}`, hint: c.packageId, insert: `/${c.name}` });
    return list;
  })();

  // 时间线块渲染（§20.3.7）：裁决面交互卡（授权/提问/计划）硬接线不开放替换；
  // 其余展示块经 agentUIRegistry 解析——用户包 > 内置包 > 宿主缺省，工具精确 > 前缀 > blockKind。
  // 复制钮只挂 agent 本轮结论（copyBlocks）：向前扫描——后面还有工具/子代理/思考/计划
  // 或另一段正文 = 过程片段；遇到轮结束标记（turn/checkpoint/下一条用户消息）或时间线末尾
  // （本轮仍在流式输出）= 结论。子代理子块一律视为过程。
  const copyBlocks = (() => {
    const out = new Set<Block>();
    for (let i = 0; i < timeline.length; i++) {
      const b = timeline[i];
      if (b.kind !== "assistant") continue;
      let conclusion = true;
      for (let j = i + 1; j < timeline.length; j++) {
        const k = timeline[j].kind;
        if (k === "assistant" || k === "tool" || k === "subtask" || k === "thinking" || k === "plan") { conclusion = false; break; }
        if (k === "turn" || k === "checkpoint" || k === "human") break;
      }
      if (conclusion) out.add(b);
    }
    return out;
  })();
  const renderBlock = (b: Block, key: string | number, process = false): ReactNode => {
    // 任务非 live（stopped/completed/interrupted/failed）时，把仍在 running 的工具卡归约为 aborted——
    // journal 不会补发 tool/end，前端渲染层做兜底，避免"停止的任务还在计时"（design v2 §3.1）
    const live = selected ? LIVE_STATES.has(selected.state) : true;
    const block: Block = !live && b.kind === "tool" && b.state === "running"
      ? { ...b, state: "aborted" as const, durationMs: b.durationMs ?? (Date.now() - b.startTs) }
      : b;
    switch (block.kind) {
      case "permission":
        // v4.5/v4.7：授权改由 composer 上方浮层承载，历史不留在流里
        return null;
      case "question":
        return <QuestionCard key={key} b={block} decided={decided[block.requestId]} onAnswer={replyAnswer} />;
      case "plan":
        return <PlanCard key={key} b={block} decided={decided[block.requestId]} onPlan={replyPlan} />;
      case "todo":
        // todo 清单以右上角悬浮态展示，不占用时间线版面
        return null;
      default:
        break;
    }
    const renderer = resolveTimelineRenderer(block.kind === "tool" ? block.name : undefined, block.kind);
    if (!renderer) return null;
    const ctx: TimelineCardCtx = {
      taskId: selectedTask ?? "",
      viewFile: (path) => { setPendingFile(path); setPanelReq({ path, mode: "diff", ts: Date.now() }); setTab("chat"); animatePanel(true); },
      previewFile,
      openShell: (shellId) => {
        setShellFocus({ shellId, ts: Date.now() });
        setTab("shells");
      },
      openSubagent: (subtaskId) => {
        setSubagentFocus({ subtaskId, ts: Date.now() });
        setTab("subagents");
      },
      contextPct: stats ? `${Math.round(stats.ratio * 100)}%` : undefined,
      showCopy: !process && copyBlocks.has(block),
      verbose: verboseTimeline,
      renderChildren: (children) => <Fragment>{(children as Block[]).map((c, i) => renderBlock(c, `${key}-${i}`, true))}</Fragment>,
    };
    return <Fragment key={key}>{renderer.render({ block, taskId: ctx.taskId ?? "", ctx })}</Fragment>;
  };
  // 过程块列表渲染（含连续日志折叠组、连续文件合并组）；轮折叠展开与进行中轮共用
  const renderProcess = (prefix: string, list: Block[]): ReactNode => {
    type Entry = { k: "one"; b: Block } | { k: "logs"; items: Extract<Block, { kind: "log" }>[] } | { k: "files"; items: Extract<Block, { kind: "file" }>[] };
    const entries: Entry[] = [];
    let fileRun: Extract<Block, { kind: "file" }>[] = [];
    const flushFiles = () => {
      if (fileRun.length === 0) return;
      if (fileRun.length > 1) entries.push({ k: "files", items: fileRun });
      else entries.push({ k: "one", b: fileRun[0] });
      fileRun = [];
    };
    // 已被 编辑文件/写文件 动作行覆盖的同路径 file 变更不再重复展示（v4.7）
    const editedPaths = new Set<string>();
    for (const b of list) {
      if (b.kind === "tool" && (b.name === "file_patch" || b.name === "file_write")) {
        try { const a = b.args as Record<string, unknown> | undefined; if (typeof a?.path === "string") editedPaths.add(a.path); } catch { /* ignore */ }
      }
    }
    // 空文本块（流式分片残留）先过滤：否则会随机切断密排组，造成间距忽大忽小（v4.7）
    const list2 = list.filter((b) => !(b.kind === "assistant" && !b.text.trim()));
    for (const b of list2) {
      if (b.kind === "file" && b.changeKind !== "read-image") {
        if (editedPaths.has(b.path)) continue;
        fileRun.push(b);
        continue;
      }
      flushFiles();
      entries.push({ k: "one", b });
    }
    flushFiles();
    const fgCtx = { taskId: selectedTask ?? "", viewFile: (path: string) => { setPendingFile(path); setPanelReq({ path, mode: "diff", ts: Date.now() }); setTab("chat"); animatePanel(true); }, previewFile };
    // 连续指令块（tool/thinking/checkpoint）并入密排运行组：块间 2px，与事件间 6px 区分
    const TIGHT = new Set(["tool", "thinking", "checkpoint"]);
    const groups: ({ k: "run"; items: Block[] } | Entry)[] = [];
    let runBuf: Block[] | null = null;
    const flushRun = () => { if (runBuf && runBuf.length) groups.push({ k: "run", items: runBuf }); runBuf = null; };
    for (const en of entries) {
      if (en.k === "one" && TIGHT.has(en.b.kind)) { (runBuf ??= []).push(en.b); continue; }
      flushRun();
      groups.push(en);
    }
    flushRun();
    return groups.map((en, li) => {
      const key = `${prefix}${li}`;
      if (en.k === "run") {
        return <div key={key} className="v47-run">{en.items.map((b, j) => renderBlock(b, `${key}-${j}`, true))}</div>;
      }
      if (en.k === "files") return <FileGroup key={key} items={en.items} ctx={fgCtx} />;
      if (en.k === "logs") {
        return (
          <details key={key} style={{ fontSize: 11 }}>
            <summary style={{ cursor: "pointer", color: "var(--c-text3)" }}>▸ 显示 {en.items.length} 条日志</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {en.items.map((b, j) => renderBlock(b, `${key}-${j}`))}
            </div>
          </details>
        );
      }
      return renderBlock(en.b, key);
    });
  };

  // 任务列表行（v3 设计稿 + v3.3 增强）：状态点 + 标题；悬停行尾 分叉/归档·恢复/删除；
  // 双击标题行内重命名；归档行半透明 + 恢复入口；已合并任务带「已合并」标
  const agentCard = (task: AgentTaskDTO) => {
    const live = LIVE_STATES.has(task.state);
    const selectedNow = selectedTask === task.taskId;
    const chip = stateChip(task.state, task.awaitKind);
    const dotColor = task.state === "failed" ? "var(--c-red)"
      : task.state === "interrupted" ? "var(--c-amber)"
      : task.state === "awaiting-input" ? (task.awaitKind === "question" ? "var(--c-amber)" : task.awaitKind === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-text3)")
      : task.state === "stopped" || task.state === "completed" ? "var(--c-text3)"
      : task.permissionMode === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-green)";
    const working = task.state === "working" || task.state === "starting";
    const pickable = selecting && !task.archived;
    return (
      <div key={task.taskId} className={"tk-row" + (selectedNow ? " sel" : "") + (task.archived ? " arch" : "") + (picked.has(task.taskId) ? " picked" : "")}
        onClick={() => {
          if (pickable) { togglePick(task.taskId); return; }
          if (selecting) return; // 已归档行在选择态不可勾也不可选
          setSelectedTask(selectedNow ? null : task.taskId); setTab("chat"); setThinking(task.thinking ?? "medium"); setMode(task.permissionMode ?? "default");
        }}
        title={`${task.title}\n${chip.label} · ${task.branch}${task.wrapup ? ` · 已合并 ${task.wrapup.mergeSha.slice(0, 8)}` : ""}${task.archived ? " · 已归档" : ""}`}>
        {pickable && (
          <span className="tk-selbox" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={picked.has(task.taskId)} onChange={() => togglePick(task.taskId)} />
          </span>
        )}
        <span className={"tk-dot" + (working ? " run" : "")} style={{ color: dotColor }} />
        {renamingId === task.taskId ? (
          <input key={`ren-${task.taskId}`} className="tk-ren" autoFocus defaultValue={task.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); setRenamingId(null); if (v && v !== task.title) void renameTask(task.taskId, v); }
              else if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={(e) => { const v = e.target.value.trim(); setRenamingId(null); if (v && v !== task.title) void renameTask(task.taskId, v); }}
          />
        ) : (
          <span className="tk-row-title" title={selecting ? undefined : "双击重命名"}
            onDoubleClick={selecting ? undefined : (e) => { e.stopPropagation(); setRenamingId(task.taskId); }}>{task.title}</span>
        )}
        {task.wrapup ? <span className="tk-mtag">已合并</span> : null}
        {!selecting && (
        <span className="tk-quick">
          {task.archived ? (
            <button className="icon-btn" title="恢复到列表（取消归档）"
              onClick={(e) => { e.stopPropagation(); void archiveTask(task.taskId, false); }}>
              <TlIcon name="up" size={13} />
            </button>
          ) : (
            <button className="icon-btn" title={live ? "运行中不可分叉，请先停止" : "分叉任务（复制对话历史到新分支）"} disabled={live}
              onClick={(e) => { e.stopPropagation(); void forkTask(task.taskId); }}>
              <TlIcon name="fork" size={13} />
            </button>
          )}
          {!task.archived && (
            <button className="icon-btn" title={live ? "运行中不可归档，请先停止" : "归档任务（从列表隐藏，可恢复）"} disabled={live}
              onClick={(e) => { e.stopPropagation(); void archiveTask(task.taskId, true); }}>
              <TlIcon name="archive" size={13} />
            </button>
          )}
          <button className="icon-btn" title="删除任务（会话记录与 journal；可选清理 worktree/分支）"
            onClick={(e) => { e.stopPropagation(); setDelPopId(delPopId === task.taskId ? null : task.taskId); }}>
            <TlIcon name="trash" size={13} />
          </button>
        </span>
        )}
        {delPopId === task.taskId && (
          <div className="tk-delpop" onClick={(e) => e.stopPropagation()}>
            <div className="t">删除任务？</div>
            <div className="d">会话记录、journal 与附件将一并删除，不可恢复。</div>
            <label><input type="checkbox" id={`delclean-${task.taskId}`} defaultChecked />同时清理 worktree 与 task/* 分支</label>
            <div className="b">
              <button className="tool-btn" onClick={() => setDelPopId(null)}>取消</button>
              <button className="tool-btn" style={{ color: "var(--c-red)", borderColor: "color-mix(in srgb, var(--c-red) 38%, transparent)" }}
                onClick={() => { const el = document.getElementById(`delclean-${task.taskId}`) as HTMLInputElement | null; void deleteTaskRow(task.taskId, el?.checked ?? true); }}>删除</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const busy = selected ? BUSY_STATES.has(selected.state) : false;
  // 收尾条（v3.3 工作流 B）：任务空闲且有产出时出现在 pagehead 下沿；worktree 任务=合并入口，主 worktree 任务=提交引导
  const idle = selected ? !LIVE_STATES.has(selected.state) : false;
  const isWorktreeTask = !!selected?.branch?.startsWith("task/");
  const showWrapbar = !!selected && idle && isWorktreeTask && (diffCount > 0 || !!selected.wrapup);
  const showCommitHint = !!selected && idle && !isWorktreeTask && diffCount > 0;
  // 底部执行提示（DeepSeek 式流光）：优先展示正在跑的工具（秒数随 forceTick 每秒刷新），
  // 其次启动/子代理/通用思考文案；等待授权时已有琥珀提示行，不重复显示
  const busyHint = (() => {
    if (runningTool) {
      const label = TOOL_LABELS[runningTool.name] ?? runningTool.name;
      return `${label}… ${((Date.now() - runningTool.startTs) / 1000).toFixed(1)}s`;
    }
    if (selected?.state === "starting") return "正在启动…";
    if (runningSubs > 0) return `子代理执行中 ${runningSubs}/${maxSubagents}…`;
    return "正在思考与执行…";
  })();
  // 失败/中断原因条（输入框上方常驻，原因来自后端 lastMessage / completed 事件摘要）
/** 中断/失败结果折叠行（v4.7）：默认只显示一行摘要（如「会话已中断 · 发送消息可继续」），点击展开原因。 */
function OutcomeFold(props: { icon: "dot"; color: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="v47-outcome">
      <div className="v47-oline" onClick={() => setOpen((v) => !v)} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}>
        <TlIcon name={props.icon} size={13} color={props.color} style={{ flex: "none" }} />
        <span style={{ flex: "none" }}>{props.summary}</span>
        <span style={{ flex: 1 }} />
        <TlIcon name="chevron-right" size={10} className={"tl-chev" + (open ? " open" : "")} />
      </div>
      {open && <div className="v47-obody">{props.children}</div>}
    </div>
  );
}

  const failBar = (() => {
    if (!selected) return null;
    if (selected.state === "failed") {
      return { kind: "failed" as const, color: "var(--c-red)", icon: "dot" as const,
        summary: "任务失败 · 点击查看原因", reason: selected.lastMessage ?? "原因未知（可查看时间线错误日志）" };
    }
    if (selected.state === "interrupted") {
      return { kind: "interrupted" as const, color: "var(--c-amber)", icon: "dot" as const,
        summary: "会话已中断 · 发送消息可继续", reason: selected.lastMessage ?? "" };
    }
    if (selected.state === "stopped") {
      return { kind: "stopped" as const, color: "var(--c-text3)", icon: "dot" as const,
        summary: "已手动停止本轮", reason: "" };
    }
    return null;
  })();
  // D1 vision 门控：当前生效档案（任务绑定 → 默认★）按实际选中成员判定
  const activeProfile = resolveRefProfile(selected?.modelRef) ?? modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
  const visionOk = resolveRefVision(selected?.modelRef ?? activeProfile?.id);
  const attachmentsPayload = pendingImages.map((img) => ({ name: img.name, dataBase64: img.dataUrl }));

  return (
    <div className="tk-root" style={{ display: "grid", gridTemplateColumns: `${Math.max(TASK_LIST_MIN_W, Math.min(TASK_LIST_MAX_W, listWidth))}px 6px minmax(0, 1fr)`, flex: 1, minHeight: 0, height: "100%" }}>
      {/* 图片附加：粘贴/拖拽之外提供点击入口（视觉能力门控在选择时校验） */}
      <input ref={imageInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length === 0) return;
          if (!visionOk) { setConfigError("当前模型档案未声明视觉（vision）能力，无法附加图片——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models"); return; }
          filesToImages(files);
        }}
      />
      {/* 错误提示以浮层显示在对话页顶部状态条下方（见时间线容器内）：
          grid 根元素的直接子元素会抢占 300px 侧栏列把排版挤乱，侧栏内联则常驻占一行 */}

      {/* ═══ 左：会话列表（任务卡）═══ */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <button className="new-task-btn" style={{ margin: "10px 10px 6px", width: "calc(100% - 20px)" }} onClick={startNewTask}>
          ＋ 新任务（描述目标，Ctrl+N）
        </button>
        {/* 搜索（纯前端：标题/摘要/id） */}
        <div className={"tk-search" + (listQuery ? " has" : "")}>
          <TlIcon name="search" size={12} />
          <input value={listQuery} placeholder="搜索标题 / 摘要 / id" onChange={(e) => setListQuery(e.target.value)} />
          <button className="tk-search-clr" title="清空" onClick={() => setListQuery("")}>✕</button>
        </div>
        {/* v3.4 工具条：右对齐三图标钮 = 排序 / 状态筛选 / 批量归档；选择态换操作条 */}
        {selecting ? (
          <div className="tk-selbar">
            已选 <span className="n">{picked.size}</span> 项
            <span className="sp" />
            <button className="tool-btn" onClick={pickAllVisible}>全选</button>
            <button className="tool-btn" disabled={picked.size === 0}
              style={picked.size > 0 ? { background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 } : undefined}
              onClick={() => void archivePicked()}>归档</button>
            <button className="tool-btn" onClick={exitSelect}>取消</button>
          </div>
        ) : (
          <div className="tk-tbar">
            <span className="tk-tpop-anchor">
              <button className={"tk-tbtn" + (listPop === "sort" ? " on" : "")} title="排序"
                onClick={() => setListPop(listPop === "sort" ? null : "sort")}>
                <TlIcon name="sort" size={14} />
              </button>
              {listPop === "sort" && (
                <div className="tk-pop on">
                  <div className="ph">排序</div>
                  {([["active", "最近活动", "默认"], ["created", "创建时间", null], ["title", "标题 A→Z", null]] as const).map(([id, label, tag]) => (
                    <div key={id} className={"pi" + (listSort === id ? " on" : "")}
                      onClick={() => { setListSort(id); localStorage.setItem("gitter.taskListSort", id); setListPop(null); }}>
                      <span className="ck">✓</span>{label}{tag ? <span className="n">{tag}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </span>
            <span className="tk-tpop-anchor">
              <button className={"tk-tbtn" + (listPop === "filter" ? " on" : "")} title="按状态筛选"
                onClick={() => setListPop(listPop === "filter" ? null : "filter")}>
                <TlIcon name="filter" size={14} />
              </button>
              {listPop === "filter" && (
                <div className="tk-pop on">
                  <div className="ph">按状态筛选</div>
                  {([["all", "全部", ""], ["run", "进行中", "var(--c-green)"], ["ask", "待处理", "var(--c-amber)"], ["done", "已完成", ""], ["err", "失败·中断", ""]] as const).map(([id, label, dot]) => (
                    <div key={id} className={"pi" + (listFilter === id ? " on" : "")}
                      onClick={() => { setListFilter(id); localStorage.setItem("gitter.taskListFilter", id); setListPop(null); }}>
                      <span className="ck">✓</span>
                      {dot ? <span className="dot" style={{ background: dot }} /> : null}
                      {label}<span className="n">{listCounts[id]}</span>
                    </div>
                  ))}
                </div>
              )}
            </span>
            <button className="tk-tbtn" title="批量归档（勾选多条任务）" onClick={enterSelect}>
              <TlIcon name="archive" size={14} />
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
          {groupedTasks.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--c-text3)", padding: "6px 2px" }}>
              {(listQ || listFilter !== "all") ? "无匹配任务" : t("Agents_EmptyHint")}
            </div>
          )}
          {groupedTasks.map((g) => (
            <Fragment key={g.id}>
              <div className="tk-ghead">{g.label}</div>
              {g.tasks.map(agentCard)}
            </Fragment>
          ))}
        </div>
        <button className="tk-arch-toggle" onClick={() => { const n = !archOpen; setArchOpen(n); localStorage.setItem("gitter.taskArchOpen", n ? "1" : "0"); }}>
          {archOpen ? "▾" : "▸"} {archOpen ? "已归档" : "显示已归档"} ({listCounts.arch})
        </button>
      </div>
      {/* 任务列表|对话 分割线：拖拽调宽（localStorage 持久化） */}
      <div className="tk-vdiv" title="拖拽调整任务列表宽度" onPointerDown={startListDrag}><span className="tk-vdiv-grip" /></div>

      {/* ═══ 右：详情（页签 = 全局导航；三页互斥独立）═══ */}
      {/* v3.2 设计稿 detail 级 grid：页签行只跨对话列，变更面板 + 分割线从页签行 band 起全高、
          三页签常驻（切换改动/检查点不卸面板）；minWidth: 0 = grid item 自动最小尺寸回收，
          对话内容的 min-content 宽度不再把 1fr 轨道撑破窗口 */}
      <div ref={detailRef} className="tk-detail" style={{ display: "grid", position: "relative", flex: 1, minHeight: 0, minWidth: 0, gridTemplateRows: "auto minmax(0, 1fr)", gridTemplateColumns: selected && changesPanelOpen && !panelClosing ? panelTemplate(splitRatio) : "minmax(0, 1fr)" }}>
        <div className="tk-tabs" style={{ gridColumn: "1", gridRow: "1" }}>
          {([["chat", "对话", 0], ["diff", "改动", diffCount], ["cp", "检查点", cpCount], ["subagents", "子代理", runningSubs], ["shells", "后台", shellRunning]] as const).map(([id, label, n]) => (
            <div key={id} className={"tk-tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
              {label}{n > 0 ? <span className="tk-tab-n">{n}</span> : null}
            </div>
          ))}
          <span style={{ flex: 1 }} />
          <button className={"tool-btn icon" + (verboseTimeline ? " on" : "")} title="详细模式（Ctrl+O）：结果/思考默认全展开" aria-label="详细模式"
            style={verboseTimeline ? { background: "var(--c-selected)", color: "var(--c-text)" } : undefined}
            onClick={() => setVerboseTimeline((v) => !v)}>
            <TlIcon name="list" size={13} />
          </button>
          {showCommitHint && (
          <span className="comp-anchor">
            <button className={"tool-btn icon" + (branchHintOpen ? " on" : "")} title="分支模式与提交提示" aria-label="分支模式与提交提示"
              onClick={(e) => { e.stopPropagation(); setBranchHintOpen((v) => !v); }}>
              <TlIcon name="branch" size={13} />
            </button>
            <div className={"hint-pop" + (branchHintOpen ? " on" : "")} onClick={(e) => e.stopPropagation()}>
              <div className="hint-pop-row">
                <TlIcon name="branch" size={13} color="var(--c-text3)" style={{ flex: "none", marginTop: 3 }} />
                <span>当前分支模式：<b>改动已直接在工作区</b>（{diffCount} 个文件），无独立分支可合并</span>
              </div>
              <div className="hint-pop-row">
                <button className="tool-btn" onClick={() => { pageSdk.navigate("changes"); setBranchHintOpen(false); }}>去变更页提交</button>
              </div>
            </div>
          </span>
          )}
        </div>

        {/* 页内容区（c1 r2）：对话 / 新任务空态 / 改动 / 检查点 */}
        <div style={{ gridColumn: "1", gridRow: "2", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {/* ═══ 对话页（保持挂载：切改动/检查点不重新加载历史、不丢滚动位置） ═══ */}
        {selected && (
          <div style={{ flex: 1, minHeight: 0, display: tab === "chat" ? "grid" : "none", flexDirection: "column", gridTemplateRows: "auto auto auto minmax(0, 1fr)", overflow: "hidden" }}>
            <div className="tk-pagehead" style={{ gridColumn: "1", gridRow: "1" }}>
              <span className="tk-pill" style={{ color: stateChip(selected.state, selected.awaitKind).color, borderColor: `color-mix(in srgb, ${stateChip(selected.state, selected.awaitKind).color} 32%, transparent)`, background: `color-mix(in srgb, ${stateChip(selected.state, selected.awaitKind).color} 9%, transparent)` }}>
                <span className="tk-pill-dot" />
                {stateChip(selected.state, selected.awaitKind).label}{busy && selected.lastActiveAt ? " · " + Math.max(0, Math.round((Date.now() - new Date(selected.lastActiveAt).getTime()) / 1000)) + "s" : ""}
              </span>
              <span className="tk-monochip">{selected.branch}</span>
              {runningTool ? (
                <span className="tk-pill amber">
                  <span className="tk-pill-dot" style={{ animation: "tk-pulse 1.2s infinite" }} />
                  {(TOOL_LABELS[runningTool.name] ?? runningTool.name)} {((Date.now() - runningTool.startTs) / 1000).toFixed(1)}s
                </span>
              ) : null}
              {(selected.queued?.length ?? 0) > 0 ? (
                <span className="tk-pill amber"><TlIcon name="clock" size={11} />排队 {selected.queued!.length}</span>
              ) : null}
              <span className="tk-pill dim">子代理 {runningSubs}/{maxSubagents}</span>
              <span style={{ flex: 1 }} />
              {idle && (
                <button className="tool-btn" title="对上一轮改动提交验收意见（受限提示开新轮）" onClick={() => setFeedbackOpen(true)}>验收反馈</button>
              )}
            </div>
            {/* 收尾条（v3.3）：合并入口 / 已合并结果 / 主 worktree 提交引导 */}
            {showWrapbar && !selected.wrapup && (
              <div className="tk-wrapbar" style={{ gridColumn: "1", gridRow: "2" }}>
                <TlIcon name="branch" size={13} color="var(--c-green)" />
                <span className="meta">任务已完成 · {diffCount} 个文件变更 · 可合并回 <b style={{ color: "var(--c-text2)" }}>{selected.baseBranch || "基线分支"}</b></span>
                <span className="sp" />
                <button className="tool-btn" onClick={() => setTab("diff")}>查看改动</button>
                <button className="tool-btn" style={{ background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 }}
                  onClick={() => setWrapupOpen(true)}>
                  <TlIcon name="branch" size={12} />合并到 {selected.baseBranch || "基线分支"}
                </button>
              </div>
            )}
            {showWrapbar && selected.wrapup && (
              <div className="tk-wrapbar" style={{ gridColumn: "1", gridRow: "2" }}>
                <TlIcon name="check-circle" size={13} color="var(--c-green)" />
                <span className="meta" style={{ color: "var(--c-green)" }}>已合并 {(selected.wrapup.mergeSha || "").slice(0, 8) || "?"} · {selected.wrapup.strategy === "merge" ? "merge --no-ff" : "squash"} → {selected.baseBranch || "基线分支"}</span>
                <span className="meta">worktree 与分支已清理 · 任务已归档</span>
                <span className="sp" />
                <button className="tool-btn" onClick={() => pageSdk.navigate("log")}>查看 Log</button>
              </div>
            )}
            {/* 子代理运行条（v4.9 设计稿 §2）：仅 runningSubs>0 时显示，纯文本无框、圆点闪烁、行内可点击跳详情 */}
            {runningSubs > 0 && (
              <div className="tk-subrun" style={{ gridColumn: "1", gridRow: "3" }}>
                <span className="lead"><span className="icon">◐</span>子代理 {runningSubs}/{maxSubagents}</span>
                <span className="sep" />
                {(selectedTask ? (evMap[selectedTask] ?? []) : []).filter(
                  (b): b is Extract<Block, { kind: "subtask" }> => b.kind === "subtask" && b.state === "running"
                ).map((b) => (
                  <span key={b.subtaskId} className="item" onClick={() => { setSubagentFocus({ subtaskId: b.subtaskId, ts: Date.now() }); setTab("subagents"); }}>
                    <span className="dt" />
                    <span className="nm">{b.name || "子代理"}</span>
                    <span className="du">{((Date.now() - subtaskStartAt(b)) / 1000).toFixed(1)}s</span>
                    <span className="arrow">←</span>
                  </span>
                ))}
                {runningSubs < maxSubagents && selected?.queued?.length ? <span className="queue-badge">+{selected.queued.length} 排队</span> : null}
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative", gridColumn: "1", gridRow: "4" }}>
              {/* 错误浮层：悬于时间线之上、顶部状态条正下方；不打断版面流 */}
              {error && <ErrorFloat text={error} maxWidth="calc(100% - 292px)" go={errorGo} onGo={(s) => { openSettings(s); setError(null); }} onClose={() => setError(null)} />}
              <div ref={timelineRef} className="tl-scroll" style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}
                onScroll={onTimelineScroll}
                onDoubleClick={(e) => {
                  const pre = (e.target as HTMLElement).closest("pre");
                  if (pre) void navigator.clipboard?.writeText(pre.textContent ?? "");
                }}>
              <div ref={streamInnerRef} className="tl-conv" style={{ maxWidth: 880, margin: "0 auto", padding: "14px 20px 26px", display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
                {loadingOlder && (
                  <div style={{ textAlign: "center", color: "var(--c-text3)", fontSize: 11 }}>
                    <span className="tl-pulse">加载中…</span>
                  </div>
                )}
                {hasMoreHistory && !loadingOlder && (
                  <div style={{ textAlign: "center", color: "var(--c-text3)", fontSize: 11, opacity: .6 }}>↑ 上滚加载更早</div>
                )}
                {timeline.length === 0 && <div style={{ color: "var(--c-text3)", fontSize: 12 }}>{t("Agents_TimelineEmpty")}</div>}
                {(() => {
                  const groups = groupTurns(timeline);
                  // 轮次切分：与上一条 assistant 之间画分隔线；相邻同类（如连续两条正文）只给小间距
                  const gapOf = (i: number): "conv" | "soft" | "" => {
                    if (i === 0) return "";
                    const a = groups[i - 1];
                    const prev = a.conclusion?.kind ?? (a.active ? (a.process[a.process.length - 1]?.kind ?? "") : a.turn ? "" : "");
                    const cur = groups[i].human ? "human" : (groups[i].active && groups[i].process.length > 0 ? groups[i].process[0].kind : "");
                    if (prev !== "assistant") return cur === "assistant" ? "conv" : "soft";
                    if (cur === "human") return "soft";
                    if (cur === "assistant") return "soft";
                    return "conv";
                  };
                  return groups.map((g, gi) => {
                    const gap = gapOf(gi);
                    const ended = !!g.turn;
                    const expanded = !ended || expandedTurns.has(g.anchor);
                    const tools = g.process.filter((b) => b.kind === "tool").length;
                    const subs = g.process.filter((b) => b.kind === "subtask").length;
                    void ended; void expanded;
                    return (
                      <Fragment key={gi}>
                        {gap === "conv" ? <div className="tl-gap-conv" /> : null}
                        {gap === "soft" ? <div className="tl-gap-soft" /> : null}
                        {g.human ? renderBlock(g.human, `g${gi}-h`) : null}
                        {ended && g.process.length > 0 ? (
                          <>
                            <div className="tl-turn" onClick={() => toggleTurn(g.anchor)} role="button" tabIndex={0} aria-expanded={expanded}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTurn(g.anchor); } }}>
                              <TlIcon name="chevron-right" size={11} className={"tl-chev" + (expanded ? " open" : "")} />
                              <span style={{ fontWeight: 600 }}>执行过程</span>
                              {tools > 0 ? <span>工具 {tools}</span> : null}
                              {subs > 0 ? <span>子代理 {subs}</span> : null}
                              {tools === 0 && subs === 0 ? <span>{g.process.length} 条</span> : null}
                            </div>
                            {expanded && renderProcess(`g${gi}-p`, g.process)}
                          </>
                        ) : (
                          renderProcess(`g${gi}-p`, g.process)
                        )}
                        {g.conclusion ? renderBlock(g.conclusion, `g${gi}-c`) : null}
                        {g.outcome.length > 0 ? (
                          g.outcome.some((b) => b.kind === "status" && b.text.includes("中断")) ? (
                            <OutcomeFold icon="dot" color="var(--c-amber)" summary="会话已中断 · 发送消息可继续">
                              {g.outcome.map((b, oi) => renderBlock(b, `g${gi}-o${oi}`, true))}
                            </OutcomeFold>
                          ) : (
                            g.outcome.map((b, oi) => renderBlock(b, `g${gi}-o${oi}`))
                          )
                        ) : null}
                        {g.turn ? renderBlock(g.turn, `g${gi}-t`) : null}
                        {/* 中断/失败/停止：流末尾折叠行（中断=「发送消息可继续」） */}
                        {gi === groups.length - 1 && failBar && !(timeline.length > 0 && timeline[timeline.length - 1].kind === "status") && (
                          <OutcomeFold icon={failBar.icon} color={failBar.color} summary={failBar.summary}>
                            <span style={{ overflowWrap: "anywhere", userSelect: "text" }}>{failBar.reason || failBar.summary}</span>
                          </OutcomeFold>
                        )}
                      </Fragment>
                    );
                  });
                })()}
                {/* 已排队、尚未注入的本轮补充输入（乐观提示，挂在流末尾；轮末随回合滚动过） */}
                {(queuedHints[selected?.taskId ?? ""] ?? []).length > 0 ? (
                  (queuedHints[selected!.taskId] ?? []).map((q, qi) => (
                    <div key={`queued-${qi}`} className="tl-queued-hint">
                      <TlIcon name="clock" size={11} style={{ flex: "none", marginTop: 3 }} />
                      <span style={{ whiteSpace: "nowrap", fontWeight: 600 }}>排队 · 本轮结束后自动注入</span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: "left", color: "var(--c-text2)", fontSize: 12.5, lineHeight: 1.6, overflowWrap: "anywhere", userSelect: "text" }}>
                        {q.length > 120 ? q.slice(0, 120) + "…" : q}
                      </span>
                    </div>
                  ))
                ) : null}
              </div>
              </div>
              {/* 悬浮任务清单：从时间线提取最新 todo 块，固定右上，实时刷新状态 */}
              {(() => {
                const todoBlock = [...timeline].reverse().find((b) => b.kind === "todo");
                if (!todoBlock) return null;
                return (
                  <div
                    style={{
                      position: "absolute", top: 8, right: 8, width: 260, maxWidth: "calc(100% - 16px)",
                      background: "var(--c-panel2)", border: "1px solid var(--c-border-strong)",
                      borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,.22)", zIndex: 10,
                      overflow: "hidden",
                    }}
                  >
                    <TodoList todos={(todoBlock as Extract<Block, { kind: "todo" }>).todos} />
                  </div>
                );
              })()}
              {awayFromBottom && (
                <button
                  className="tool-btn icon"
                  data-tip="返回底部"
                  aria-label="返回底部"
                  style={{
                    position: "absolute", left: "50%", bottom: 132, transform: "translateX(-50%)",
                    width: 28, height: 28, padding: 0, borderRadius: 999,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--c-panel2)", border: "1px solid var(--c-border-strong)",
                    color: "var(--c-text2)", boxShadow: "0 2px 8px rgba(0,0,0,.22)",
                  }}
                  onClick={() => scrollTimelineToBottom(false)}
                >
                  <TlIcon name="chevron-down" size={14} />
                </button>
              )}
            {/* 输入框悬浮 dock（v4.7）：浮于时间线之上，内容从下方穿过被遮挡 */}
            <div className="chat-dock">
              <div ref={composerDockRef} style={{ maxWidth: 880, margin: "0 auto", position: "relative" }}>
                {/* 授权浮层（v4.5/v4.7）：覆盖 composer，黑白编号选项，↑↓/Enter/数字直选 */}
                {pendingPerm && (
                  <div className="perm-dock">
                    <PermissionCard b={pendingPerm} decided={undefined} sel={permSel[pendingPerm.requestId] ?? 0} showFullAccess={showFullAccess}
                      onSel={(id, i) => setPermSel((m) => ({ ...m, [id]: i }))} onReply={replyPerm} onFullAccess={(id) => void replyFullAccess(id)} />
                    <div className="perm-dock-foot">↑↓ 选择 · Enter 确认 · 数字直选 · 选择结果会回给 agent 继续工作</div>
                  </div>
                )}
                {/* 失败/中断/停止原因条：任务态非正常收尾时常驻展示，直到下一轮开始 */}
                {/* DeepSeek 式执行中提示：脉冲星光 + 流光文字（运行工具名/秒数实时刷新） */}
                {busy && !pendingPerm && (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 2px 7px", fontSize: 12 }}>
                    <TlIcon name="sparkle" size={12} color="var(--c-amber)" className="tl-pulse" />
                    <span className="shimmer-text">{busyHint}</span>
                  </div>
                )}
                {pendingImages.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    {pendingImages.map((img, i) => (
                      <div key={`${img.name}:${i}`} style={{ position: "relative" }}>
                        <img src={img.dataUrl} alt={img.name} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-border)" }} />
                        <button className="tool-btn" title="移除" style={{ position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 10 }}
                          onClick={() => setPendingImages((cur) => cur.filter((_, j) => j !== i))}>✕</button>
                      </div>
                    ))}
                    <span className="hint" style={{ alignSelf: "center" }}>图片 {pendingImages.length}/4{!visionOk ? " · ⚠ 当前模型未声明视觉能力" : ""}</span>
                  </div>
                )}
                <Composer
                  ref={inputRef}
                  value={inputText}
                  onChange={(v) => onComposeChange(v, setInputText)}
                  maxH={240}
                  placeholder={busy
                    ? (busySend === "block"
                        ? "agent 正在工作——运行中发送已禁用（设置 → Agent 运行时 可改），可先停止本轮"
                        : busySend === "interrupt"
                          ? "agent 正在工作——Enter 插话发送：中断当前轮，你的输入立即生效"
                          : "agent 正在工作——Enter 排队发送，本轮结束后自动注入（双击 Esc 打开检查点）")
                    : "继续对话…输入 / 唤起命令、@ 唤起文件、Shift+Tab 切模式"}
                  busy={busy}
                  sending={sending}
                  canSend={!!inputText.trim()}
                  sendTitle={busy
                    ? (inputText.trim()
                        ? (busySend === "interrupt" ? "插话发送（中断当前轮，立即生效）" : "排队发送（本轮结束后自动注入）")
                        : "停止本轮")
                    : "发送（Enter）"}
                  onStop={() => void stopTask(selected.taskId)}
                  onSend={() => void sendInput()}
                  mode={selected.permissionMode ?? "default"}
                  modeLabel={MODE_META[selected.permissionMode ?? "default"].label.replace(/^[●◆◇⚡]\s*/, "")}
                  onMode={(m) => void setTaskMode(selected.taskId, m).then(() => setMode(m))}
                  groups={modelGroups}
                  model={selected.modelRef ?? ""}
                  modelDisabled={busy && selected.state !== "awaiting-input"}
                  onModel={(id) => void (async () => {
                    try {
                      await call("agent.task.setModel", { taskId: selected.taskId, model: id });
                      await reloadAgents();
                      // 切换模型带入新模型的默认思考深度（后续消息生效）
                      setThinking(resolveRefThinking(id));
                    } catch (err) { setError((err as Error).message); }
                  })()}
                  thinking={thinking}
                  onThinking={(v) => { setThinking(v); }}
                  stats={stats}
                  attachments={pendingImages.map((img, i) => ({ name: img.name, dataUrl: img.dataUrl, onRemove: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)) }))}
                  attachmentHint={`图片 ${pendingImages.length}/4${!visionOk ? " · ⚠ 当前模型未声明视觉能力" : ""}`}
                  onAttachImage={() => imageInputRef.current?.click()}
                  slash={slashItems}
                  onPickSlash={(insert) => { setInputText((cur) => (cur ? `${cur} ${insert}` : insert)); setTimeout(() => inputRef.current?.focus(), 0); }}
                  onKeyDown={chatKeyDown}
                  children={<>
                    {mention ? <MentionPopover mention={mention} items={mentionItems} selectedIndex={mentionSel} onSelect={setMentionSel} onPick={(x) => insertMention(x, setInputText, inputText)} /> : null}
                    {slashQuery !== null && <SlashPopover open items={slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8)} selectedIndex={slashSel} onSelect={setSlashSel} onPick={(insert) => pickSlash(insert, setInputText, inputText)} />}
                  </>}
                />
              </div>
            </div>
            </div>
        </div>
        )}

        {/* ═══ 对话页：未选中任务 = 新任务 composer ═══ */}
        {tab === "chat" && !selected && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
            {error && <ErrorFloat text={error} maxWidth="min(680px, 92%)" go={errorGo} onGo={(s) => { openSettings(s); setError(null); }} onClose={() => setError(null)} />}
            <div style={{ width: 680, maxWidth: "90%" }}>
              {modelInfo && !modelInfo.available ? (
                <button className="tool-btn" style={{ color: "var(--c-amber)", borderColor: "var(--c-amber)", marginBottom: 10 }} onClick={() => openSettings("models")}>
                  ● {t("Agents_ModelMissing")} → {t("Agents_OpenSettings")}
                </button>
              ) : null}
              <Composer
                ref={composeRef}
                value={composeText}
                onChange={(v) => onComposeChange(v, setComposeText)}
                maxH={208}
                minH={42}
                autoFocus
                placeholder={`${t("Agents_ComposePlaceholder")}\n支持 @文件 提及；调研类任务先切「◇ 计划」模式（Shift+Tab）`}
                busy={false}
                sending={sending}
                canSend={!!composeText.trim()}
                sendTitle="创建任务（Enter）"
                onStop={() => {}}
                onSend={() => void createFromCompose()}
                mode={mode}
                modeLabel={MODE_META[mode].label.replace(/^[●◆◇⚡]\s*/, "")}
                onMode={setMode}
                groups={modelGroups}
                model={modelId || (modelProfiles.find((m) => m.isDefault)?.id ?? "")}
                onModel={setModelId}
                thinking={thinking}
                onThinking={setThinking}
                stats={null}
                attachments={pendingImages.map((img, i) => ({ name: img.name, dataUrl: img.dataUrl, onRemove: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)) }))}
                attachmentHint={`图片 ${pendingImages.length}/4（随首条消息发送）`}
                onAttachImage={() => imageInputRef.current?.click()}
                slash={slashItems}
                onPickSlash={(insert) => { setComposeText((cur) => (cur ? `${cur} ${insert}` : insert)); setTimeout(() => composeRef.current?.focus(), 0); }}
                onKeyDown={composeKeyDown}
                children={<>
                  {mention ? <MentionPopover mention={mention} items={mentionItems} selectedIndex={mentionSel} onSelect={setMentionSel} onPick={(x) => insertMention(x, setComposeText, composeText)} /> : null}
                  {slashQuery !== null && <SlashPopover open items={slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8)} selectedIndex={slashSel} onSelect={setSlashSel} onPick={(insert) => pickSlash(insert, setComposeText, composeText)} />}
                </>}
              />
              <div style={{ color: "var(--c-text3)", fontSize: 11, marginTop: 6 }}>
                Enter 发送 · Shift+Enter 换行 · {t("Agents_TargetHint")} · 计划模式：先调研出计划，批准后自动执行
              </div>
            </div>
          </div>
        )}


        {/* ═══ 改动页（完全独立页 · Codex Diff Review）═══ */}
        {tab === "diff" && selected && (
          <ChangesTab taskId={selected.taskId} worktreePath={selected.worktreePath} baselineSha={selected.baselineSha} initialFile={pendingFile} branch={selected.branch}
            onCount={setDiffCount} tick={changesTick} onReloadAgents={reloadAgents} setError={setError} onMutate={() => setChangesTick((n) => n + 1)} />
        )}

        {/* ═══ 检查点页（完全独立页 · ZCode rewind）═══ */}
        {tab === "cp" && selected && (
          <CheckpointsTab taskId={selected.taskId} branch={selected.branch} tick={changesTick} setError={setError} onCount={setCpCount} onViewDiff={() => setTab("diff")} onMutate={() => setChangesTick((n) => n + 1)} />
        )}

        {/* ═══ 子代理页（v4.9 设计稿 §5）：列表 + 详情（复用会话页对话样式）═══ */}
        {tab === "subagents" && selected && (
          <SubagentsTab taskId={selected.taskId} live={LIVE_STATES.has(selected.state)} tick={changesTick} setError={setError} onCount={setSubagentCount}
            focus={subagentFocus} onFocused={() => setSubagentFocus(null)} />
        )}

        {/* ═══ 后台 shell 页（v3.3 工作流 C：terminal_run 后台模式的面板化）═══ */}
        {tab === "shells" && selected && (
          <ShellsTab taskId={selected.taskId} live={LIVE_STATES.has(selected.state)} tick={changesTick} setError={setError} onCount={setShellRunning}
            focus={shellFocus} onFocused={() => setShellFocus(null)} />
        )}
        </div>

        {/* 对话|变更面板 分割线 + 面板：detail 级全高（页签行 band 起），三页签常驻；拖拽调比例（localStorage 持久化）。
            收起动画（panelClosing）：网格瞬落 1 列、分割线隐藏，面板提升为绝对定位覆盖（宽度冻结）滑出 */}
        {selected && changesPanelOpen && (
          <>
            <div className="tk-vdiv" style={{ gridColumn: "2", gridRow: "1 / 3", display: panelClosing ? "none" : undefined }} title="拖拽调整分栏比例" onPointerDown={startSplitDrag}><span className="tk-vdiv-grip" /></div>
            <div ref={panelWrapRef} style={panelClosing
              ? { position: "absolute", right: 0, top: 0, bottom: 0, width: closeWRef.current + "px", zIndex: 5, display: "flex", overflow: "hidden" }
              : { gridColumn: "3", gridRow: "1 / 3", minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden" }}>
              <TaskChangesPanel
                taskId={selected.taskId}
                worktreePath={selected.worktreePath}
                tick={changesTick}
                request={panelReq}
                onCollapse={closePanel}
                onEditInFilesPage={(path) => { pageSdk.requestFileFocus(path); pageSdk.navigate("files"); }}
              />
            </div>
          </>
        )}

        {/* 标题栏页动作槽：分栏开关 / 新窗口经 portal 注入 app TitleBar（页面 keep-alive 隐藏时门控摘除） */}
        {(() => {
          const slot = document.getElementById("tbPageActions");
          if (!slot || !pageVisible || !selected) return null;
          return createPortal(
            <>
              <button className={"tb-pact" + (changesPanelOpen ? " on" : "")} title={changesPanelOpen ? "关闭右侧变更分栏" : "打开右侧变更分栏"} onClick={togglePanel}>
                <TlIcon name="splitpane" size={15} />
              </button>
              <button className="tb-pact" title="在新窗口打开当前任务" onClick={() => void call("app.newWindow", { path: selected.worktreePath })}>
                <TlIcon name="external" size={13} />
              </button>
            </>,
            slot,
          );
        })()}

        {/* 收尾合并 / 验收反馈 对话框（v3.3 工作流 B/C） */}
        {wrapupOpen && selected && (
          <TaskWrapupDialog task={selected} onClose={() => setWrapupOpen(false)} setError={setError}
            onMerged={() => { setWrapupOpen(false); void reloadAgents(); setChangesTick((n) => n + 1); notifyRepoChanged(); }} />
        )}
        {feedbackOpen && selected && (
          <TaskFeedbackDialog task={selected} onClose={() => setFeedbackOpen(false)} setError={setError}
            onSent={() => { void reloadAgents(); }} />
        )}
      </div>
    </div>
  );
}
