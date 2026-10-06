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
  K().DiffView;
  K().diffStatusLetter;
  K().renderSegments;
  K().wordDiff;
  K().SplitPane;
  K().Banner;
  K().Modal;
  K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  const renderMarkdown = K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  function U() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  const BOOT = ((_b = (_a = window.GITTER_UI) == null ? void 0 : _a.getActiveCaller) == null ? void 0 : _b.call(_a)) ?? null;
  const pageSdk = {
    call: (method, params) => {
      const g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    on: (method, cb) => U().on(method, cb),
    t: (key, ...args) => U().t(key, ...args),
    navigate: (page) => U().navigate(page),
    openSettings: (section) => U().openSettings(section),
    toast: (title, body) => U().toast(title, body),
    refresh: () => U().refresh(),
    repo: () => U().repo(),
    settings: () => U().settings(),
    theme: () => U().theme(),
    openRepo: (path) => U().openRepo(path),
    closeRepo: () => U().closeRepo(),
    updateSettings: (patch) => U().updateSettings(patch),
    applySettings: (s) => U().applySettings(s),
    reloadTheme: () => U().reloadTheme(),
    clearSettingsFocus: () => U().clearSettingsFocus(),
    context: () => U().context(),
    setContext: (...a) => U().setContext(...a),
    focusTask: (taskId) => U().focusTask(taskId),
    clearTaskFocus: () => U().clearTaskFocus(),
    runCommand: (cmd, ctx) => U().runCommand(cmd, ctx)
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  function useTaskFocus() {
    const focusTaskId = useAppState().focusTaskId;
    const consume = () => pageSdk.clearTaskFocus();
    return [focusTaskId, consume];
  }
  const { call, on: onEvent, t, openSettings, openRepo } = pageSdk;
  const LIVE_STATES = /* @__PURE__ */ new Set(["starting", "working", "awaiting-input", "awaiting-permission"]);
  const ACTOR_COLORS = {
    human: "var(--c-green)",
    agent: "var(--c-chip-purple-fg, #b490ff)",
    host: "var(--c-cyan, #4fc9d8)"
  };
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
  function eventToEntry(ev) {
    var _a2, _b2;
    switch (ev.type) {
      case "status":
        return { actor: "agent", glyph: "●", text: `${ev.phase}${ev.summary ? ` — ${ev.summary}` : ""}` };
      case "output":
        if (ev.stream === "assistant") return { actor: "agent", glyph: "", text: ev.text ?? "", md: true, merge: true };
        return { actor: "agent", glyph: "›", text: ev.text ?? "" };
      case "file-change":
        return { actor: "agent", glyph: ev.kind === "deleted" ? "−" : "+", text: `${ev.path}${ev.summary ? ` (${ev.summary})` : ""}`, color: ev.kind === "deleted" ? "var(--c-red)" : "var(--c-green)" };
      case "checkpoint":
        return { actor: "host", glyph: "✔", text: `宿主托管 checkpoint ${(_a2 = ev.commitSha) == null ? void 0 : _a2.slice(0, 8)} ${ev.summary ?? ""}` };
      case "turn-completed":
        return { actor: "agent", glyph: "↩", text: `turn.completed${ev.usage ? ` · ${ev.usage.input ?? "?"} in / ${ev.usage.output ?? "?"} out` : ""}` };
      case "completed":
        return { actor: "agent", glyph: "■", text: `${ev.outcome}${ev.summary ? ` — ${ev.summary}` : ""}`, color: ev.outcome === "failed" ? "var(--c-red)" : void 0 };
      case "session-meta":
        return { actor: "agent", glyph: "⌁", text: `session ${(_b2 = ev.externalSessionId) == null ? void 0 : _b2.slice(0, 12)}` };
      case "permission":
        return { actor: "agent", glyph: "◈", text: `授权请求：${ev.command ?? ev.title ?? ""}`, perm: { requestId: ev.requestId, command: ev.command, title: ev.title } };
      case "question":
        return { actor: "agent", glyph: "?", text: ev.question ?? "", perm: { requestId: ev.requestId, title: ev.question } };
      case "log":
        return { actor: "host", glyph: "·", text: `${ev.level}: ${ev.text ?? ""}` };
    }
  }
  function TasksPage() {
    var _a2;
    const app = useAppState();
    const repo = app.repo;
    const [worktrees, setWorktrees] = react.useState(null);
    const [harnesses, setHarnesses] = react.useState(null);
    const [agentTasks, setAgentTasks] = react.useState(null);
    const [taskTypes, setTaskTypes] = react.useState([]);
    const [modelProfiles, setModelProfiles] = react.useState([]);
    const [taskTypeId, setTaskTypeId] = react.useState("");
    const [modelId, setModelId] = react.useState("");
    const [evMap, setEvMap] = react.useState({});
    const [selectedTask, setSelectedTask] = react.useState(null);
    const [focusTaskId, consumeTaskFocus] = useTaskFocus();
    react.useEffect(() => {
      if (!focusTaskId) return;
      setSelectedTask(focusTaskId);
      consumeTaskFocus();
    }, [focusTaskId]);
    const [error, setError] = react.useState(null);
    const [transient, setTransient] = react.useState(null);
    const [inputText, setInputText] = react.useState("");
    const [composeText, setComposeText] = react.useState("");
    const [thinking, setThinking] = react.useState("medium");
    const [sending, setSending] = react.useState(false);
    const replied = react.useRef(/* @__PURE__ */ new Set());
    const timelineRef = react.useRef(null);
    const scrollTimelineToBottom = react.useCallback(() => {
      requestAnimationFrame(
        () => requestAnimationFrame(() => {
          const el = timelineRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        })
      );
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
      } catch (e) {
        setError(e.message);
      }
    }, [repo]);
    react.useEffect(() => {
      void reloadWorktrees();
      void reloadAgents();
    }, [repo, app.refreshTick, reloadWorktrees, reloadAgents]);
    react.useEffect(
      () => onEvent("agent.event", (p) => {
        const { taskId, event } = p;
        setEvMap((m) => {
          const arr = [...m[taskId] ?? []];
          const e = eventToEntry(event);
          const last = arr[arr.length - 1];
          if (e.merge && last && last.merge) {
            arr[arr.length - 1] = { ...last, text: (last.text ?? "") + (e.text ?? "") };
          } else {
            arr.push(e);
          }
          return { ...m, [taskId]: arr.slice(-120) };
        });
        if (event.type === "completed" || event.type === "turn-completed") void reloadAgents();
      }),
      [reloadAgents]
    );
    react.useEffect(
      () => onEvent("agent.tasks.changed", () => {
        void reloadAgents();
      }),
      [reloadAgents]
    );
    react.useEffect(() => {
      if (!selectedTask) return;
      if ((evMap[selectedTask] ?? []).length > 0) return;
      let cancelled = false;
      void call(
        "agent.task.history",
        { taskId: selectedTask }
      ).then((h) => {
        if (cancelled) return;
        const entries = h.events.map((je) => {
          if (je.kind === "text") return { actor: je.actor, glyph: "▶", text: je.text ?? "" };
          return eventToEntry(je.event);
        });
        setEvMap((m) => {
          var _a3;
          return ((_a3 = m[selectedTask]) == null ? void 0 : _a3.length) ? m : { ...m, [selectedTask]: entries };
        });
        scrollTimelineToBottom();
      }).catch(() => {
      });
      return () => {
        cancelled = true;
      };
    }, [selectedTask, evMap]);
    react.useEffect(() => {
      scrollTimelineToBottom();
    }, [evMap, selectedTask, scrollTimelineToBottom]);
    const open = (w) => {
      void openRepo(w.path);
    };
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "🗂" }),
        t("Common_NoProjectSelected")
      ] });
    }
    const selected = (agentTasks == null ? void 0 : agentTasks.find((x) => x.taskId === selectedTask)) ?? null;
    const timeline = selectedTask ? evMap[selectedTask] ?? [] : [];
    [...timeline].reverse().find((e) => e.perm && !replied.current.has(e.perm.requestId));
    const modelInfo = (_a2 = harnesses == null ? void 0 : harnesses[0]) == null ? void 0 : _a2.detect;
    const sendInput = async () => {
      if (!selected || !inputText.trim() || sending) return;
      const text = inputText.trim();
      setEvMap((m) => ({ ...m, [selected.taskId]: [...m[selected.taskId] ?? [], { actor: "human", glyph: "▶", text }] }));
      setInputText("");
      setSending(true);
      try {
        await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking });
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      } finally {
        setSending(false);
      }
    };
    const createFromCompose = async () => {
      if (!composeText.trim() || sending) return;
      setSending(true);
      try {
        const record = await call("agent.task.create", {
          prompt: composeText.trim(),
          taskType: taskTypeId || void 0,
          model: modelId || void 0,
          thinking
        });
        setComposeText("");
        setSelectedTask(record.taskId);
        setEvMap((m) => ({ ...m, [record.taskId]: [{ actor: "human", glyph: "▶", text: t("Agents_Dispatched", record.title) }] }));
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      } finally {
        setSending(false);
      }
    };
    const agentCard = (task) => {
      const chip = stateChip(task.state);
      const live = LIVE_STATES.has(task.state);
      const selectedNow = selectedTask === task.taskId;
      return /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "card",
          style: {
            cursor: "pointer",
            borderColor: selectedNow ? "var(--c-accent)" : "var(--c-border)",
            background: selectedNow ? "var(--c-hover)" : void 0
          },
          onClick: () => {
            setSelectedTask(selectedNow ? null : task.taskId);
            setThinking(task.thinking ?? "medium");
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-title", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }, children: task.title }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", style: { color: chip.color, background: "transparent", border: `1px solid ${chip.color}` }, children: chip.label })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-path", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-chip-purple-fg)" }, children: "⚡ Gitter Agent" }),
              " · ",
              task.branch
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: task.worktreePath }),
            task.lastMessage && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11, color: "var(--c-text)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: task.lastMessage }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-actions", onClick: (e) => e.stopPropagation(), children: [
              live && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: async () => {
                try {
                  await call("agent.task.stop", { taskId: task.taskId });
                  setTransient(t("Agents_Stopped"));
                  await reloadAgents();
                } catch (e) {
                  setError(e.message);
                }
              }, children: t("Agents_Stop") }),
              !live && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => {
                setSelectedTask(task.taskId);
                setInputText("");
              }, children: t("Agents_Resume") }),
              !live && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: async () => {
                try {
                  await call("agent.task.archive", { taskId: task.taskId, archived: true });
                  if (selectedTask === task.taskId) setSelectedTask(null);
                  await reloadAgents();
                } catch (e) {
                  setError(e.message);
                }
              }, children: t("Agents_Archive") }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: task.worktreePath }), children: t("Projects_NewWindow") })
            ] })
          ]
        },
        task.taskId
      );
    };
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "grid", gridTemplateColumns: "400px 1fr", gap: 14, flex: 1, minHeight: 0, alignItems: "stretch" }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", minHeight: 0, gap: 10 }, children: [
        transient && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "toolbar", style: { padding: 0 }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 11, color: "var(--c-green)" }, children: transient }) }),
        error && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: error }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setError(null), children: "✕" })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }, children: [
          ((agentTasks == null ? void 0 : agentTasks.length) ?? 0) === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card", style: { fontSize: 12, color: "var(--c-text3)" }, children: t("Agents_EmptyHint") }),
          agentTasks == null ? void 0 : agentTasks.map(agentCard),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11, color: "var(--c-text3)", letterSpacing: 1, marginTop: 6 }, children: t("Tasks_WorktreeSection") }),
          (worktrees ?? []).filter((w) => !w.isMain).map((w) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card", style: { padding: "8px 12px", cursor: "pointer" }, onClick: () => open(w), children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-title", style: { fontSize: 12 }, children: [
              "🗂 ",
              w.branch
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: w.path }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-actions", onClick: (e) => e.stopPropagation(), children: [
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => open(w), children: t("Tasks_Open") }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: w.path }), children: t("Projects_NewWindow") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "tool-btn",
                  onClick: async () => {
                    try {
                      await call("tasks.remove", { path: w.path });
                      await reloadWorktrees();
                    } catch (e) {
                      setError(e.message);
                    }
                  },
                  children: t("Tasks_Remove")
                }
              )
            ] })
          ] }, w.path))
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card", style: { minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 16px" }, children: [
        !selected && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 14 }, children: "⚡ Gitter Agent" }),
            (modelInfo == null ? void 0 : modelInfo.available) ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chip", style: { color: "var(--c-green)", background: "transparent", border: "1px solid var(--c-green)" }, children: [
              "● ",
              t("Agents_ModelReady"),
              modelInfo.version ? ` · ${modelInfo.version}` : ""
            ] }) : /* @__PURE__ */ jsxRuntime.jsxs(
              "button",
              {
                className: "tool-btn",
                style: { color: "var(--c-amber)", borderColor: "var(--c-amber)" },
                onClick: () => openSettings("models"),
                children: [
                  "● ",
                  t("Agents_ModelMissing"),
                  " → ",
                  t("Agents_OpenSettings")
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "card-path", children: t("Agents_ComposeHint") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              className: "card",
              style: {
                flex: 1,
                minHeight: 200,
                display: "flex",
                flexDirection: "column",
                padding: "12px 14px",
                background: "var(--c-panel)",
                borderColor: composeText.trim() ? "var(--c-accent)" : "var(--c-border)"
              },
              onClick: (e) => {
                const el = e.currentTarget.querySelector("textarea");
                if (el && e.target === el) return;
                el == null ? void 0 : el.focus();
              },
              children: [
                /* @__PURE__ */ jsxRuntime.jsx(
                  "textarea",
                  {
                    autoFocus: true,
                    className: "input",
                    style: { flex: 1, minHeight: 150, resize: "none", fontSize: 13.5, background: "transparent", border: "none", outline: "none", color: "var(--c-text)", padding: 0 },
                    placeholder: t("Agents_ComposePlaceholder"),
                    value: composeText,
                    onChange: (e) => setComposeText(e.target.value),
                    onKeyDown: (e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void createFromCompose();
                    }
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { borderTop: "1px solid var(--c-border)", marginTop: 10, paddingTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsxs("select", { className: "input", style: { width: 140 }, title: t("Agents_TaskType"), value: taskTypeId, onChange: (e) => setTaskTypeId(e.target.value), children: [
                    /* @__PURE__ */ jsxRuntime.jsx("option", { value: "", children: t("Agents_TaskTypeFree") }),
                    taskTypes.filter((tt) => !tt.error).map((tt) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: tt.fullId, children: tt.name }, tt.fullId))
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("select", { className: "input", style: { width: 170 }, title: t("Agents_Model"), value: modelId, onChange: (e) => setModelId(e.target.value), children: [
                    /* @__PURE__ */ jsxRuntime.jsx("option", { value: "", children: t("Agents_ModelDefault") }),
                    modelProfiles.filter((m) => m.configured).map((m) => /* @__PURE__ */ jsxRuntime.jsxs("option", { value: m.id, children: [
                      m.name,
                      m.isDefault ? " ★" : ""
                    ] }, m.id))
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("select", { className: "input", style: { width: 120 }, title: t("Agents_Thinking"), value: thinking, onChange: (e) => setThinking(e.target.value), children: [
                    /* @__PURE__ */ jsxRuntime.jsx("option", { value: "high", children: t("Agents_ThinkingHigh") }),
                    /* @__PURE__ */ jsxRuntime.jsx("option", { value: "medium", children: t("Agents_ThinkingMedium") }),
                    /* @__PURE__ */ jsxRuntime.jsx("option", { value: "low", children: t("Agents_ThinkingLow") }),
                    /* @__PURE__ */ jsxRuntime.jsx("option", { value: "off", children: t("Agents_ThinkingOff") })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
                  /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", disabled: sending || !composeText.trim(), onClick: () => void createFromCompose(), children: sending ? "…" : `${t("Agents_Send")} ▶` })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-path", children: [
            "Ctrl+Enter · ",
            t("Agents_TargetHint")
          ] })
        ] }),
        selected && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 14 }, children: selected.title }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", style: { color: stateChip(selected.state).color, background: "transparent", border: `1px solid ${stateChip(selected.state).color}` }, children: stateChip(selected.state).label }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "card-path", children: [
              "session ",
              selected.taskId.slice(0, 8),
              " · ⚡ ",
              selected.harnessFullId.split("/")[0]
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs(
              "select",
              {
                className: "input",
                style: { width: 160, fontSize: 11 },
                value: selected.modelRef ?? "",
                disabled: LIVE_STATES.has(selected.state) && selected.state !== "awaiting-input",
                title: t("Agents_ModelBadgeTitle"),
                onChange: async (e) => {
                  try {
                    await call("agent.task.setModel", { taskId: selected.taskId, model: e.target.value });
                    await reloadAgents();
                  } catch (err) {
                    setError(err.message);
                  }
                },
                children: [
                  (modelProfiles ?? []).filter((m) => m.configured).map((m) => /* @__PURE__ */ jsxRuntime.jsxs("option", { value: m.id, children: [
                    m.name,
                    m.isDefault ? " ★" : ""
                  ] }, m.id)),
                  selected.modelRef && !(modelProfiles ?? []).some((m) => m.id === selected.modelRef) && /* @__PURE__ */ jsxRuntime.jsx("option", { value: selected.modelRef, children: selected.modelRef })
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: selected.worktreePath }), children: t("Projects_NewWindow") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-path", style: { marginTop: 2 }, children: [
            selected.worktreePath,
            " · 基线 ",
            selected.baselineSha.slice(0, 8) || "—",
            selected.externalSessionId ? ` · session ${selected.externalSessionId.slice(0, 12)}` : ""
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              ref: timelineRef,
              style: {
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                marginTop: 12,
                borderLeft: "2px solid var(--c-border)",
                padding: "4px 0 4px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 6
              },
              onClick: (e) => {
                const a = e.target.closest("a");
                if (a) {
                  e.preventDefault();
                  const href = a.getAttribute("href") ?? "";
                  if (/^https?:\/\//i.test(href)) void call("shell.openExternal", { url: href });
                }
              },
              children: [
                timeline.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: t("Agents_TimelineEmpty") }),
                timeline.map((e, i) => e.md ? /* @__PURE__ */ jsxRuntime.jsx(
                  "div",
                  {
                    className: "md-body",
                    dangerouslySetInnerHTML: { __html: renderMarkdown(e.text ?? "") }
                  },
                  i
                ) : /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 12.5, color: e.color ?? ACTOR_COLORS[e.actor], lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", style: { marginRight: 6 }, children: e.glyph }),
                  e.text,
                  e.perm && e.perm.requestId && !replied.current.has(e.perm.requestId) && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginTop: 6, border: "1px dashed var(--c-amber)", borderRadius: 8, padding: "8px 10px" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-amber)", fontWeight: 600, marginBottom: 4 }, children: [
                      "◈ ",
                      t("Agents_PermTitle"),
                      e.perm.command ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "card-path", style: { marginLeft: 8 }, children: e.perm.command }) : null
                    ] }),
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: async () => {
                        replied.current.add(e.perm.requestId);
                        await call("agent.perm.reply", { requestId: e.perm.requestId, ok: true, remember: true });
                      }, children: t("Agents_PermApprove") }),
                      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: async () => {
                        replied.current.add(e.perm.requestId);
                        await call("agent.perm.reply", { requestId: e.perm.requestId, ok: false, remember: false });
                      }, children: t("Agents_PermDeny") }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 10.5, color: "var(--c-text3)", marginLeft: "auto" }, children: t("Agents_PermNote") })
                    ] })
                  ] })
                ] }, i))
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs(
              "select",
              {
                className: "input",
                style: { width: 120 },
                title: t("Agents_Thinking"),
                value: thinking,
                onChange: (e) => setThinking(e.target.value),
                children: [
                  /* @__PURE__ */ jsxRuntime.jsx("option", { value: "high", children: t("Agents_ThinkingHigh") }),
                  /* @__PURE__ */ jsxRuntime.jsx("option", { value: "medium", children: t("Agents_ThinkingMedium") }),
                  /* @__PURE__ */ jsxRuntime.jsx("option", { value: "low", children: t("Agents_ThinkingLow") }),
                  /* @__PURE__ */ jsxRuntime.jsx("option", { value: "off", children: t("Agents_ThinkingOff") })
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "textarea",
              {
                className: "input",
                style: { flex: 1, minHeight: 44, maxHeight: 120, resize: "vertical" },
                placeholder: LIVE_STATES.has(selected.state) ? t("Agents_InputRunning") : t("Agents_InputPlaceholder"),
                disabled: LIVE_STATES.has(selected.state) && selected.state !== "awaiting-input",
                value: inputText,
                onChange: (e) => setInputText(e.target.value),
                onKeyDown: (e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void sendInput();
                }
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", style: { alignSelf: "flex-end" }, disabled: sending || !inputText.trim(), onClick: () => void sendInput(), children: t("Agents_Send") })
          ] })
        ] })
      ] })
    ] });
  }
  window.GITTER_UI.registerPage({ id: "tasks" }, (container) => {
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "tasks",
        children: React.createElement(TasksPage)
      })
    );
    return () => root.unmount();
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
