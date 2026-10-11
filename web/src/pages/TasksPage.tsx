import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DiffView, renderMarkdown, Select } from "../kit";
import type {
  AgentCheckpointDTO, AgentContextStatsDTO, AgentEventDTO, AgentHarnessDTO, AgentTaskDTO,
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
  TOOL_LABELS, BUILTIN_TIMELINE_RENDERERS, pushCap, reduceBlocks, groupLogs, groupTurns, permOptions,
  type Block, type Todo, type TurnGroup, type PermOption,
  TodoList, PermissionCard, QuestionCard, PlanCard, SubtaskBlock,
} from "./TaskTimeline";
import { Composer, MentionPopover, SlashPopover, BUILTIN_COMPOSER_PROVIDERS, MODE_ORDER, MODE_META, THINKING_META, type ModelGroupVM } from "./TaskComposer";
import { ChangesTab, CheckpointsTab } from "./TaskDetailPages";
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


function stateChip(s: AgentTaskDTO["state"]): { label: string; color: string } {
  switch (s) {
    case "starting": return { label: "Starting", color: "var(--c-text3)" };
    case "working": return { label: "● Working", color: "var(--c-green)" };
    case "awaiting-input": return { label: "Awaiting input", color: "var(--c-text)" };
    case "awaiting-permission": return { label: "● 待确认", color: "var(--c-amber)" };
    case "completed": return { label: "Completed", color: "var(--c-accent)" };
    case "failed": return { label: "Failed", color: "var(--c-red)" };
    case "interrupted": return { label: "Interrupted", color: "var(--c-amber)" };
    case "stopped": return { label: "Stopped", color: "var(--c-text3)" };
  }
}

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
  const [taskTypes, setTaskTypes] = useState<TaskTypeDTO[]>([]);
  const [modelProfiles, setModelProfiles] = useState<ModelProfileDTO[]>([]);
  const [taskTypeId, setTaskTypeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<"plan" | "default" | "yolo">("default");
  const [tab, setTab] = useState<"chat" | "diff" | "cp">("chat");
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
  const [changesPanelOpen, setChangesPanelOpen] = useState(true);
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
  // 分栏布局：任务列表 / 对话分栏都记比例（fr 份额），窗口缩放比例不变；拖拽实时调、松手落 localStorage。
  // minmax 下限兜底窄窗（列表 ≥210px，对话 ≥340px，面板 ≥280px），比例再小也不得挤破下限。
  const [listRatio, setListRatio] = useState(() => {
    localStorage.removeItem("gitter.taskListWidth"); // 旧绝对值键清理
    const v = Number(localStorage.getItem("gitter.taskListRatio"));
    return Number.isFinite(v) && v >= 0.12 && v <= 0.5 ? v : 0.23;
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
  const panelTemplate = (r: number) => `minmax(280px, ${r.toFixed(4)}fr) 6px minmax(280px, ${(1 - r).toFixed(4)}fr)`;
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
  // 分割线拖拽：拖拽中直写 grid 列（不经 React 渲染，无抖动），松手落比例
  const startListDrag = (e: { currentTarget: HTMLElement; preventDefault(): void }) => {
    e.preventDefault();
    const grip = e.currentTarget;
    const main = grip.parentElement;
    if (!main) return;
    grip.classList.add("drag");
    const move = (ev: PointerEvent) => {
      const rect = main.getBoundingClientRect();
      const r = Math.max(0.14, Math.min(0.45, (ev.clientX - rect.left - 3) / rect.width));
      main.style.gridTemplateColumns = `minmax(210px, ${r.toFixed(4)}fr) 6px minmax(0, ${(1 - r).toFixed(4)}fr)`;
    };
    const up = () => {
      grip.classList.remove("drag");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const m = main.style.gridTemplateColumns.match(/([0-9.]+)fr/);
      if (m) { const r = Number(m[1]); setListRatio(r); localStorage.setItem("gitter.taskListRatio", String(r)); }
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
      // 显式同步浮钮状态，避免「已到底部但按钮仍在」
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
      setAgentTasks(await call<AgentTaskDTO[]>("agent.tasks"));
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
    void call<{ agentsMaxSubagents?: number }>("settings.get").then((s) => {
      if (s?.agentsMaxSubagents) setMaxSubagents(s.agentsMaxSubagents);
    }).catch(() => {});
  }, []);

  // 事件摄入 → 时间线块
  useEffect(
    () =>
      onEvent("agent.event", (p) => {
        const { taskId, event } = p as { taskId: string; event: AgentEventDTO };
        setEvMap((m) => ({ ...m, [taskId]: reduceBlocks(m[taskId] ?? [], event) }));
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

  // 运行中工具 + 子代理计数 + 上下文用量
  const runningTool = (() => {
    if (!selectedTask) return null;
    const blocks = evMap[selectedTask] ?? [];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind === "tool" && b.state === "running") return b;
    }
    return null;
  })();
  const runningSubs = selectedTask ? (evMap[selectedTask] ?? []).filter((b) => b.kind === "subtask" && b.state === "running").length : 0;

  // 切任务即复位：避免上一个任务的用量残留到新任务（轮询数据到达前短暂空窗，正确优于误导）
  useEffect(() => { setStats(null); }, [selectedTask]);
  useEffect(() => { setExpandedTurns(new Set()); }, [selectedTask]);
  useEffect(() => {
    if (!selectedTask) return;
    let cancelled = false;
    const pull = () => {
      void call<AgentContextStatsDTO | null>("agent.context.stats", { taskId: selectedTask })
        .then((s) => { if (!cancelled) setStats(s); })
        .catch(() => {});
    };
    pull();
    const iv = setInterval(pull, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [selectedTask, changesTick]);

  useEffect(() => {
    if (!runningTool) return;
    const iv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [runningTool]);

  const eventsToBlocks = (events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]): Block[] => {
    let blocks: Block[] = [];
    for (const je of events) {
      if (je.kind === "text") blocks = pushCap(blocks, { kind: "human", text: je.text ?? "" });
      else blocks = reduceBlocks(blocks, je.event as AgentEventDTO);
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

  useEffect(() => {
    if (skippingAutoScroll.current) { skippingAutoScroll.current = false; return; }
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

  const sendInput = async () => {
    if (!selected || !inputText.trim() || sending) return;
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
            if (BUSY_STATES.has(selected.state)) await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded });
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
            if (BUSY_STATES.has(selected.state)) await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded });
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
    const busy = BUSY_STATES.has(selected.state);
    try {
      if (busy) {
        // 排队轮不支持多模态注入：busy 时图片随文本提示走下轮（主进程忽略排队附件）
        if (attachments.length > 0) setError("任务运行中：图片将不随排队消息注入，请等本轮结束再发送");
        await call("agent.task.queue", { taskId: selected.taskId, prompt: text });
      } else {
        await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking, mode, ...(attachments.length > 0 ? { attachments } : {}) });
      }
      await reloadAgents();
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const createFromCompose = async () => {
    if (!composeText.trim() || sending) return;
    // 新任务页的斜杠命令：/attach 是纯 UI 动作可直接执行；其余命令需要具体任务上下文
    if (composeText.trim().startsWith("/")) {
      const cmd = composeText.trim().split(/\s+/)[0].slice(1);
      if (cmd === "attach") { imageInputRef.current?.click(); setComposeText(""); return; }
      setError(`命令 /${cmd} 需在具体任务的对话中使用（新任务页仅支持 /attach）`);
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
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const stopTask = async (taskId: string) => {
    try { await call("agent.task.stop", { taskId }); await reloadAgents(); } catch (e) { setError((e as Error).message); }
  };

  // 任务卡右侧操作（列表极简化后仅存的两个动作）：分叉 = 复制历史到新 worktree；归档 = 从列表隐藏
  const forkTask = async (taskId: string) => {
    try {
      const forked = await call<AgentTaskDTO>("agent.task.fork", { taskId });
      await reloadAgents();
      setSelectedTask(forked.taskId);
      setTab("chat");
    } catch (e) { setError((e as Error).message); }
  };
  const archiveTask = async (taskId: string) => {
    try {
      await call("agent.task.archive", { taskId, archived: true });
      if (selectedTask === taskId) setSelectedTask(null);
      await reloadAgents();
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

  // 聊天/新任务 composer 共用键盘处理：Enter 发送，Shift+Enter 换行，Shift+Tab 切模式
  const chatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (navKeyDown(e, inputText, setInputText)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendInput(); return; }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]); return; }
  };
  const composeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (navKeyDown(e, composeText, setComposeText)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void createFromCompose(); return; }
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
    switch (b.kind) {
      case "permission":
        return <PermissionCard key={key} b={b} decided={decided[b.requestId]} sel={permSel[b.requestId] ?? 0} showFullAccess={showFullAccess} onSel={(id, i) => setPermSel((m) => ({ ...m, [id]: i }))} onReply={replyPerm} onFullAccess={(id) => void replyFullAccess(id)} />;
      case "question":
        return <QuestionCard key={key} b={b} decided={decided[b.requestId]} onAnswer={replyAnswer} />;
      case "plan":
        return <PlanCard key={key} b={b} decided={decided[b.requestId]} onPlan={replyPlan} />;
      case "todo":
        // todo 清单以右上角悬浮态展示，不占用时间线版面
        return null;
      default:
        break;
    }
    const renderer = resolveTimelineRenderer(b.kind === "tool" ? b.name : undefined, b.kind);
    if (!renderer) return null;
    const ctx: TimelineCardCtx = {
      taskId: selectedTask ?? "",
      viewFile: (path) => { setPendingFile(path); setPanelReq({ path, mode: "diff", ts: Date.now() }); setTab("chat"); animatePanel(true); },
      previewFile,
      contextPct: stats ? `${Math.round(stats.ratio * 100)}%` : undefined,
      showCopy: !process && copyBlocks.has(b),
      renderChildren: (children) => <Fragment>{(children as Block[]).map((c, i) => renderBlock(c, `${key}-${i}`, true))}</Fragment>,
    };
    return <Fragment key={key}>{renderer.render({ block: b, taskId: ctx.taskId ?? "", ctx })}</Fragment>;
  };
  // 过程块列表渲染（含连续日志折叠组）；轮折叠展开与进行中轮共用
  const renderProcess = (prefix: string, list: Block[]): ReactNode =>
    groupLogs(list).map((lg, li) =>
      lg.kind === "logs" ? (
        <details key={`${prefix}${li}`} style={{ fontSize: 11 }}>
          <summary style={{ cursor: "pointer", color: "var(--c-text3)" }}>▸ 显示 {lg.items.length} 条日志</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            {lg.items.map((b, j) => renderBlock(b, `${prefix}${li}-${j}`))}
          </div>
        </details>
      ) : (
        renderBlock(lg.block, `${prefix}${li}`)
      ),
    );

  // 任务列表极简行（v3 设计稿 task-page-v3-mockup）：状态点 + 标题一行；
  // 分叉/归档收敛为悬停行尾图标钮（.tk-quick），细节（分支/状态）走 title 悬停
  const agentCard = (task: AgentTaskDTO) => {
    const live = LIVE_STATES.has(task.state);
    const selectedNow = selectedTask === task.taskId;
    const dotColor = task.state === "failed" ? "var(--c-red)" : task.state === "completed" || task.state === "stopped" ? "var(--c-text3)" : task.permissionMode === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-green)";
    const working = task.state === "working" || task.state === "starting";
    return (
      <div key={task.taskId} className={"tk-row" + (selectedNow ? " sel" : "")} onClick={() => { setSelectedTask(selectedNow ? null : task.taskId); setTab("chat"); setThinking(task.thinking ?? "medium"); setMode(task.permissionMode ?? "default"); }}
        title={`${task.title}\n${stateChip(task.state).label} · ${task.branch}`}>
        <span className={"tk-dot" + (working ? " run" : "")} style={{ color: dotColor }} />
        <span className="tk-row-title">{task.title}</span>
        <span className="tk-quick">
          <button className="icon-btn" title={live ? "运行中不可分叉，请先停止" : "分叉任务（复制对话历史到新分支）"} disabled={live}
            onClick={(e) => { e.stopPropagation(); void forkTask(task.taskId); }}>
            <TlIcon name="fork" size={13} />
          </button>
          <button className="icon-btn" title={live ? "运行中不可归档，请先停止" : "归档任务（从列表隐藏，可恢复）"} disabled={live}
            onClick={(e) => { e.stopPropagation(); void archiveTask(task.taskId); }}>
            <TlIcon name="archive" size={13} />
          </button>
        </span>
      </div>
    );
  };

  const busy = selected ? BUSY_STATES.has(selected.state) : false;
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
  // D1 vision 门控：当前生效档案（任务绑定 → 默认★）按实际选中成员判定
  const activeProfile = resolveRefProfile(selected?.modelRef) ?? modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
  const visionOk = resolveRefVision(selected?.modelRef ?? activeProfile?.id);
  const attachmentsPayload = pendingImages.map((img) => ({ name: img.name, dataBase64: img.dataUrl }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: `minmax(210px, ${listRatio.toFixed(4)}fr) 6px minmax(0, ${(1 - listRatio).toFixed(4)}fr)`, flex: 1, minHeight: 0, height: "100%" }}>
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
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {(agentTasks?.length ?? 0) === 0 && (
            <div style={{ fontSize: 12, color: "var(--c-text3)", padding: "4px 2px" }}>{t("Agents_EmptyHint")}</div>
          )}
          {agentTasks?.map(agentCard)}
        </div>
      </div>
      {/* 任务列表|对话 分割线：拖拽调宽（localStorage 持久化） */}
      <div className="tk-vdiv" title="拖拽调整任务列表宽度" onPointerDown={startListDrag}><span className="tk-vdiv-grip" /></div>

      {/* ═══ 右：详情（页签 = 全局导航；三页互斥独立）═══ */}
      {/* v3.2 设计稿 detail 级 grid：页签行只跨对话列，变更面板 + 分割线从页签行 band 起全高、
          三页签常驻（切换改动/检查点不卸面板）；minWidth: 0 = grid item 自动最小尺寸回收，
          对话内容的 min-content 宽度不再把 1fr 轨道撑破窗口 */}
      <div ref={detailRef} style={{ display: "grid", position: "relative", flex: 1, minHeight: 0, minWidth: 0, gridTemplateRows: "auto minmax(0, 1fr)", gridTemplateColumns: selected && changesPanelOpen && !panelClosing ? panelTemplate(splitRatio) : "minmax(0, 1fr)" }}>
        <div className="tk-tabs" style={{ gridColumn: "1", gridRow: "1" }}>
          {([["chat", "对话", 0], ["diff", "改动", diffCount], ["cp", "检查点", cpCount]] as const).map(([id, label, n]) => (
            <div key={id} className={"tk-tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
              {label}{n > 0 ? <span className="tk-tab-n">{n}</span> : null}
            </div>
          ))}
        </div>

        {/* 页内容区（c1 r2）：对话 / 新任务空态 / 改动 / 检查点 */}
        <div style={{ gridColumn: "1", gridRow: "2", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {/* ═══ 对话页（保持挂载：切改动/检查点不重新加载历史、不丢滚动位置） ═══ */}
        {selected && (
          <div style={{ flex: 1, minHeight: 0, display: tab === "chat" ? "grid" : "none", flexDirection: "column", gridTemplateRows: "auto minmax(0, 1fr) auto", overflow: "hidden" }}>
            <div className="tk-pagehead" style={{ gridColumn: "1", gridRow: "1" }}>
              <span className="tk-pill" style={{ color: stateChip(selected.state).color, borderColor: `color-mix(in srgb, ${stateChip(selected.state).color} 32%, transparent)`, background: `color-mix(in srgb, ${stateChip(selected.state).color} 9%, transparent)` }}>
                <span className="tk-pill-dot" />
                {stateChip(selected.state).label}{busy && selected.lastActiveAt ? " · " + Math.max(0, Math.round((Date.now() - new Date(selected.lastActiveAt).getTime()) / 1000)) + "s" : ""}
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
            </div>
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative", gridColumn: "1", gridRow: "2" }}>
              {/* 错误浮层：悬于时间线之上、顶部状态条正下方；不打断版面流 */}
              {error && <ErrorFloat text={error} maxWidth="calc(100% - 292px)" go={errorGo} onGo={(s) => { openSettings(s); setError(null); }} onClose={() => setError(null)} />}
              <div ref={timelineRef} className="tl-scroll" style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}
                onScroll={onTimelineScroll}
                onDoubleClick={(e) => {
                  const pre = (e.target as HTMLElement).closest("pre");
                  if (pre) void navigator.clipboard?.writeText(pre.textContent ?? "");
                }}>
              <div style={{ maxWidth: 880, margin: "0 auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
                {loadingOlder && (
                  <div style={{ textAlign: "center", color: "var(--c-text3)", fontSize: 11 }}>
                    <span className="tl-pulse">加载中…</span>
                  </div>
                )}
                {hasMoreHistory && !loadingOlder && (
                  <div style={{ textAlign: "center", color: "var(--c-text3)", fontSize: 11, opacity: .6 }}>↑ 上滚加载更早</div>
                )}
                {timeline.length === 0 && <div style={{ color: "var(--c-text3)", fontSize: 12 }}>{t("Agents_TimelineEmpty")}</div>}
                {groupTurns(timeline).map((g, gi) => {
                  const ended = !!g.turn;
                  const expanded = !ended || expandedTurns.has(g.anchor);
                  const tools = g.process.filter((b) => b.kind === "tool").length;
                  const subs = g.process.filter((b) => b.kind === "subtask").length;
                  return (
                    <Fragment key={gi}>
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
                      {g.turn ? renderBlock(g.turn, `g${gi}-t`) : null}
                    </Fragment>
                  );
                })}
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
                    position: "absolute", left: "50%", bottom: 10, transform: "translateX(-50%)",
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
            </div>
            <div style={{ borderTop: "1px solid var(--c-border)", padding: "8px 20px 8px", gridColumn: "1", gridRow: "3" }}>
              <div style={{ maxWidth: 880, margin: "0 auto", position: "relative" }}>
                {/* DeepSeek 式执行中提示：脉冲星光 + 流光文字（运行工具名/秒数实时刷新） */}
                {busy && !pendingPerm && (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 2px 7px", fontSize: 12 }}>
                    <TlIcon name="sparkle" size={12} color="var(--c-amber)" className="tl-pulse" />
                    <span className="shimmer-text">{busyHint}</span>
                  </div>
                )}
                {pendingPerm && (
                  <div style={{ marginBottom: 8, fontSize: 11.5, color: "var(--c-amber)", display: "flex", alignItems: "center", gap: 6 }}>
                    <TlIcon name="shield" size={12} className="tl-pulse" />
                    <span>等待授权（↑↓+Enter 或数字直选上方卡片选项）</span>
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
                    ? "agent 正在工作——输入将排队，本轮结束后自动注入（Esc 中断 / Esc×2 回滚）"
                    : "继续对话…输入 / 唤起命令、@ 唤起文件、Shift+Tab 切模式"}
                  busy={busy}
                  sending={sending}
                  canSend={!!inputText.trim()}
                  sendTitle={busy ? "停止（Esc 同效）" : "发送（Enter）"}
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
      </div>
    </div>
  );
}
