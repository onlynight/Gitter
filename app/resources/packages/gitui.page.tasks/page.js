(function(jsxRuntime, react) {
  "use strict";
  var _a, _b;
  const K = () => {
    const k = window.GITTER_KIT;
    if (!k) throw new Error("GITTER_KIT 未注入（外部页必须经宿主 pageLoader 装载）");
    return k;
  };
  const React = K().React;
  K().ReactDOM;
  const ReactDOMClient = K().ReactDOMClient;
  const DiffView = K().DiffView;
  K().diffStatusLetter;
  K().renderSegments;
  K().wordDiff;
  K().SplitPane;
  K().Banner;
  const Modal = K().Modal;
  K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  const renderMarkdown = K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  const Select = K().Select;
  K().ScrollArea;
  function U$1() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  const BOOT = ((_b = (_a = window.GITTER_UI) == null ? void 0 : _a.getActiveCaller) == null ? void 0 : _b.call(_a)) ?? null;
  const pageSdk = {
    call: (method, params) => {
      const g = U$1();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    on: (method, cb) => U$1().on(method, cb),
    t: (key, ...args) => U$1().t(key, ...args),
    navigate: (page) => U$1().navigate(page),
    openSettings: (section) => U$1().openSettings(section),
    toast: (title, body) => U$1().toast(title, body),
    refresh: () => U$1().refresh(),
    repo: () => U$1().repo(),
    settings: () => U$1().settings(),
    theme: () => U$1().theme(),
    openRepo: (path) => U$1().openRepo(path),
    closeRepo: () => U$1().closeRepo(),
    updateSettings: (patch) => U$1().updateSettings(patch),
    applySettings: (s) => U$1().applySettings(s),
    reloadTheme: () => U$1().reloadTheme(),
    clearSettingsFocus: () => U$1().clearSettingsFocus(),
    context: () => U$1().context(),
    setContext: (...a) => U$1().setContext(...a),
    focusTask: (taskId) => U$1().focusTask(taskId),
    clearTaskFocus: () => U$1().clearTaskFocus(),
    runCommand: (cmd, ctx) => U$1().runCommand(cmd, ctx),
    extTree: () => U$1().extTree()
  };
  function useAppState() {
    const g = U$1();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  function useTaskFocus() {
    const focusTaskId = useAppState().focusTaskId;
    const consume = () => pageSdk.clearTaskFocus();
    return [focusTaskId, consume];
  }
  function U() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  function registerAgentUI(reg) {
    U().registerAgentUI(reg);
  }
  function resolveTimelineRenderer(toolName, blockKind) {
    return U().resolveTimelineRenderer(toolName, blockKind);
  }
  function composerProviders() {
    return U().composerProviders();
  }
  function useAgentUIVersion() {
    const g = U();
    return react.useSyncExternalStore(g.onAgentUIChanged, g.agentUIVersion);
  }
  const { call, on: onEvent, t, openSettings } = pageSdk;
  const LIVE_STATES = /* @__PURE__ */ new Set(["starting", "working", "awaiting-input", "awaiting-permission"]);
  const BUSY_STATES = /* @__PURE__ */ new Set(["starting", "working", "awaiting-permission"]);
  const MODE_ORDER = ["plan", "default", "yolo"];
  const MODE_META = {
    plan: { label: "◇ 规划", color: "var(--c-chip-purple-fg, #b490ff)" },
    default: { label: "● 默认", color: "var(--c-text3)" },
    yolo: { label: "⚡ Yolo", color: "var(--c-red)" }
  };
  const TOOL_LABELS = {
    web_search: "网络搜索",
    web_fetch: "读取网页",
    repo_status: "工作区状态",
    repo_diff: "读取 diff",
    repo_log: "提交历史",
    repo_read_file: "读文件",
    repo_list_files: "列文件",
    repo_glob: "找文件",
    repo_grep: "搜索内容",
    review_get_state: "验收反馈",
    file_write: "写文件",
    file_patch: "编辑文件",
    git_stage: "暂存",
    git_commit: "提交",
    git_push: "推送",
    terminal_run: "执行命令",
    terminal_poll: "后台命令",
    ask_user: "提问",
    todo_write: "任务清单",
    plan_submit: "提交计划",
    task: "子代理"
  };
  const BUILTIN_SLASH = [
    { name: "compact", hint: "立即压缩上下文" },
    { name: "clear", hint: "重置会话（保留 worktree/checkpoint）" },
    { name: "plan", hint: "切规划模式" },
    { name: "default", hint: "切默认模式" },
    { name: "yolo", hint: "切 yolo 模式" },
    { name: "approvals", hint: "切换审批模式（同 Shift+Tab）" },
    { name: "stop", hint: "中断当前轮" },
    { name: "model", arg: "<id>", hint: "切换模型档案" },
    { name: "thinking", arg: "<level>", hint: "切换思考深度" },
    { name: "fork", hint: "分叉任务" },
    { name: "skill", arg: "<名称>", hint: "注入技能指引" },
    { name: "export", hint: "导出会话为 Markdown 文件" },
    // 模板命令（D3/D4）：与包命令同一分发语义（busy 排队 / idle 续跑，零新增 RPC）
    {
      name: "review",
      hint: "审查当前工作区改动（review 子代理）",
      template: "请用 task 工具（mode=review）审查当前工作区改动：先 repo_status / repo_diff 获取变更，逐文件审查正确性、边界条件与测试影响，产出问题清单（文件:行号 + 高/中/低 + 修复建议），最后给出可合并结论。${input}"
    },
    {
      name: "init",
      hint: "分析仓库并生成/更新 AGENTS.md",
      template: "请分析当前仓库（目录结构、构建/测试/lint 命令、代码约定、现有文档），在仓库根生成或更新 AGENTS.md：项目简介、常用命令、目录导览、代码约定与注意事项。已存在时合并改进而非覆盖。${input}"
    }
  ];
  const MAX_BLOCKS = 400;
  function pushCap(arr, b) {
    const next = [...arr, b];
    return next.length > MAX_BLOCKS ? next.slice(next.length - MAX_BLOCKS) : next;
  }
  function reduceBlocks(blocks, ev) {
    if (ev.subtaskId) {
      if (ev.type === "subtask") {
        const idx2 = [...blocks].reverse().findIndex((b) => b.kind === "subtask" && b.subtaskId === ev.subtaskId);
        if (idx2 >= 0) {
          const at = blocks.length - 1 - idx2;
          const next = [...blocks];
          const sub = next[at];
          next[at] = { ...sub, state: ev.state ?? sub.state, final: ev.finalMessage ?? sub.final, durationMs: ev.durationMs ?? sub.durationMs };
          return next;
        }
        return pushCap(blocks, { kind: "subtask", subtaskId: ev.subtaskId, name: ev.name ?? "", mode: ev.mode ?? "", state: ev.state ?? "running", final: ev.finalMessage, durationMs: ev.durationMs, children: [] });
      }
      const idx = [...blocks].reverse().findIndex((b) => b.kind === "subtask" && b.subtaskId === ev.subtaskId);
      if (idx >= 0) {
        const at = blocks.length - 1 - idx;
        const sub = blocks[at];
        const inner = reduceBlocks([], { ...ev, subtaskId: void 0 });
        let children = sub.children;
        for (const c of inner) children = pushCap(children, c);
        const next = [...blocks];
        next[at] = { ...sub, children };
        return next;
      }
      return blocks;
    }
    switch (ev.type) {
      case "status":
        return pushCap(blocks, { kind: "status", text: `${ev.phase ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}` });
      case "output":
        if (ev.stream === "assistant") {
          const last = blocks[blocks.length - 1];
          if (last && last.kind === "assistant" && last.merge) {
            const next = [...blocks];
            next[next.length - 1] = { ...last, text: last.text + (ev.text ?? "") };
            return next;
          }
          return pushCap(blocks, { kind: "assistant", text: ev.text ?? "", merge: true });
        }
        if (ev.stream === "tool") {
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.kind === "tool" && b.name === "terminal_run" && b.state === "running") {
              const next = [...blocks];
              next[i] = { ...b, tail: ((b.tail ?? "") + (ev.text ?? "")).slice(-2e3) };
              return next;
            }
          }
        }
        return blocks;
      case "tool": {
        if (ev.phase === "start") {
          return pushCap(blocks, { kind: "tool", callId: ev.callId ?? "", name: ev.name ?? "", args: ev.args, state: "running", source: ev.source, startTs: Date.now() });
        }
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i];
          if (b.kind === "tool" && b.callId === ev.callId) {
            const next = [...blocks];
            next[i] = { ...b, state: ev.isError ? "error" : "ok", result: ev.result, durationMs: ev.durationMs };
            return next;
          }
        }
        return blocks;
      }
      case "permission":
        return pushCap(blocks, { kind: "permission", requestId: ev.requestId ?? "", toolName: ev.toolName ?? ev.title ?? "", title: ev.title ?? "", command: ev.command, payload: ev.payload, rememberable: ev.rememberable });
      case "question":
        return pushCap(blocks, { kind: "question", requestId: ev.requestId ?? "", question: ev.question ?? "", options: ev.options ?? [] });
      case "plan":
        return pushCap(blocks, { kind: "plan", requestId: ev.requestId ?? "", plan: ev.plan ?? "" });
      case "todo":
        return [...blocks.filter((b) => b.kind !== "todo"), { kind: "todo", todos: ev.todos ?? [] }];
      case "checkpoint":
        return pushCap(blocks, { kind: "checkpoint", sha: ev.commitSha ?? "", summary: ev.summary ?? "" });
      case "file-change":
        return pushCap(blocks, { kind: "file", path: ev.path ?? "", changeKind: ev.kind ?? "modified", summary: ev.summary });
      case "subtask":
        return pushCap(blocks, { kind: "subtask", subtaskId: ev.subtaskId ?? "", name: ev.name ?? "", mode: ev.mode ?? "", state: ev.state ?? "running", final: ev.finalMessage, durationMs: ev.durationMs, children: [] });
      case "turn-completed":
        return pushCap(blocks, { kind: "turn", text: `turn #${blocks.filter((b) => b.kind === "turn").length + 1}`, usage: ev.usage });
      case "completed":
        return pushCap(blocks, { kind: "status", text: `${ev.outcome ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}` });
      case "log":
        return pushCap(blocks, { kind: "log", level: ev.level ?? "info", text: ev.text ?? "" });
      default:
        return blocks;
    }
  }
  function stateChip(s) {
    switch (s) {
      case "starting":
        return { label: "Starting", color: "var(--c-text3)" };
      case "working":
        return { label: "● Working", color: "var(--c-green)" };
      case "awaiting-input":
        return { label: "Awaiting input", color: "var(--c-text)" };
      case "awaiting-permission":
        return { label: "● 待确认", color: "var(--c-amber)" };
      case "completed":
        return { label: "Completed", color: "var(--c-accent)" };
      case "failed":
        return { label: "Failed", color: "var(--c-red)" };
      case "interrupted":
        return { label: "Interrupted", color: "var(--c-amber)" };
      case "stopped":
        return { label: "Stopped", color: "var(--c-text3)" };
    }
  }
  function permOptions(b, showFullAccess = false) {
    const sig = b.command ?? b.title;
    const prefix = sig ? sig.slice(0, 24) : null;
    const opts = [{ label: "1. 是，执行一次", reply: { ok: true } }];
    if (b.rememberable !== false) opts.push({ label: "2. 是，本会话不再询问", reply: { ok: true, remember: true } });
    if (prefix) opts.push({ label: `3. 是，总是允许前缀 “${prefix}”`, reply: { ok: true, remember: true, rulePrefix: prefix } });
    if (showFullAccess) opts.push({ label: `${opts.length + 1}. 完全访问：批准并切换（后续免询问，推送/高危除外）`, reply: { ok: true, remember: true, fullAccess: true } });
    opts.push({ label: `${opts.length + 1}. 否，告诉 agent 改用其他方式`, reply: { ok: false } });
    return opts;
  }
  function AgentImage(props) {
    const [src, setSrc] = react.useState(null);
    const [err, setErr] = react.useState(null);
    react.useEffect(() => {
      let cancelled = false;
      void call("agent.previewImage", { taskId: props.taskId, path: props.path }).then((r) => {
        if (cancelled) return;
        if (r.dataUrl) setSrc(r.dataUrl);
        else setErr(r.error ?? "加载失败");
      }).catch((e) => setErr(e.message));
      return () => {
        cancelled = true;
      };
    }, [props.taskId, props.path]);
    if (err) return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11.5 }, children: [
      "🖼 ",
      props.path,
      "（",
      err,
      "）"
    ] });
    if (!src) return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11.5 }, children: [
      "🖼 ",
      props.path,
      "（加载中…）"
    ] });
    return /* @__PURE__ */ jsxRuntime.jsx("img", { src, alt: props.path, style: { maxWidth: 320, maxHeight: 220, borderRadius: 6, border: "1px solid var(--c-border)" } });
  }
  function MentionPopover(props) {
    const { mention, items, onPick } = props;
    if (!mention || items.length === 0) return null;
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mention-pop", style: { position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, maxHeight: 180, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }, children: items.map((it) => /* @__PURE__ */ jsxRuntime.jsx("div", { style: { padding: "4px 10px", fontSize: 12, cursor: "pointer" }, onMouseDown: (e) => {
      e.preventDefault();
      onPick(it.insert);
    }, children: it.label }, it.label)) });
  }
  function ToolCard({ b }) {
    const [open, setOpen] = react.useState(false);
    const label = TOOL_LABELS[b.name] ?? b.name;
    const argSummary = (() => {
      try {
        const a = b.args;
        if (!a) return "";
        if (typeof a.command === "string") return a.command.slice(0, 110);
        if (typeof a.path === "string") return a.path;
        if (typeof a.pattern === "string") return JSON.stringify(a).slice(0, 110);
        if (Array.isArray(a.paths)) return a.paths.slice(0, 3).join(", ");
        if (typeof a.question === "string") return a.question.slice(0, 80);
        return JSON.stringify(a).slice(0, 110);
      } catch {
        return "";
      }
    })();
    const glyphColor = b.state === "running" ? "var(--c-amber)" : b.state === "error" ? "var(--c-red)" : "var(--c-green)";
    const firstLine = (b.result ?? "").split("\n")[0] ?? "";
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontFamily: "var(--mono, monospace)", fontSize: 12.5 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 4px", borderRadius: 6 }, onClick: () => setOpen(!open), children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: glyphColor }, children: "⏺" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontWeight: 700 }, children: label }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }, children: argSummary }),
        b.source ? /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 9.5, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", color: "var(--c-text3)" }, children: b.source }) : null,
        b.durationMs !== void 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: [
          (b.durationMs / 1e3).toFixed(1),
          "s"
        ] }) : null
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { margin: "1px 0 0 18px", borderLeft: "1px solid var(--c-border)", paddingLeft: 10, color: "var(--c-text3)", fontSize: 12 }, children: b.state === "running" && b.tail ? /* @__PURE__ */ jsxRuntime.jsx("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, fontFamily: "inherit", color: "var(--c-text)" }, children: b.tail.split("\n").slice(-4).join("\n") }) : b.result ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: open ? 420 : 22, overflow: "hidden", cursor: "pointer" }, onClick: () => setOpen(!open), children: open ? b.result.slice(0, 16e3) : firstLine.slice(0, 200) || "（无输出）" }),
        open && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: { fontSize: 10.5, margin: "4px 0" }, onClick: () => {
          var _a2;
          return void ((_a2 = navigator.clipboard) == null ? void 0 : _a2.writeText(b.result ?? ""));
        }, children: "复制结果" })
      ] }) : null })
    ] });
  }
  function TodoList({ todos }) {
    const done = todos.filter((x) => x.status === "completed").length;
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { border: "1px solid var(--c-border)", borderRadius: 10, padding: "8px 12px", maxWidth: 620 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, marginBottom: 4 }, children: [
        "任务清单 · ",
        done,
        "/",
        todos.length
      ] }),
      todos.map((td, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, color: td.status === "completed" ? "var(--c-text3)" : td.status === "in_progress" ? "var(--c-text)" : "var(--c-text3)" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: td.status === "completed" ? "☑" : td.status === "in_progress" ? "◉" : "☐" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { textDecoration: td.status === "completed" ? "line-through" : void 0, fontWeight: td.status === "in_progress" ? 600 : 400 }, children: td.content })
      ] }, i))
    ] });
  }
  function PermissionCard(props) {
    var _a2, _b2, _c, _d;
    const { b, decided, sel } = props;
    const kindLabel = {
      command: "命令",
      "git-stage": "暂存",
      "git-commit": "提交",
      "git-push": "推送",
      mcp: "MCP",
      plugin: "插件",
      restore: "恢复"
    };
    const kind = ((_a2 = b.payload) == null ? void 0 : _a2.kind) ?? "command";
    const options = permOptions(b, props.showFullAccess);
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { border: `1px solid ${decided ? "var(--c-border)" : "var(--c-amber)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 700, opacity: decided ? 0.65 : 1 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: decided ? "var(--c-text3)" : "var(--c-amber)", fontWeight: 700, marginBottom: 4 }, children: [
        "◈ 授权请求 · ",
        kindLabel[kind] ?? kind,
        ((_b2 = b.payload) == null ? void 0 : _b2.source) ? /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 10, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", marginLeft: 8 }, children: b.payload.source }) : null,
        ((_c = b.payload) == null ? void 0 : _c.risk) && /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: b.payload.risk === "high" ? "var(--c-red)" : "var(--c-amber)", float: "right", fontWeight: 700 }, children: [
          "■ ",
          b.payload.risk === "high" ? "高危" : "注意"
        ] })
      ] }),
      b.command && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontFamily: "var(--mono, monospace)", fontSize: 12, background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "6px 10px", margin: "4px 0", whiteSpace: "pre-wrap", wordBreak: "break-all" }, children: b.command }),
      ((_d = b.payload) == null ? void 0 : _d.paths) && b.payload.paths.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11.5, color: "var(--c-text3)", margin: "4px 0", maxHeight: 64, overflowY: "auto" }, children: [
        b.payload.paths.slice(0, 20).map((p) => /* @__PURE__ */ jsxRuntime.jsx("div", { children: p }, p)),
        b.payload.paths.length > 20 ? /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
          "…共 ",
          b.payload.paths.length,
          " 个文件"
        ] }) : null
      ] }),
      decided ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11.5, color: "var(--c-text3)" }, children: decided === "ok" ? "✓ 已批准" : decided === "rule" ? "✓ 已批准并记住前缀" : "✕ 已拒绝" }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }, children: options.map((o, i) => /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            onClick: () => {
              props.onSel(b.requestId, i);
              if (o.reply.fullAccess) props.onFullAccess(b.requestId);
              else if (o.reply.rulePrefix !== void 0 && o.reply.rulePrefix !== null && o.reply.ok) props.onReply(b.requestId, true, true, o.reply.rulePrefix);
              else props.onReply(b.requestId, o.reply.ok, o.reply.remember);
            },
            style: { display: "flex", gap: 8, padding: "4px 10px", borderRadius: 8, cursor: "pointer", border: `1px solid ${sel === i ? "var(--c-border)" : "transparent"}`, background: sel === i ? "var(--c-panel)" : "transparent" },
            children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: sel === i ? "var(--c-text)" : "transparent", width: 12 }, children: sel === i ? "❯" : "" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: o.label })
            ]
          },
          o.label
        )) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 10.5, marginTop: 6 }, children: "↑↓ 选择 · Enter 确认 · 数字直选 · 选择结果会回给 agent 继续工作" })
      ] })
    ] });
  }
  function QuestionCard(props) {
    const { b, decided, onAnswer } = props;
    const [text, setText] = react.useState("");
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { border: `2px dashed ${decided ? "var(--c-border)" : "var(--c-accent)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 700, opacity: decided ? 0.65 : 1 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, marginBottom: 4 }, children: [
        "? ",
        b.question
      ] }),
      decided ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11.5, color: "var(--c-text3)" }, children: [
        "已回答：",
        decided
      ] }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        b.options.length > 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }, children: b.options.map((o, i) => /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => onAnswer(b.requestId, void 0, i), children: o }, o)) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "input",
              style: { flex: 1 },
              placeholder: "自由回答…（Enter 发送）",
              value: text,
              onChange: (e) => setText(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter" && text.trim()) onAnswer(b.requestId, text.trim());
              }
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !text.trim(), onClick: () => onAnswer(b.requestId, text.trim()), children: "回答" })
        ] })
      ] })
    ] });
  }
  function PlanCard(props) {
    const { b, decided, onPlan } = props;
    const [text, setText] = react.useState("");
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { border: `1px solid ${decided ? "var(--c-border)" : "var(--c-chip-purple-fg, #b490ff)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 720, opacity: decided ? 0.75 : 1 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-chip-purple-fg, #b490ff)", fontWeight: 700, marginBottom: 6 }, children: [
        "◇ 执行计划",
        decided ? decided === "ok" ? " · 已批准" : " · 需修订" : ""
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "md-body", dangerouslySetInnerHTML: { __html: renderMarkdown(b.plan) } }),
      decided ? null : /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }, children: [
        [
          { label: "1. 批准并开始执行", act: () => onPlan(b.requestId, true) },
          { label: "2. 批准，执行时逐项确认", act: () => onPlan(b.requestId, true) }
        ].map((o) => /* @__PURE__ */ jsxRuntime.jsx("div", { onClick: o.act, style: { display: "flex", gap: 8, padding: "4px 10px", borderRadius: 8, cursor: "pointer", background: "var(--c-panel)" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { children: o.label }) }, o.label)),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, padding: "4px 10px" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { flex: 1, minWidth: 160 }, placeholder: "修改意见（可选）…", value: text, onChange: (e) => setText(e.target.value) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => onPlan(b.requestId, false, text.trim() || void 0), children: "继续规划" })
        ] })
      ] })
    ] });
  }
  function SubtaskBlock({ b, ctx }) {
    const [open, setOpen] = react.useState(b.state === "running");
    const stateColor = b.state === "running" ? "var(--c-amber)" : b.state === "completed" ? "var(--c-green)" : "var(--c-red)";
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { border: "1px solid var(--c-border)", borderRadius: 10, padding: "6px 10px", minWidth: 0 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", cursor: "pointer", flexWrap: "wrap" }, onClick: () => setOpen(!open), children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: stateColor }, children: b.state === "running" ? "◐" : "▣" }),
        /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 12.5 }, children: b.name || "子代理" }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { fontSize: 10.5, color: stateColor, border: `1px solid ${stateColor}`, borderRadius: 4, padding: "0 4px" }, children: [
          b.mode,
          " · ",
          b.state
        ] }),
        b.durationMs !== void 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: [
          Math.round(b.durationMs / 100) / 10,
          "s"
        ] }) : null,
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 10.5, marginLeft: "auto" }, children: open ? "收起" : "展开" })
      ] }),
      open && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginTop: 6, borderLeft: "1px solid var(--c-border)", paddingLeft: 10, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }, children: [
        (ctx == null ? void 0 : ctx.renderChildren) ? ctx.renderChildren(b.children) : null,
        b.final && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "md-body", dangerouslySetInnerHTML: { __html: renderMarkdown(b.final) } })
      ] })
    ] });
  }
  function groupLogs(blocks) {
    const out = [];
    let run = [];
    const flush = () => {
      if (run.length === 0) return;
      if (run.length >= 3) out.push({ kind: "logs", items: run });
      else for (const b of run) out.push({ kind: "block", block: b });
      run = [];
    };
    for (const b of blocks) {
      if (b.kind === "log") run.push(b);
      else {
        flush();
        out.push({ kind: "block", block: b });
      }
    }
    flush();
    return out;
  }
  const BUILTIN_TIMELINE_RENDERERS = [
    {
      blockKind: "human",
      render: ({ block }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { borderLeft: "1px solid var(--c-green)", padding: "5px 12px", background: "rgba(126,231,135,.05)", borderRadius: "0 8px 8px 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-green)", fontSize: 11, marginBottom: 2 }, children: "▸ 你" }),
          b.text
        ] });
      }
    },
    {
      blockKind: "assistant",
      render: ({ block }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "md-body", style: { padding: "0 4px" }, dangerouslySetInnerHTML: { __html: renderMarkdown(b.text) } });
      }
    },
    {
      blockKind: "status",
      render: ({ block }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11.5, color: "var(--c-text3)" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", style: { marginRight: 6 }, children: "●" }),
          b.text
        ] });
      }
    },
    {
      blockKind: "tool",
      render: ({ block }) => /* @__PURE__ */ jsxRuntime.jsx(ToolCard, { b: block })
    },
    {
      blockKind: "checkpoint",
      render: ({ block }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--c-text3)", fontSize: 12, fontFamily: "var(--mono, monospace)" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text)" }, children: "✔" }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            "cp ",
            b.sha.slice(0, 8)
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text)", fontFamily: "inherit", overflowWrap: "anywhere" }, children: b.summary }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 10.5 }, children: "· Esc×2 可回滚" })
        ] });
      }
    },
    {
      blockKind: "file",
      render: ({ block, ctx }) => {
        const b = block;
        if (b.changeKind === "read-image") return /* @__PURE__ */ jsxRuntime.jsx("div", { children: /* @__PURE__ */ jsxRuntime.jsx(AgentImage, { taskId: (ctx == null ? void 0 : ctx.taskId) ?? "", path: b.path }) });
        const color = b.changeKind === "deleted" ? "var(--c-red)" : b.changeKind === "added" ? "var(--c-green)" : "var(--c-amber)";
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 12, color, overflowWrap: "anywhere" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", style: { marginRight: 6 }, children: b.changeKind === "deleted" ? "−" : "+" }),
          b.path,
          b.summary ? ` (${b.summary})` : "",
          (ctx == null ? void 0 : ctx.viewFile) && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: { fontSize: 10.5, marginLeft: 8, padding: "0 6px" }, onClick: () => {
            var _a2;
            return (_a2 = ctx.viewFile) == null ? void 0 : _a2.call(ctx, b.path);
          }, children: "查看" }),
          (ctx == null ? void 0 : ctx.previewFile) && b.changeKind !== "deleted" && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: { fontSize: 10.5, marginLeft: 4, padding: "0 6px" }, onClick: () => {
            var _a2;
            return (_a2 = ctx.previewFile) == null ? void 0 : _a2.call(ctx, b.path);
          }, children: "预览" })
        ] });
      }
    },
    {
      blockKind: "todo",
      render: ({ block }) => /* @__PURE__ */ jsxRuntime.jsx(TodoList, { todos: block.todos })
    },
    {
      blockKind: "subtask",
      render: ({ block, ctx }) => /* @__PURE__ */ jsxRuntime.jsx(SubtaskBlock, { b: block, ctx })
    },
    {
      blockKind: "turn",
      render: ({ block, ctx }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)", display: "flex", gap: 14, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            "⎡ ",
            b.text
          ] }),
          b.usage ? /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            (((b.usage.input ?? 0) + (b.usage.output ?? 0)) / 1e3).toFixed(1),
            "k tokens（",
            b.usage.input ?? "?",
            " in / ",
            b.usage.output ?? "?",
            " out）"
          ] }) : null,
          (ctx == null ? void 0 : ctx.contextPct) ? /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            "context ",
            ctx.contextPct
          ] }) : null
        ] });
      }
    },
    {
      blockKind: "log",
      render: ({ block }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11, color: b.level === "error" ? "var(--c-red)" : b.level === "warn" ? "var(--c-amber)" : "var(--c-text3)", overflowWrap: "anywhere" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", style: { marginRight: 6 }, children: "·" }),
          b.text
        ] });
      }
    }
  ];
  const BUILTIN_COMPOSER_PROVIDERS = [
    {
      prefix: "@",
      label: "文件",
      source: async (query) => {
        const files = await call("repo.files", { query });
        return files.map((f) => ({ label: f, insert: f }));
      }
    }
  ];
  let builtinAgentUIDone = false;
  function registerBuiltinAgentUI() {
    if (builtinAgentUIDone || typeof window === "undefined" || !window.GITTER_UI) return;
    builtinAgentUIDone = true;
    registerAgentUI({ timelineRenderers: BUILTIN_TIMELINE_RENDERERS, composerProviders: BUILTIN_COMPOSER_PROVIDERS });
  }
  registerBuiltinAgentUI();
  function TasksPage() {
    var _a2, _b2, _c;
    const app = useAppState();
    const repo = app.repo;
    const [worktrees, setWorktrees] = react.useState(null);
    const [harnesses, setHarnesses] = react.useState(null);
    const [agentTasks, setAgentTasks] = react.useState(null);
    const [taskTypes, setTaskTypes] = react.useState([]);
    const [modelProfiles, setModelProfiles] = react.useState([]);
    const [taskTypeId, setTaskTypeId] = react.useState("");
    const [modelId, setModelId] = react.useState("");
    const [mode, setMode] = react.useState("default");
    const [tab, setTab] = react.useState("chat");
    const [evMap, setEvMap] = react.useState({});
    const [selectedTask, setSelectedTask] = react.useState(null);
    const [focusTaskId, consumeTaskFocus] = useTaskFocus();
    react.useEffect(() => {
      if (!focusTaskId) return;
      setSelectedTask(focusTaskId);
      consumeTaskFocus();
    }, [focusTaskId]);
    const [error, setError] = react.useState(null);
    const [inputText, setInputText] = react.useState("");
    const [composeText, setComposeText] = react.useState("");
    const [thinking, setThinking] = react.useState("medium");
    const [sending, setSending] = react.useState(false);
    const [decided, setDecided] = react.useState({});
    const [stats, setStats] = react.useState(null);
    const [changesTick, setChangesTick] = react.useState(0);
    const [mention, setMention] = react.useState(null);
    const [mentionItems, setMentionItems] = react.useState([]);
    const [pkgCommands, setPkgCommands] = react.useState([]);
    const [permSel, setPermSel] = react.useState({});
    const [maxSubagents, setMaxSubagents] = react.useState(3);
    const [hasMoreHistory, setHasMoreHistory] = react.useState(false);
    const [loadingOlder, setLoadingOlder] = react.useState(false);
    const [pendingFile, setPendingFile] = react.useState(null);
    const [pendingImages, setPendingImages] = react.useState([]);
    const addImages = react.useCallback((files) => {
      setPendingImages((cur) => {
        const next = [...cur, ...files].slice(0, 4);
        return next;
      });
    }, []);
    const filesToImages = react.useCallback((files) => {
      const imgs = files.filter((f) => /^image\//.test(f.type)).slice(0, 4);
      for (const f of imgs) {
        if (f.size > 4 * 1024 * 1024) {
          setError(`图片超过 4MB 上限：${f.name}`);
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => addImages([{ name: f.name || "image.png", dataUrl: String(reader.result) }]);
        reader.readAsDataURL(f);
      }
    }, [addImages]);
    const [preview, setPreview] = react.useState(null);
    const [previewLoading, setPreviewLoading] = react.useState(false);
    const previewFile = react.useCallback((path) => {
      if (!selectedTask) return;
      setPreviewLoading(true);
      setPreview({ path, content: "", truncated: false, binary: false, size: 0 });
      void call("agent.task.previewFile", { taskId: selectedTask, path }).then((r) => setPreview({ path, ...r })).catch((e) => setPreview({ path, content: `（读取失败：${e.message}）`, truncated: false, binary: false, size: 0 })).finally(() => setPreviewLoading(false));
    }, [selectedTask]);
    const [cpCount, setCpCount] = react.useState(0);
    const [diffCount, setDiffCount] = react.useState(0);
    const timelineRef = react.useRef(null);
    react.useRef(/* @__PURE__ */ new Set());
    const inputHistory = react.useRef([]);
    const historyIdx = react.useRef(-1);
    const escTs = react.useRef(0);
    const oldestTs = react.useRef(null);
    const [, forceTick] = react.useState(0);
    useAgentUIVersion();
    registerBuiltinAgentUI();
    const scrollTimelineToBottom = react.useCallback(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = timelineRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }));
    }, []);
    const reloadWorktrees = react.useCallback(async () => {
      if (!repo) return;
      try {
        setWorktrees(await call("tasks.list"));
      } catch (e) {
        setError(e.message);
      }
    }, [repo]);
    const reloadAgents = react.useCallback(async () => {
      if (!repo) return;
      try {
        setHarnesses(await call("agents.list"));
        setAgentTasks(await call("agent.tasks"));
        setTaskTypes(await call("agent.taskTypes.list"));
        setModelProfiles(await call("models.list"));
        const cmds = await call("commands.list");
        setPkgCommands(
          cmds.filter((c) => c.action === "agent.command").map((c) => {
            var _a3;
            const a = c.args ?? {};
            const short = ((_a3 = c.packageId) == null ? void 0 : _a3.split(".").pop()) ?? "pkg";
            return { name: `${short}:${a.slash ?? c.id}`, template: a.template ?? "${input}", packageId: c.packageId ?? "" };
          })
        );
      } catch (e) {
        setError(e.message);
      }
    }, [repo]);
    react.useEffect(() => {
      void reloadWorktrees();
      void reloadAgents();
    }, [repo, app.refreshTick, reloadWorktrees, reloadAgents]);
    react.useEffect(() => {
      void call("settings.get").then((s) => {
        if (s == null ? void 0 : s.agentsMaxSubagents) setMaxSubagents(s.agentsMaxSubagents);
      }).catch(() => {
      });
    }, []);
    react.useEffect(
      () => onEvent("agent.event", (p) => {
        const { taskId, event } = p;
        setEvMap((m) => ({ ...m, [taskId]: reduceBlocks(m[taskId] ?? [], event) }));
        if (event.type === "turn-completed" || event.type === "completed") {
          void reloadAgents();
          setChangesTick((n) => n + 1);
        }
        if (event.type === "file-change") setChangesTick((n) => n + 1);
      }),
      [reloadAgents]
    );
    react.useEffect(
      () => onEvent("agent.tasks.changed", () => void reloadAgents()),
      [reloadAgents]
    );
    const selected = (agentTasks == null ? void 0 : agentTasks.find((x) => x.taskId === selectedTask)) ?? null;
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
    react.useEffect(() => {
      if (!selectedTask) return;
      let cancelled = false;
      const pull = () => {
        void call("agent.context.stats", { taskId: selectedTask }).then((s) => {
          if (!cancelled && s) setStats(s);
        }).catch(() => {
        });
      };
      pull();
      const iv = setInterval(pull, 5e3);
      return () => {
        cancelled = true;
        clearInterval(iv);
      };
    }, [selectedTask, changesTick]);
    react.useEffect(() => {
      if (!runningTool) return;
      const iv = setInterval(() => forceTick((n) => n + 1), 1e3);
      return () => clearInterval(iv);
    }, [runningTool]);
    const eventsToBlocks = (events) => {
      let blocks = [];
      for (const je of events) {
        if (je.kind === "text") blocks = pushCap(blocks, { kind: "human", text: je.text ?? "" });
        else blocks = reduceBlocks(blocks, je.event);
      }
      return blocks;
    };
    react.useEffect(() => {
      if (!selectedTask) return;
      if ((evMap[selectedTask] ?? []).length > 0) return;
      let cancelled = false;
      void call(
        "agent.task.history",
        { taskId: selectedTask, limit: 300 }
      ).then((h) => {
        var _a3;
        if (cancelled) return;
        const blocks = eventsToBlocks(h.events);
        oldestTs.current = ((_a3 = h.events[0]) == null ? void 0 : _a3.ts) ?? null;
        setEvMap((m) => {
          var _a4;
          return ((_a4 = m[selectedTask]) == null ? void 0 : _a4.length) ? m : { ...m, [selectedTask]: blocks };
        });
        setHasMoreHistory(!!h.hasMore);
        scrollTimelineToBottom();
      }).catch(() => {
      });
      return () => {
        cancelled = true;
      };
    }, [selectedTask, evMap, scrollTimelineToBottom]);
    const loadOlder = async () => {
      var _a3;
      if (!selectedTask || loadingOlder || !oldestTs.current) return;
      setLoadingOlder(true);
      try {
        const h = await call(
          "agent.task.history",
          { taskId: selectedTask, before: oldestTs.current, limit: 200 }
        );
        const older = eventsToBlocks(h.events);
        if ((_a3 = h.events[0]) == null ? void 0 : _a3.ts) oldestTs.current = h.events[0].ts;
        setHasMoreHistory(!!h.hasMore);
        if (older.length > 0) setEvMap((m) => ({ ...m, [selectedTask]: [...older, ...m[selectedTask] ?? []] }));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingOlder(false);
      }
    };
    react.useEffect(() => {
      scrollTimelineToBottom();
    }, [evMap, selectedTask, scrollTimelineToBottom]);
    react.useEffect(() => {
      const h = (e) => {
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
    const replyPerm = react.useCallback(async (requestId, ok, remember, rulePrefix) => {
      setDecided((d) => ({ ...d, [requestId]: ok ? rulePrefix ? "rule" : "ok" : "deny" }));
      try {
        if (rulePrefix) {
          const tool = (evMap[selectedTask ?? ""] ?? []).find((b) => b.kind === "permission" && b.requestId === requestId);
          const ruleTool = tool && tool.kind === "permission" ? tool.toolName : "";
          const s = await call("settings.get");
          const rules = [
            ...s.agentRules ?? [],
            { id: `rule-${Date.now().toString(36)}`, tool: ruleTool, pattern: rulePrefix, effect: "allow", scope: "global", createdAt: (/* @__PURE__ */ new Date()).toISOString() }
          ];
          await call("settings.set", { agentRules: rules });
          await call("agent.perm.reply", { requestId, ok: true, remember: true });
        } else {
          await call("agent.perm.reply", { requestId, ok, remember });
        }
      } catch (e) {
        setError(e.message);
      }
    }, [selectedTask, evMap]);
    const replyFullAccess = react.useCallback(async (requestId) => {
      if (!selected) return;
      setDecided((d) => ({ ...d, [requestId]: "ok" }));
      try {
        await call("agent.perm.reply", { requestId, ok: true, remember: true });
        await call("agent.task.setMode", { taskId: selected.taskId, mode: "yolo" });
        setMode("yolo");
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      }
    }, [selected, reloadAgents]);
    const showFullAccess = ((selected == null ? void 0 : selected.permissionMode) ?? "default") !== "yolo";
    react.useEffect(() => {
      if (!pendingPerm || !selectedTask) return;
      const requestId = pendingPerm.requestId;
      const opts = permOptions(pendingPerm, showFullAccess);
      const h = (e) => {
        var _a3;
        const tag = (_a3 = e.target) == null ? void 0 : _a3.tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        const cur = permSel[requestId] ?? 0;
        const apply = (idx) => {
          const o = opts[Math.min(idx, opts.length - 1)];
          if (o.reply.fullAccess) void replyFullAccess(requestId);
          else if (o.reply.rulePrefix !== void 0 && o.reply.rulePrefix !== null && o.reply.ok) replyPerm(requestId, true, true, o.reply.rulePrefix);
          else replyPerm(requestId, o.reply.ok, o.reply.remember);
        };
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPermSel((m) => ({ ...m, [requestId]: Math.min(cur + 1, opts.length - 1) }));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setPermSel((m) => ({ ...m, [requestId]: Math.max(cur - 1, 0) }));
        } else if (e.key === "Enter") {
          e.preventDefault();
          apply(cur);
        } else if (/^[1-9]$/.test(e.key)) {
          const idx = parseInt(e.key, 10) - 1;
          if (idx < opts.length) {
            e.preventDefault();
            apply(idx);
          }
        }
      };
      window.addEventListener("keydown", h);
      return () => window.removeEventListener("keydown", h);
    }, [pendingPerm, selectedTask, permSel, replyPerm, replyFullAccess, showFullAccess]);
    const cycleMode = react.useCallback(() => {
      if (!selected) return;
      const cur = selected.permissionMode ?? "default";
      const next = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
      void call("agent.task.setMode", { taskId: selected.taskId, mode: next }).then(reloadAgents).catch((e) => setError(e.message));
    }, [selected, reloadAgents]);
    react.useEffect(() => {
      const h = (e) => {
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          cycleMode();
        }
      };
      window.addEventListener("keydown", h);
      return () => window.removeEventListener("keydown", h);
    }, [cycleMode]);
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "🗂" }),
        t("Common_NoProjectSelected")
      ] });
    }
    const timeline = selectedTask ? evMap[selectedTask] ?? [] : [];
    const modelInfo = (_a2 = harnesses == null ? void 0 : harnesses[0]) == null ? void 0 : _a2.detect;
    const todoProgress = (tk) => {
      const todos = tk.todoState ?? [];
      if (todos.length === 0) return null;
      return `☑${todos.filter((x) => x.status === "completed").length}/${todos.length}`;
    };
    const replyAnswer = async (requestId, answer, optionIndex) => {
      setDecided((d) => ({ ...d, [requestId]: answer ?? `#${(optionIndex ?? 0) + 1}` }));
      try {
        await call("agent.perm.reply", { requestId, ok: true, answer, optionIndex });
      } catch (e) {
        setError(e.message);
      }
    };
    const replyPlan = async (requestId, ok, feedback) => {
      setDecided((d) => ({ ...d, [requestId]: ok ? "ok" : "revised" }));
      try {
        await call("agent.perm.reply", { requestId, ok, answer: feedback });
      } catch (e) {
        setError(e.message);
      }
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
              try {
                await call("agent.task.export", { taskId: selected.taskId });
              } catch (err) {
                setError(err.message);
              }
              setInputText("");
              return;
            }
            if (builtin.template) {
              const expanded = builtin.template.replace(/\$\{input\}/g, arg);
              if (BUSY_STATES.has(selected.state)) await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded });
              else await call("agent.task.resume", { taskId: selected.taskId, prompt: expanded, thinking, mode });
              setInputText("");
              return;
            }
            if (name === "compact") await call("agent.task.compact", { taskId: selected.taskId });
            else if (name === "clear") await call("agent.task.clear", { taskId: selected.taskId });
            else if (name === "plan" || name === "default" || name === "yolo" || name === "approvals") {
              const m = name === "approvals" ? MODE_ORDER[(MODE_ORDER.indexOf(selected.permissionMode ?? "default") + 1) % MODE_ORDER.length] : name;
              await call("agent.task.setMode", { taskId: selected.taskId, mode: m });
              setMode(m);
            } else if (name === "stop") await call("agent.task.stop", { taskId: selected.taskId });
            else if (name === "model") {
              const id = arg || (selected.modelRef ?? "");
              await call("agent.task.setModel", { taskId: selected.taskId, model: id });
            } else if (name === "thinking") {
              const v = arg;
              if (["off", "low", "medium", "high"].includes(v)) {
                setThinking(v);
                if (!BUSY_STATES.has(selected.state)) await call("agent.task.resume", { taskId: selected.taskId, prompt: `（思考深度切换为 ${v}，继续当前任务）`, thinking: v, mode });
              } else setError("/thinking 用法：/thinking off|low|medium|high");
            } else if (name === "fork") {
              const forked = await call("agent.task.fork", { taskId: selected.taskId, model: arg || void 0 });
              setSelectedTask(forked.taskId);
              await reloadAgents();
            } else if (name === "skill") {
              const skills = await call("skills.list");
              const target = arg ? skills.find((s) => s.id.endsWith(`.${arg}`) || s.name === arg || s.id === arg) : void 0;
              if (!arg) setError(`可用技能：${skills.map((s) => s.name).join("、") || "（无）"}——用法 /skill <名称>`);
              else if (!target) setError(`未找到技能 ${arg}`);
              else if (BUSY_STATES.has(selected.state)) setError("agent 运行中，请在轮次结束后注入技能");
              else await call("agent.task.resume", { taskId: selected.taskId, prompt: `<system-reminder>
请应用以下技能指引继续工作：

${target.instructions}
</system-reminder>`, thinking, mode });
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
        } catch (e) {
          setError(e.message);
        }
        setInputText("");
        return;
      }
      if (pendingImages.length > 0 && !visionOk) {
        setError("当前模型档案未声明视觉（vision）能力，无法发送图片——请在 设置 → 模型档案 勾选「视觉」");
        return;
      }
      inputHistory.current = [text, ...inputHistory.current.filter((x) => x !== text)].slice(0, 20);
      historyIdx.current = -1;
      setEvMap((m) => ({ ...m, [selected.taskId]: pushCap(m[selected.taskId] ?? [], { kind: "human", text }) }));
      setInputText("");
      setSending(true);
      const attachments = attachmentsPayload;
      setPendingImages([]);
      const busy2 = BUSY_STATES.has(selected.state);
      try {
        if (busy2) {
          if (attachments.length > 0) setError("任务运行中：图片将不随排队消息注入，请等本轮结束再发送");
          await call("agent.task.queue", { taskId: selected.taskId, prompt: text });
        } else {
          await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking, mode, ...attachments.length > 0 ? { attachments } : {} });
        }
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      } finally {
        setSending(false);
      }
    };
    const createFromCompose = async () => {
      var _a3;
      if (!composeText.trim() || sending) return;
      setSending(true);
      try {
        if (pendingImages.length > 0) {
          const chosen = modelProfiles.find((m) => m.id === modelId) ?? modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
          if (((_a3 = chosen == null ? void 0 : chosen.capabilities) == null ? void 0 : _a3.vision) !== true) {
            setError("所选模型档案未声明视觉（vision）能力，无法带图创建任务");
            return;
          }
        }
        const record = await call("agent.task.create", {
          prompt: composeText.trim(),
          taskType: taskTypeId || void 0,
          model: modelId || void 0,
          thinking,
          mode,
          ...pendingImages.length > 0 ? { attachments: attachmentsPayload } : {}
        });
        setComposeText("");
        setPendingImages([]);
        setSelectedTask(record.taskId);
        setEvMap((m) => ({ ...m, [record.taskId]: [{ kind: "human", text: composeText.trim() }] }));
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      } finally {
        setSending(false);
      }
    };
    const stopTask = async (taskId) => {
      try {
        await call("agent.task.stop", { taskId });
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      }
    };
    const onComposeChange = (value, setter) => {
      setter(value);
      const el = document.activeElement;
      const caret = (el == null ? void 0 : el.selectionStart) ?? value.length;
      const before = value.slice(0, caret);
      const providers = [...composerProviders()].sort((a, b) => b.prefix.length - a.prefix.length);
      if (providers.length === 0) {
        setMention(null);
        return;
      }
      const esc = providers.map((x) => x.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const m = new RegExp(`(^|\\s)(${esc})([\\w./\\-]*)$`).exec(before);
      if (!m) {
        setMention(null);
        return;
      }
      const prefix = m[2];
      const query = m[3];
      setMention({ start: caret - query.length, prefix, query });
      const provider = providers.find((x) => x.prefix === prefix);
      if (!provider) {
        setMentionItems([]);
        return;
      }
      void Promise.resolve(provider.source(query).catch(() => [])).then((items) => {
        if (prefix !== "@") {
          setMentionItems(items.slice(0, 50));
          return;
        }
        const q = query.toLowerCase();
        const taskItems = (agentTasks ?? []).filter((t2) => t2.taskId !== (selected == null ? void 0 : selected.taskId)).filter((t2) => !q || t2.title.toLowerCase().includes(q) || t2.taskId.startsWith(query)).slice(0, 6).map((t2) => ({ label: `任务：${t2.title}`, insert: t2.taskId.slice(0, 8) }));
        setMentionItems([...taskItems, ...items].slice(0, 50));
      });
    };
    const insertMention = (insert, setter, current) => {
      if (!mention) return;
      const next = current.slice(0, mention.start) + insert + " " + current.slice(mention.start + mention.query.length);
      setter(next);
      setMention(null);
    };
    const renderBlock = (b, key) => {
      switch (b.kind) {
        case "permission":
          return /* @__PURE__ */ jsxRuntime.jsx(PermissionCard, { b, decided: decided[b.requestId], sel: permSel[b.requestId] ?? 0, showFullAccess, onSel: (id, i) => setPermSel((m) => ({ ...m, [id]: i })), onReply: replyPerm, onFullAccess: (id) => void replyFullAccess(id) }, key);
        case "question":
          return /* @__PURE__ */ jsxRuntime.jsx(QuestionCard, { b, decided: decided[b.requestId], onAnswer: replyAnswer }, key);
        case "plan":
          return /* @__PURE__ */ jsxRuntime.jsx(PlanCard, { b, decided: decided[b.requestId], onPlan: replyPlan }, key);
      }
      const renderer = resolveTimelineRenderer(b.kind === "tool" ? b.name : void 0, b.kind);
      if (!renderer) return null;
      const ctx = {
        taskId: selectedTask ?? "",
        viewFile: (path) => {
          setPendingFile(path);
          setTab("diff");
        },
        previewFile,
        contextPct: stats ? `${Math.round(stats.ratio * 100)}%` : void 0,
        renderChildren: (children) => /* @__PURE__ */ jsxRuntime.jsx(react.Fragment, { children: children.map((c, i) => renderBlock(c, `${key}-${i}`)) })
      };
      return /* @__PURE__ */ jsxRuntime.jsx(react.Fragment, { children: renderer.render({ block: b, taskId: ctx.taskId ?? "", ctx }) }, key);
    };
    const agentCard = (task) => {
      var _a3;
      const live = LIVE_STATES.has(task.state);
      const selectedNow = selectedTask === task.taskId;
      const dotColor = task.state === "failed" ? "var(--c-red)" : task.state === "completed" || task.state === "stopped" ? "var(--c-text3)" : task.permissionMode === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-green)";
      const working = task.state === "working" || task.state === "starting";
      return /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          onClick: () => {
            setSelectedTask(selectedNow ? null : task.taskId);
            setTab("chat");
            setThinking(task.thinking ?? "medium");
            setMode(task.permissionMode ?? "default");
          },
          style: { border: `1px solid ${selectedNow ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 10, padding: "8px 11px", cursor: "pointer", background: "var(--c-panel)" },
          children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 7 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { width: 7, height: 7, borderRadius: "50%", background: dotColor, opacity: working ? 1 : 0.85 } }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600 }, children: task.title })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, marginTop: 3, display: "flex", gap: 8 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: task.branch }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                "· ",
                new Date(task.lastActiveAt ?? task.createdAt).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
              ] }),
              (((_a3 = task.queued) == null ? void 0 : _a3.length) ?? 0) > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-amber)" }, children: [
                "· ⏳排队 ",
                task.queued.length
              ] }) : null,
              task.permissionMode && task.permissionMode !== "default" ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: MODE_META[task.permissionMode].color }, children: [
                "· ",
                MODE_META[task.permissionMode].label
              ] }) : null
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
              stateChip(task.state).label.replace("● ", ""),
              " · ",
              task.lastMessage ?? task.worktreePath,
              todoProgress(task) ? ` · ${todoProgress(task)}` : ""
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, marginTop: 6 }, onClick: (e) => e.stopPropagation(), children: [
              live && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void stopTask(task.taskId), children: "停止" }),
              !live && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => {
                setSelectedTask(task.taskId);
                setTab("chat");
                setInputText("");
              }, children: "续跑" }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: task.worktreePath }), children: "新窗口" })
            ] })
          ]
        },
        task.taskId
      );
    };
    const busy = selected ? BUSY_STATES.has(selected.state) : false;
    const activeProfile = modelProfiles.find((m) => m.id === ((selected == null ? void 0 : selected.modelRef) ?? "")) ?? modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
    const visionOk = ((_b2 = activeProfile == null ? void 0 : activeProfile.capabilities) == null ? void 0 : _b2.vision) === true;
    const attachmentsPayload = pendingImages.map((img) => ({ name: img.name, dataBase64: img.dataUrl }));
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", flex: 1, minHeight: 0, height: "100%" }, children: [
      preview && /* @__PURE__ */ jsxRuntime.jsxs(Modal, { title: `预览：${preview.path}`, confirmText: "关闭", onConfirm: () => setPreview(null), onClose: () => setPreview(null), children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11, color: "var(--c-text3)", marginBottom: 6 }, children: previewLoading ? "加载中…" : `${preview.binary ? "二进制文件" : `${(preview.size / 1024).toFixed(1)} KB`}${preview.truncated ? " · 已截断（前 64KB）" : ""}` }),
        /* @__PURE__ */ jsxRuntime.jsx("pre", { style: { maxHeight: 420, overflow: "auto", background: "var(--c-panel2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, fontFamily: "var(--mono, monospace)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }, children: preview.content })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }, children: [
        error && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: error }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setError(null), children: "✕" })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { onClick: () => {
          setSelectedTask(null);
          setTab("chat");
        }, style: { margin: "10px 10px 6px", padding: "9px 12px", border: "2px dashed var(--c-border)", borderRadius: 8, color: "var(--c-text3)", textAlign: "center", cursor: "pointer", fontSize: 12.5 }, children: "＋ 新任务（描述目标，Ctrl+N）" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }, children: [
          ((agentTasks == null ? void 0 : agentTasks.length) ?? 0) === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 12, color: "var(--c-text3)", padding: "4px 2px" }, children: t("Agents_EmptyHint") }),
          agentTasks == null ? void 0 : agentTasks.map(agentCard)
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", gap: 2, padding: "6px 14px 0", borderBottom: "1px solid var(--c-border)" }, children: [["chat", "对话"], ["diff", `改动${diffCount ? ` ${diffCount}` : ""}`], ["cp", `检查点${cpCount ? ` ${cpCount}` : ""}`]].map(([id, label]) => /* @__PURE__ */ jsxRuntime.jsx(
          "div",
          {
            onClick: () => setTab(id),
            style: { padding: "5px 14px", fontSize: 12.5, color: tab === id ? "var(--c-text)" : "var(--c-text3)", cursor: "pointer", border: `1px solid ${tab === id ? "var(--c-border)" : "transparent"}`, borderBottom: "none", borderRadius: "8px 8px 0 0" },
            children: label
          },
          id
        )) }),
        tab === "chat" && selected && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { fontSize: 11.5, padding: "1px 10px", borderRadius: 999, border: `1px solid ${stateChip(selected.state).color}`, color: stateChip(selected.state).color }, children: [
              stateChip(selected.state).label,
              busy && selected.lastActiveAt ? " · " + Math.max(0, Math.round((Date.now() - new Date(selected.lastActiveAt).getTime()) / 1e3)) + "s" : ""
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 11.5, fontFamily: "var(--mono, monospace)" }, children: selected.branch }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: selected.worktreePath }), children: "送验收" }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: selected.worktreePath }), children: "新窗口" })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "div",
            {
              ref: timelineRef,
              style: { flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "hidden" },
              onDoubleClick: (e) => {
                var _a3;
                const pre = e.target.closest("pre");
                if (pre) void ((_a3 = navigator.clipboard) == null ? void 0 : _a3.writeText(pre.textContent ?? ""));
              },
              children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { maxWidth: 880, margin: "0 auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }, children: [
                hasMoreHistory && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: { alignSelf: "center", fontSize: 11 }, disabled: loadingOlder, onClick: () => void loadOlder(), children: loadingOlder ? "加载中…" : "加载更早" }),
                timeline.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Agents_TimelineEmpty") }),
                groupLogs(timeline).map(
                  (g, i) => g.kind === "logs" ? /* @__PURE__ */ jsxRuntime.jsxs("details", { style: { fontSize: 11 }, children: [
                    /* @__PURE__ */ jsxRuntime.jsxs("summary", { style: { cursor: "pointer", color: "var(--c-text3)" }, children: [
                      "▸ 显示 ",
                      g.items.length,
                      " 条日志"
                    ] }),
                    /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }, children: g.items.map((b, j) => renderBlock(b, `${i}-${j}`)) })
                  ] }, i) : renderBlock(g.block, i)
                )
              ] })
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { borderTop: "1px solid var(--c-border)", padding: "4px 20px 2px" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { maxWidth: 880, margin: "0 auto", display: "flex", gap: 16, rowGap: 2, flexWrap: "wrap", color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)" }, children: [
            runningTool ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-amber)" }, children: [
              "● ",
              TOOL_LABELS[runningTool.name] ?? runningTool.name,
              " 运行中 ",
              ((Date.now() - runningTool.startTs) / 1e3).toFixed(1),
              "s"
            ] }) : /* @__PURE__ */ jsxRuntime.jsx("span", { children: "○ 空闲" }),
            (((_c = selected.queued) == null ? void 0 : _c.length) ?? 0) > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-amber)" }, children: [
              "⏳ 排队 ",
              selected.queued.length
            ] }) : null,
            /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
              "子代理 ",
              runningSubs,
              "/",
              maxSubagents
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { marginLeft: "auto" }, children: "Esc 中断 · Esc×2 回滚 · Shift+Tab 模式 · ↑↓ 历史" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { borderTop: "1px solid var(--c-border)", padding: "8px 20px 8px" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { maxWidth: 880, margin: "0 auto", position: "relative" }, children: [
            pendingPerm && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginBottom: 8, fontSize: 11.5, color: "var(--c-amber)" }, children: "◈ 等待授权（↑↓+Enter 或数字直选上方卡片选项）" }),
            mention && /* @__PURE__ */ jsxRuntime.jsx(MentionPopover, { mention, items: mentionItems, onPick: (x) => insertMention(x, setInputText, inputText) }),
            pendingImages.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }, children: [
              pendingImages.map((img, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { position: "relative" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("img", { src: img.dataUrl, alt: img.name, style: { width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-border)" } }),
                /* @__PURE__ */ jsxRuntime.jsx(
                  "button",
                  {
                    className: "tool-btn",
                    title: "移除",
                    style: { position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 10 },
                    onClick: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)),
                    children: "✕"
                  }
                )
              ] }, `${img.name}:${i}`)),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", style: { alignSelf: "center" }, children: [
                "图片 ",
                pendingImages.length,
                "/4",
                !visionOk ? " · ⚠ 当前模型未声明视觉能力" : ""
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { border: `1px solid ${inputText.trim() ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 12, padding: "8px 12px 6px" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(
                "textarea",
                {
                  style: { width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--c-text)", font: "13px/1.55 inherit", minHeight: 44, maxHeight: 140 },
                  placeholder: busy ? "agent 正在工作——输入将排队，本轮结束后自动注入（Esc 中断 / Esc×2 回滚）" : "继续对话…输入 / 唤起命令、@ 唤起文件、Shift+Tab 切模式",
                  value: inputText,
                  onChange: (e) => onComposeChange(e.target.value, setInputText),
                  onPaste: (e) => {
                    const files = [...e.clipboardData.files];
                    if (files.some((f) => f.type.startsWith("image/"))) {
                      e.preventDefault();
                      filesToImages(files);
                    }
                  },
                  onDrop: (e) => {
                    const files = [...e.dataTransfer.files];
                    if (files.some((f) => f.type.startsWith("image/"))) {
                      e.preventDefault();
                      filesToImages(files);
                    }
                  },
                  onKeyDown: (e) => {
                    if (e.key === "Escape") {
                      void stopTask(selected.taskId);
                      return;
                    }
                    if (e.key === "Tab" && e.shiftKey) {
                      e.preventDefault();
                      cycleMode();
                      return;
                    }
                    if (e.key === "ArrowUp" && !inputText.includes("\n") && inputHistory.current.length > 0) {
                      historyIdx.current = Math.min(historyIdx.current + 1, inputHistory.current.length - 1);
                      setInputText(inputHistory.current[historyIdx.current] ?? "");
                      e.preventDefault();
                      return;
                    }
                    if (e.key === "ArrowDown" && historyIdx.current >= 0) {
                      historyIdx.current = Math.max(historyIdx.current - 1, -1);
                      setInputText(historyIdx.current === -1 ? "" : inputHistory.current[historyIdx.current] ?? "");
                      e.preventDefault();
                      return;
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void sendInput();
                  }
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap", rowGap: 6 }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", onClick: cycleMode, title: "Shift+Tab 循环", children: MODE_META[selected.permissionMode ?? "default"].label }),
                /* @__PURE__ */ jsxRuntime.jsx(
                  Select,
                  {
                    className: "select-inline",
                    style: { width: 130 },
                    value: selected.modelRef ?? "",
                    disabled: busy && selected.state !== "awaiting-input",
                    onChange: async (v) => {
                      try {
                        await call("agent.task.setModel", { taskId: selected.taskId, model: v });
                        await reloadAgents();
                      } catch (err) {
                        setError(err.message);
                      }
                    },
                    options: [
                      ...(modelProfiles ?? []).filter((m) => m.configured).map((m) => ({ value: m.id, label: m.name + (m.isDefault ? " ★" : "") })),
                      ...selected.modelRef && !(modelProfiles ?? []).some((m) => m.id === selected.modelRef) ? [{ value: selected.modelRef, label: selected.modelRef }] : []
                    ]
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", title: "@ 文件 / @任务 提及", children: "@" }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", title: "粘贴图片附加", onClick: () => setError("当前模型档案未声明多模态能力，图片输入暂不可用"), children: "🖼" }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
                stats && /* @__PURE__ */ jsxRuntime.jsxs(
                  "div",
                  {
                    title: `系统 ${Math.round(stats.breakdown.system)} · 历史 ${Math.round(stats.breakdown.messages)} · 预留 ${Math.round(stats.breakdown.reserved)}${stats.compactions ? ` · 已压缩 ${stats.compactions} 次` : ""}`,
                    style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: stats.ratio > 0.92 ? "var(--c-red)" : stats.ratio > 0.8 ? "var(--c-amber)" : "var(--c-text3)" },
                    children: [
                      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { width: 80, height: 4, borderRadius: 2, background: "var(--c-border)", overflow: "hidden" }, children: /* @__PURE__ */ jsxRuntime.jsx("div", { style: { width: `${Math.min(100, stats.ratio * 100)}%`, height: "100%", background: stats.ratio > 0.92 ? "var(--c-red)" : stats.ratio > 0.8 ? "var(--c-amber)" : "var(--c-text3)" } }) }),
                      /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                        "context ",
                        Math.round(stats.ratio * 100),
                        "% · ",
                        (stats.estTokens / 1e3).toFixed(1),
                        "k"
                      ] }),
                      stats.ratio > 0.8 && /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-amber)" }, children: "· /compact" })
                    ]
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx(
                  "button",
                  {
                    title: busy ? "⏹ 停止（Esc 同效）" : "➤ 发送（Ctrl+Enter 同效）",
                    onClick: () => {
                      if (busy) void stopTask(selected.taskId);
                      else void sendInput();
                    },
                    style: { border: "none", background: "var(--c-text)", color: "var(--c-panel)", borderRadius: 8, width: 30, height: 30, fontSize: 14, cursor: "pointer", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" },
                    children: busy ? "⏹" : "➤"
                  }
                )
              ] })
            ] })
          ] }) })
        ] }),
        tab === "chat" && !selected && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { width: 680, maxWidth: "90%" }, children: [
          modelInfo && !modelInfo.available ? /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "tool-btn", style: { color: "var(--c-amber)", borderColor: "var(--c-amber)", marginBottom: 10 }, onClick: () => openSettings("models"), children: [
            "● ",
            t("Agents_ModelMissing"),
            " → ",
            t("Agents_OpenSettings")
          ] }) : null,
          pendingImages.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }, children: [
            pendingImages.map((img, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { position: "relative" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("img", { src: img.dataUrl, alt: img.name, style: { width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-border)" } }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "tool-btn",
                  title: "移除",
                  style: { position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 10 },
                  onClick: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)),
                  children: "✕"
                }
              )
            ] }, `${img.name}:${i}`)),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", style: { alignSelf: "center" }, children: [
              "图片 ",
              pendingImages.length,
              "/4（随首条消息发送）"
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { border: `1px solid ${composeText.trim() ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 12, padding: "10px 12px 6px", position: "relative" }, children: [
            mention && /* @__PURE__ */ jsxRuntime.jsx(MentionPopover, { mention, items: mentionItems, onPick: (x) => insertMention(x, setComposeText, composeText) }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "textarea",
              {
                autoFocus: true,
                style: { width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--c-text)", font: "13.5px/1.55 inherit", minHeight: 120 },
                placeholder: `${t("Agents_ComposePlaceholder")}
支持 @文件 提及；规划类任务先切「◇ 规划」模式（Shift+Tab）`,
                value: composeText,
                onChange: (e) => onComposeChange(e.target.value, setComposeText),
                onPaste: (e) => {
                  const files = [...e.clipboardData.files];
                  if (files.some((f) => f.type.startsWith("image/"))) {
                    e.preventDefault();
                    filesToImages(files);
                  }
                },
                onDrop: (e) => {
                  const files = [...e.dataTransfer.files];
                  if (files.some((f) => f.type.startsWith("image/"))) {
                    e.preventDefault();
                    filesToImages(files);
                  }
                },
                onKeyDown: (e) => {
                  if (e.key === "Tab" && e.shiftKey) {
                    e.preventDefault();
                    setMode(MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]);
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void createFromCompose();
                }
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap", rowGap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", onClick: () => setMode(MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]), title: "Shift+Tab 循环", children: MODE_META[mode].label }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "select-inline",
                  style: { width: 140 },
                  value: taskTypeId,
                  onChange: (v) => setTaskTypeId(v),
                  title: t("Agents_TaskType"),
                  options: [{ value: "", label: t("Agents_TaskTypeFree") }, ...taskTypes.filter((tt) => !tt.error).map((tt) => ({ value: tt.fullId, label: tt.name }))]
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "select-inline",
                  style: { width: 150 },
                  value: modelId,
                  onChange: (v) => setModelId(v),
                  title: t("Agents_Model"),
                  options: [{ value: "", label: t("Agents_ModelDefault") }, ...modelProfiles.filter((m) => m.configured).map((m) => ({ value: m.id, label: m.name + (m.isDefault ? " ★" : "") }))]
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "select-inline",
                  style: { width: 100 },
                  value: thinking,
                  onChange: (v) => setThinking(v),
                  title: t("Agents_Thinking"),
                  options: [
                    { value: "high", label: t("Agents_ThinkingHigh") },
                    { value: "medium", label: t("Agents_ThinkingMedium") },
                    { value: "low", label: t("Agents_ThinkingLow") },
                    { value: "off", label: t("Agents_ThinkingOff") }
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  onClick: () => void createFromCompose(),
                  disabled: sending || !composeText.trim(),
                  style: { border: "none", background: "var(--c-text)", color: "var(--c-panel)", borderRadius: 8, width: 30, height: 30, fontSize: 14, cursor: "pointer", opacity: sending || !composeText.trim() ? 0.4 : 1 },
                  children: "➤"
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, marginTop: 6 }, children: [
            "Ctrl+Enter 发送 · ",
            t("Agents_TargetHint"),
            " · 规划模式：先调研出计划，批准后自动执行"
          ] })
        ] }) }),
        tab === "diff" && selected && /* @__PURE__ */ jsxRuntime.jsx(
          ChangesTab,
          {
            taskId: selected.taskId,
            worktreePath: selected.worktreePath,
            baselineSha: selected.baselineSha,
            initialFile: pendingFile,
            branch: selected.branch,
            onCount: setDiffCount,
            tick: changesTick,
            onReloadAgents: reloadAgents,
            setError
          }
        ),
        tab === "cp" && selected && /* @__PURE__ */ jsxRuntime.jsx(CheckpointsTab, { taskId: selected.taskId, branch: selected.branch, tick: changesTick, setError, onCount: setCpCount, onViewDiff: () => setTab("diff") })
      ] })
    ] });
  }
  function ChangesTab(props) {
    const { taskId, worktreePath, baselineSha, initialFile, tick } = props;
    const [files, setFiles] = react.useState([]);
    const [sel, setSel] = react.useState(initialFile ?? null);
    const [diffs, setDiffs] = react.useState([]);
    const diffTextRef = react.useRef("");
    const [since, setSince] = react.useState(void 0);
    const [busy, setBusy] = react.useState(false);
    react.useEffect(() => {
      let cancelled = false;
      setBusy(true);
      void call("agent.task.files", { taskId }).then(async (fs) => {
        var _a2;
        if (cancelled) return;
        setFiles(fs);
        props.onCount(fs.length);
        const target = sel && fs.some((f) => f.path === sel) ? sel : ((_a2 = fs[0]) == null ? void 0 : _a2.path) ?? null;
        setSel(target);
        if (target) {
          const [d, txt] = await Promise.all([
            call("agent.task.diff", { taskId, path: target, since }),
            call("agent.task.diffText", { taskId, path: target, since })
          ]);
          if (!cancelled) {
            setDiffs(d);
            diffTextRef.current = txt;
          }
        } else {
          setDiffs([]);
          diffTextRef.current = "";
        }
      }).catch((e) => props.setError(e.message)).finally(() => {
        if (!cancelled) setBusy(false);
      });
      return () => {
        cancelled = true;
      };
    }, [taskId, tick, sel, since]);
    const pick = (x) => {
      setSel(x);
      setDiffs([]);
    };
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 12.5 }, children: "改动" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 11.5, fontFamily: "var(--mono, monospace)" }, children: props.branch }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: [
          files.length,
          " 个文件 · 基于 ",
          baselineSha.slice(0, 8),
          "^"
        ] }),
        since ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-amber)", fontSize: 11 }, children: [
          "· 查看 ",
          since
        ] }) : null,
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: worktreePath }), children: "在 Changes 中打开" }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => {
          var _a2;
          return void ((_a2 = navigator.clipboard) == null ? void 0 : _a2.writeText(diffTextRef.current));
        }, children: "复制 diff" })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "250px 1fr", overflow: "hidden" }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { borderRight: "1px solid var(--c-border)", overflowY: "auto", padding: 8 }, children: [
          files.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 11.5, padding: 6 }, children: busy ? "加载中…" : "暂无改动" }),
          files.map((f) => {
            const letter = f.kind === "deleted" ? "D" : f.kind === "added" ? "A" : "M";
            const color = f.kind === "deleted" ? "var(--c-red)" : f.kind === "added" ? "var(--c-green)" : "var(--c-amber)";
            return /* @__PURE__ */ jsxRuntime.jsxs(
              "div",
              {
                onClick: () => pick(f.path),
                style: { padding: "6px 9px", borderRadius: 8, cursor: "pointer", display: "flex", gap: 6, background: sel === f.path ? "var(--c-panel)" : "transparent", border: `1px solid ${sel === f.path ? "var(--c-text)" : "transparent"}` },
                children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontFamily: "var(--mono, monospace)", fontWeight: 700, color }, children: letter }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--mono, monospace)", fontSize: 11.5 }, children: f.path }),
                  /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text3)", fontFamily: "var(--mono, monospace)", fontSize: 10.5 }, children: [
                    "+",
                    f.added ?? 0,
                    " −",
                    f.deleted ?? 0
                  ] })
                ]
              },
              f.path
            );
          })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { overflowY: "auto", padding: "12px 16px", minWidth: 0 }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontFamily: "var(--mono, monospace)", fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: sel ?? "（选择文件）" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !sel, onClick: async () => {
                if (!sel || !window.confirm(`还原 ${sel} 到会话基线（${baselineSha.slice(0, 8)}）？该文件在本会话的改动将被丢弃。`)) return;
                try {
                  await call("agent.task.restore", { taskId, sha: baselineSha, path: sel });
                  await props.onReloadAgents();
                } catch (e) {
                  props.setError(e.message);
                }
              }, children: "还原此文件" }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", children: "复制" })
            ] })
          ] }),
          diffs.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 11.5 }, children: busy ? "加载中…" : "（无差异）" }) : diffs.map((d) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: 8 }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, padding: "2px 0" }, children: [
              d.path,
              " +",
              d.addedLines,
              " −",
              d.deletedLines
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx(DiffView, { diff: d })
          ] }, d.path)),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 11, marginTop: 8 }, children: "并排 / 内联 切换沿用现有 DiffView" })
        ] })
      ] })
    ] });
  }
  function CheckpointsTab(props) {
    const { taskId, tick } = props;
    const [cps, setCps] = react.useState([]);
    const [viewSha, setViewSha] = react.useState(null);
    const [diffs, setDiffs] = react.useState([]);
    react.useEffect(() => {
      let cancelled = false;
      void call("agent.task.checkpoints", { taskId }).then((x) => {
        if (cancelled) return;
        const r = x.reverse();
        setCps(r);
        props.onCount(r.length);
      }).catch((e) => props.setError(e.message));
      return () => {
        cancelled = true;
      };
    }, [taskId, tick]);
    react.useEffect(() => {
      if (!viewSha) {
        setDiffs([]);
        return;
      }
      let cancelled = false;
      void call("agent.task.diff", { taskId, since: `checkpoint:${viewSha}` }).then((d) => {
        if (!cancelled) setDiffs(d);
      }).catch((e) => props.setError(e.message));
      return () => {
        cancelled = true;
      };
    }, [viewSha]);
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 14px", borderBottom: "1px solid var(--c-border)" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 12.5 }, children: "检查点" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 11.5, fontFamily: "var(--mono, monospace)" }, children: props.branch }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: [
          cps.length,
          " 个托管提交 · Esc×2 快捷回此页"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px", maxWidth: 880 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 12, marginBottom: 10 }, children: "每轮结束自动托管 checkpoint。回滚 = ZCode rewind：恢复 worktree 到该轮之前（消息历史保留，可重新续跑）。" }),
        cps.map((cp) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--c-border)", borderRadius: 10, padding: "8px 12px", marginBottom: 8, fontFamily: "var(--mono, monospace)", fontSize: 12 }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text3)" }, children: [
            "cp ",
            cp.sha.slice(0, 8)
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "inherit" }, children: cp.summary.replace(/^checkpoint:\s*/, "") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: cp.date.slice(5, 16).replace("T", " ") }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setViewSha(viewSha === cp.sha ? null : cp.sha), children: viewSha === cp.sha ? "收起该轮 diff" : "查看该轮 diff" }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: async () => {
            if (!window.confirm(`回滚 worktree 到 ${cp.sha.slice(0, 8)}？该 checkpoint 之后的所有改动将被丢弃（reset --hard）。`)) return;
            try {
              await call("agent.task.restore", { taskId, sha: cp.sha });
              props.onViewDiff();
            } catch (e) {
              props.setError(e.message);
            }
          }, children: "回滚到此处" })
        ] }, cp.sha)),
        cps.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 11.5 }, children: "暂无 checkpoint" }),
        viewSha && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginTop: 8, maxHeight: 320, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 10, padding: 8 }, children: diffs.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 11.5 }, children: "（该轮无改动）" }) : diffs.map((d) => /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, padding: "2px 0" }, children: [
            d.path,
            " +",
            d.addedLines,
            " −",
            d.deletedLines
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx(DiffView, { diff: d })
        ] }, d.path)) })
      ] })
    ] });
  }
  window.GITTER_UI.registerPage({ id: "tasks" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "tasks",
        children: React.createElement(TasksPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
