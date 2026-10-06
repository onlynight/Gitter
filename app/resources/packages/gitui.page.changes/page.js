(function(jsxRuntime, react) {
  "use strict";
  var _a, _b;
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
    t: (key, ...args) => U().t(key, ...args),
    navigate: (page) => U().navigate(page),
    openSettings: (section) => U().openSettings(section),
    refresh: () => U().refresh(),
    setContext: (...a) => U().setContext(...a)
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  async function seamMenuItems(location, filePath) {
    var _a2;
    try {
      const g = window.GITTER_UI;
      if (!g) return [];
      const items = await g.call("menus.list", { location, lang: ((_a2 = g.getState().i18n) == null ? void 0 : _a2.lang) ?? "en", fileSelected: !!filePath });
      return items.map((m) => ({ label: m.title, action: () => void g.runCommand({ id: m.command, title: m.title }, { filePath }) }));
    } catch {
      return [];
    }
  }
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
  const SplitPane = K().SplitPane;
  const Banner = K().Banner;
  const Modal = K().Modal;
  const useContextMenu = K().useContextMenu;
  const SyncBar = K().SyncBar;
  const useSyncProgress = K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  const { call, t, navigate, refresh: refreshCurrent, openSettings, setContext: setSharedContext } = pageSdk;
  const useApp = useAppState;
  const PREFIXES = ["feat:", "fix:", "docs:", "test:", "build:", "chore:"];
  const PREVIEW_EXTS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".ico", ".svg"]);
  function previewable(p) {
    const dot = p.lastIndexOf(".");
    return dot >= 0 && PREVIEW_EXTS.has(p.slice(dot).toLowerCase());
  }
  function ChangesPage() {
    var _a2;
    const app = useApp();
    const repo = app.repo;
    const [state, setStateDto] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [errorDetail, setErrorDetail] = react.useState(null);
    const [transient, setTransient] = react.useState(null);
    const [selected, setSelected] = react.useState(null);
    react.useEffect(() => {
      setSharedContext({ selectedFile: selected });
    }, [selected]);
    const [diff, setDiff] = react.useState(null);
    const [preview, setPreview] = react.useState(null);
    const [checked, setChecked] = react.useState(/* @__PURE__ */ new Set());
    const [collapsedGroups, setCollapsedGroups] = react.useState(() => {
      try {
        return new Set(JSON.parse(localStorage.getItem("gitter:changes:collapsedGroups") ?? "[]"));
      } catch {
        return /* @__PURE__ */ new Set();
      }
    });
    const toggleGroup = (gkey) => setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gkey)) next.delete(gkey);
      else next.add(gkey);
      try {
        localStorage.setItem("gitter:changes:collapsedGroups", JSON.stringify([...next]));
      } catch {
      }
      return next;
    });
    const [selectedHunks, setSelectedHunks] = react.useState(/* @__PURE__ */ new Set());
    const [message, setMessage] = react.useState("");
    const [busy, setBusy] = react.useState(false);
    const [findings, setFindings] = react.useState([]);
    const [showAllFindings, setShowAllFindings] = react.useState(false);
    const [resolvedFindings, setResolvedFindings] = react.useState(() => {
      try {
        return new Set(JSON.parse(localStorage.getItem("gitter:changes:resolvedFindings") ?? "[]"));
      } catch {
        return /* @__PURE__ */ new Set();
      }
    });
    const [focusLine, setFocusLine] = react.useState(null);
    const findingKey = (f) => `${f.ruleId}|${f.filePath}|${f.line ?? ""}`;
    const dismissFinding = (f) => setResolvedFindings((prev) => {
      const next = new Set(prev);
      next.add(findingKey(f));
      try {
        localStorage.setItem("gitter:changes:resolvedFindings", JSON.stringify([...next]));
      } catch {
      }
      return next;
    });
    const activeFindings = findings.filter((f) => !resolvedFindings.has(findingKey(f)));
    const jumpToFinding = (f) => {
      const unstaged = state == null ? void 0 : state.changes.find((x) => x.path === f.filePath);
      const staged = state == null ? void 0 : state.staged.find((x) => x.path === f.filePath);
      const conflict = state == null ? void 0 : state.conflicts.find((x) => x.path === f.filePath);
      const target = unstaged ?? staged ?? conflict;
      if (target) {
        select(target, !unstaged && !!staged);
        if (f.line) setFocusLine({ line: f.line, ts: Date.now() });
      } else {
        void call("shell.openPath", { path: f.filePath, editor: true });
      }
    };
    const [feedback, setFeedback] = react.useState(null);
    const [aiBusy, setAiBusy] = react.useState(false);
    const [explainText, setExplainText] = react.useState(null);
    const [createBranch, setCreateBranch] = react.useState(null);
    const [pushErrorKind, setPushErrorKind] = react.useState(null);
    const { showMenu, menuElement } = useContextMenu();
    const transientTimer = react.useRef(null);
    const [syncProgress, clearSyncProgress] = useSyncProgress();
    const reload = react.useCallback(async () => {
      if (!repo) return;
      try {
        const s = await call("changes.state");
        setStateDto(s);
        setError(null);
        setErrorDetail(null);
        try {
          const r = await call("changes.safetyScan");
          setFindings(r.findings);
        } catch {
          setFindings([]);
        }
        setFeedback(await call("changes.feedback"));
      } catch (e) {
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      }
    }, [repo]);
    react.useEffect(() => {
      if (!repo) {
        setStateDto(null);
        return;
      }
      void reload();
      setSelected(null);
      setDiff(null);
      setMessage("");
    }, [repo, app.refreshTick]);
    const showTransient = (text) => {
      setTransient(text);
      if (transientTimer.current) window.clearTimeout(transientTimer.current);
      transientTimer.current = window.setTimeout(() => setTransient(null), 5e3);
    };
    const run = async (fn) => {
      setBusy(true);
      try {
        const msg = await fn();
        if (typeof msg === "string") showTransient(msg);
        await reload();
        if (selected) await loadDiff(selected);
      } catch (e) {
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      } finally {
        clearSyncProgress();
        setBusy(false);
      }
    };
    const loadDiff = react.useCallback(async (sel) => {
      setPreview(null);
      setSelectedHunks(/* @__PURE__ */ new Set());
      if (previewable(sel.path)) {
        try {
          const p = await call("file.preview", { path: sel.path, staged: sel.staged });
          setPreview(p);
          setDiff(null);
          return;
        } catch {
        }
      }
      try {
        const d = await call("changes.diffFile", { path: sel.path, staged: sel.staged, isNewFile: sel.isNew });
        setDiff(d);
      } catch (e) {
        setDiff(null);
        setError(e.message);
      }
    }, []);
    const select = (f, stagedView) => {
      const sel = { path: f.path, staged: stagedView, isNew: f.category === "unversioned", isConflict: f.isConflict };
      setSelected(sel);
      void loadDiff(sel);
    };
    const toggleCheck = (path) => setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    const allFiles = react.useMemo(
      () => state ? [...state.staged, ...state.changes, ...state.unversioned, ...state.conflicts] : [],
      [state]
    );
    const stagedPaths = react.useMemo(
      () => allFiles.filter((f) => checked.has(f.path) && f.category !== "staged" && f.category !== "conflicts").map((f) => f.path),
      [allFiles, checked]
    );
    const unstagedPaths = react.useMemo(
      () => allFiles.filter((f) => !checked.has(f.path) && f.category === "staged").map((f) => f.path),
      [allFiles, checked]
    );
    const canCommit = !!state && (state.staged.length > 0 || stagedPaths.length > 0) && message.trim().length > 0 && !busy;
    const doCommit = async (push) => {
      if (!canCommit) return;
      setBusy(true);
      try {
        const r = await call("changes.commit", {
          message: message.trim(),
          push,
          toStage: stagedPaths,
          toUnstage: unstagedPaths
        });
        setMessage("");
        setChecked(/* @__PURE__ */ new Set());
        if (r.pushError) {
          setError(t("Changes_PushFailed", r.pushError));
          setErrorDetail(null);
        } else {
          showTransient(push ? t("Changes_CommittedAndPushed") : t("Changes_Committed"));
        }
        await reload();
      } catch (e) {
        const err = e;
        setError(err.message);
        setErrorDetail(err.detail ?? null);
      } finally {
        clearSyncProgress();
        setBusy(false);
      }
    };
    const generateMessage = async () => {
      setAiBusy(true);
      try {
        const r = await call("ai.generateCommitMessage");
        setMessage((m) => m.trim() ? m : r.message);
      } catch (e) {
        setError(e.message);
      } finally {
        clearSyncProgress();
        setAiBusy(false);
      }
    };
    const explain = async (intent) => {
      setAiBusy(true);
      try {
        const r = await call("ai.explain", { intent, path: (selected == null ? void 0 : selected.staged) ? selected.path : null });
        setExplainText({ title: intent === "review" ? t("Changes_AiReview") : t("Changes_AiExplain"), text: r.text });
      } catch (e) {
        setError(e.message);
      } finally {
        clearSyncProgress();
        setAiBusy(false);
      }
    };
    const doPush = async () => {
      setBusy(true);
      try {
        const err = await call("changes.push", {});
        if (err) {
          setPushErrorKind(err);
          setError(t("Changes_PushFailed", err));
          setErrorDetail(null);
        } else {
          setPushErrorKind(null);
          showTransient(t("Changes_Pushed"));
          await reload();
        }
      } catch (e) {
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      } finally {
        clearSyncProgress();
        setBusy(false);
      }
    };
    const doSetUpstreamPush = async () => {
      setBusy(true);
      try {
        const r = await call("changes.pushSetUpstream");
        if (r.pushed) {
          setPushErrorKind(null);
          setError(null);
          setErrorDetail(null);
          showTransient(t("Changes_UpstreamPushed", r.remote, r.branch));
          await reload();
        } else {
          setPushErrorKind(r.errorKind);
          setError(t("Changes_PushFailed", r.errorKind ?? "other"));
        }
      } catch (e) {
        setPushErrorKind(null);
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      } finally {
        clearSyncProgress();
        setBusy(false);
      }
    };
    react.useEffect(() => {
      const cmd = app.routedCommand;
      if (!cmd || app.page !== "changes") return;
      if (cmd.id === "changes.commit") void doCommit(false);
      else if (cmd.id === "changes.commitPush") void doCommit(true);
      else if (cmd.id === "changes.stageAll") {
        const paths = [...(state == null ? void 0 : state.changes) ?? [], ...(state == null ? void 0 : state.unversioned) ?? []].map((f) => f.path);
        void run(async () => {
          await call("changes.stage", { paths });
          return t("Changes_StagedAll");
        });
      } else if (cmd.id === "changes.unstageAll") {
        const paths = ((state == null ? void 0 : state.staged) ?? []).map((f) => f.path);
        void run(async () => {
          await call("changes.unstage", { paths });
          return t("Changes_UnstagedAll");
        });
      }
    }, [app.routedCommand]);
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "◇" }),
        t("Common_NoProjectSelected")
      ] });
    }
    const group = (gkey, title, files, stagedView, allowCheck) => {
      if (files.length === 0) return null;
      const eligible = files.filter((f) => !f.isConflict);
      const allChecked = allowCheck && eligible.length > 0 && eligible.every((f) => checked.has(f.path));
      const someChecked = eligible.some((f) => checked.has(f.path));
      const checkedPaths = eligible.filter((f) => checked.has(f.path)).map((f) => f.path);
      const toggleAll = () => setChecked((prev) => {
        const next = new Set(prev);
        for (const f of eligible) {
          if (allChecked) next.delete(f.path);
          else next.add(f.path);
        }
        return next;
      });
      const collapsed = collapsedGroups.has(gkey);
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "group-header", style: { cursor: "pointer", userSelect: "none" }, onClick: () => toggleGroup(gkey), children: [
          allowCheck && eligible.length > 0 && /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              type: "checkbox",
              checked: allChecked,
              ref: (el) => {
                if (el) el.indeterminate = someChecked && !allChecked;
              },
              onChange: toggleAll,
              onClick: (e) => e.stopPropagation(),
              title: allChecked ? t("Changes_UncheckAll") : t("Changes_CheckAll")
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { width: 12, color: "var(--c-text3)", fontSize: 10 }, children: collapsed ? "▸" : "▾" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: title }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontWeight: 400 }, children: files.length }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow", style: { flex: 1 } }),
          !stagedView && someChecked && /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn",
              style: { padding: "1px 8px", height: 20, fontSize: 11 },
              disabled: busy,
              onClick: (e) => {
                e.stopPropagation();
                void run(async () => {
                  await call("changes.stage", { paths: checkedPaths });
                  return t("Changes_Staged");
                });
              },
              children: t("Changes_StageChecked", checkedPaths.length)
            }
          )
        ] }),
        !collapsed && files.map((f) => /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            className: "list-row" + ((selected == null ? void 0 : selected.path) === f.path && (selected == null ? void 0 : selected.staged) === stagedView ? " selected" : ""),
            onClick: () => select(f, stagedView),
            onContextMenu: (e) => {
              void (async () => {
                const local = [
                  stagedView ? { label: t("Changes_UnstageFile"), action: () => void run(async () => {
                    await call("changes.unstage", { paths: [f.path] });
                    return t("Changes_Unstaged");
                  }) } : { label: t("Changes_StageFile"), action: () => void run(async () => {
                    await call("changes.stage", { paths: [f.path] });
                    return t("Changes_Staged");
                  }) },
                  ...f.isConflict ? [{ label: t("Changes_MarkResolved"), action: () => void run(async () => {
                    await call("changes.stage", { paths: [f.path] });
                    return t("Changes_MarkedResolved");
                  }) }] : [],
                  { sep: true, label: "", action: () => {
                  } }
                ];
                showMenu(e, [...local, ...await seamMenuItems("changesFile", f.path)]);
              })();
            },
            children: [
              allowCheck && !f.isConflict && /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: checked.has(f.path), onChange: () => toggleCheck(f.path) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "status-letter st-" + statusLetter(f), children: statusLetter(f) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { flex: 1, fontFamily: "var(--mono)", fontSize: 12 }, children: f.path }),
              f.added !== null && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-add", children: [
                "+",
                f.added
              ] }),
              f.deleted !== null && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-del", children: [
                "−",
                f.deleted
              ] })
            ]
          },
          f.category + f.path
        ))
      ] });
    };
    const hasSelectedHunks = selectedHunks.size > 0 && diff && !diff.isBinary;
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !repo || busy, onClick: () => void run(async () => {
          await call("changes.fetch", {});
          return t("Changes_Fetched");
        }), children: t("Changes_Fetch") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !repo || busy, onClick: () => void run(async () => {
          await call("changes.pull", { rebase: false });
          return t("Changes_Pulled");
        }), children: t("Changes_Pull") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !repo || busy, onClick: () => void run(async () => {
          await call("changes.pull", { rebase: true });
          return t("Changes_PulledRebase");
        }), children: t("Changes_PullRebase") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !repo || busy, onClick: () => void doPush(), children: t("Changes_Push") }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setCreateBranch(""), children: t("Branches_Create") })
      ] }),
      error && /* @__PURE__ */ jsxRuntime.jsx(
        Banner,
        {
          text: error,
          error: true,
          detail: errorDetail ?? void 0,
          onCopyDetail: errorDetail ? () => navigator.clipboard.writeText(errorDetail) : void 0,
          onClose: () => {
            setError(null);
            setErrorDetail(null);
            setPushErrorKind(null);
          },
          actions: pushErrorKind === "noUpstream" ? [
            { label: t("Changes_SetUpstreamPush"), onClick: () => void doSetUpstreamPush() },
            { label: t("Common_GoToSettings"), onClick: () => openSettings("git") }
          ] : pushErrorKind === "noRemote" || errorDetail === "NO_REMOTE" ? [{ label: t("Common_GoToSettings"), onClick: () => openSettings("git") }] : void 0
        }
      ),
      transient && /* @__PURE__ */ jsxRuntime.jsx(Banner, { text: transient, onClose: () => setTransient(null) }),
      busy && /* @__PURE__ */ jsxRuntime.jsx(SyncBar, { progress: syncProgress }),
      feedback && /* @__PURE__ */ jsxRuntime.jsx(
        Banner,
        {
          text: t("Changes_AgentFeedback", feedback.note),
          detail: feedback.path ?? void 0,
          onOpenDetail: feedback.path ? () => void call("shell.openPath", { path: feedback.path, editor: true }) : void 0,
          onClose: async () => {
            await call("changes.clearFeedback", {});
            setFeedback(null);
          },
          actions: [
            {
              label: t("Changes_SendToRepair"),
              onClick: () => void (async () => {
                try {
                  const r = await call("review.repair", {});
                  setFeedback(null);
                  setTransient(t("Changes_RepairSent", r.task.title));
                  navigate("tasks");
                } catch (e) {
                  setTransient(e.message);
                }
              })()
            }
          ]
        }
      ),
      activeFindings.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "banner" + (activeFindings.some((f) => f.severity === "blocked") ? " error" : ""),
          style: { flexDirection: "column", alignItems: "stretch", gap: 2 },
          children: [
            (showAllFindings ? activeFindings : activeFindings.slice(0, 6)).map((f, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner-text", style: { display: "flex", alignItems: "center", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: f.severity === "blocked" ? "⛔" : "⚠️" }),
              /* @__PURE__ */ jsxRuntime.jsxs(
                "span",
                {
                  className: "finding-link",
                  style: { fontFamily: "var(--mono)", cursor: "pointer", textDecoration: "underline", color: "var(--c-accent)" },
                  onClick: () => jumpToFinding(f),
                  title: t("Changes_JumpToFinding"),
                  children: [
                    f.filePath,
                    f.line ? `:${f.line}` : ""
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text2)" }, children: [
                "— ",
                f.message
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "tool-btn",
                  style: { padding: "0 6px", height: 18, fontSize: 10 },
                  title: t("Changes_MarkResolved"),
                  onClick: () => dismissFinding(f),
                  children: t("Changes_MarkResolved")
                }
              )
            ] }, findingKey(f) + i)),
            !showAllFindings && activeFindings.length > 6 && /* @__PURE__ */ jsxRuntime.jsxs(
              "button",
              {
                className: "tool-btn",
                style: { alignSelf: "flex-start", padding: "0 4px", fontSize: 11, color: "var(--c-accent)" },
                onClick: () => setShowAllFindings(true),
                children: [
                  t("Changes_MoreFindings", activeFindings.length - 6),
                  " ▾"
                ]
              }
            ),
            showAllFindings && activeFindings.length > 6 && /* @__PURE__ */ jsxRuntime.jsxs(
              "button",
              {
                className: "tool-btn",
                style: { alignSelf: "flex-start", padding: "0 4px", fontSize: 11 },
                onClick: () => setShowAllFindings(false),
                children: [
                  t("Common_Collapse"),
                  " ▴"
                ]
              }
            )
          ]
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx(SplitPane, { settingKey: "changesSplitterFraction", initial: 0.38, a: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "split-pane", style: { display: "flex", flexDirection: "column" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, overflow: "auto" }, children: state && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          group("conflicts", t("Changes_Conflicts"), state.conflicts, false, false),
          group("staged", t("Changes_StagedGroup"), state.staged, true, true),
          group("changes", t("Changes_ChangesGroup"), state.changes, false, true),
          group("unversioned", t("Changes_UnversionedGroup"), state.unversioned, false, true),
          allFiles.length === 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
            t("Changes_WorktreeClean"),
            /* @__PURE__ */ jsxRuntime.jsx(EmptyHints, { slot: "changes.empty" })
          ] })
        ] }) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "commit-box", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "prefix-row", children: [
            PREFIXES.map((p) => /* @__PURE__ */ jsxRuntime.jsx("button", { className: "prefix-chip", onClick: () => setMessage((m) => m.trim() ? m : p + " "), children: p }, p)),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow", style: { flex: 1 } }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: aiBusy || ((state == null ? void 0 : state.staged.length) ?? 0) === 0, onClick: () => void generateMessage(), children: aiBusy ? t("Common_Loading") : t("Changes_AiGenerate") }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: aiBusy || ((state == null ? void 0 : state.staged.length) ?? 0) === 0, onClick: () => void explain("explain"), children: t("Changes_AiExplain") }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: aiBusy || ((state == null ? void 0 : state.staged.length) ?? 0) === 0, onClick: () => void explain("review"), children: t("Changes_AiReview") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx(CommitBlocks, { fileCount: (state == null ? void 0 : state.staged.length) ?? 0 }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "textarea",
            {
              placeholder: t("Changes_CommitMessagePlaceholder"),
              value: message,
              onChange: (e) => setMessage(e.target.value),
              onKeyDown: (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void doCommit(false);
                }
              }
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "commit-actions", children: [
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", disabled: !canCommit, onClick: () => void doCommit(false), children: t("Changes_Commit") }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !canCommit, onClick: () => void doCommit(true), children: t("Changes_CommitAndPush") })
          ] })
        ] })
      ] }), b: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "split-pane", style: { display: "flex", flexDirection: "column" }, children: [
        selected && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", style: { borderBottom: "none" }, children: [
          selected.staged ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn",
                disabled: busy,
                onClick: () => void run(async () => {
                  await call("changes.unstage", { paths: [selected.path] });
                  setSelected(null);
                  setDiff(null);
                  return t("Changes_Unstaged");
                }),
                children: t("Changes_UnstageFile")
              }
            ),
            hasSelectedHunks && /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn primary",
                disabled: busy,
                onClick: () => void run(async () => {
                  await call("changes.unstageHunks", { path: selected.path, indices: [...selectedHunks] });
                  return t("Changes_UnstagedHunks");
                }),
                children: t("Changes_UnstageHunkSelected", selectedHunks.size)
              }
            )
          ] }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn primary",
                disabled: busy,
                onClick: () => void run(async () => {
                  await call("changes.stage", { paths: [selected.path] });
                  setSelected(null);
                  setDiff(null);
                  return t("Changes_Staged");
                }),
                children: t("Changes_StageFile")
              }
            ),
            hasSelectedHunks && /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn primary",
                disabled: busy,
                onClick: () => void run(async () => {
                  await call("changes.stageHunks", { path: selected.path, indices: [...selectedHunks] });
                  return t("Changes_StagedHunks");
                }),
                children: t("Changes_StageHunkSelected", selectedHunks.size)
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("shell.openPath", { path: selected.path, editor: true }), children: t("Changes_OpenInEditor") })
        ] }),
        (selected == null ? void 0 : selected.isConflict) && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "banner", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: t("Changes_ConflictCompareHint") }) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, overflow: "auto", minHeight: 0 }, children: selected && preview ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "diff-file-header", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "path", children: selected.path }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { marginLeft: "auto", color: "var(--c-text3)", fontSize: 11 }, children: preview.fromIndex ? t("Changes_PreviewStaged") : t("Changes_PreviewWorktree") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, minHeight: 0 }, children: preview.tooLarge ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", children: t("Changes_PreviewTooLarge") }) : /* @__PURE__ */ jsxRuntime.jsx(
            "img",
            {
              src: `data:${preview.mime};base64,${preview.base64}`,
              style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
              alt: selected.path
            }
          ) })
        ] }) : selected && diff ? /* @__PURE__ */ jsxRuntime.jsx(
          DiffView,
          {
            diff,
            focusLine,
            inline: ((_a2 = app.settings) == null ? void 0 : _a2.diffMode) === "inline",
            selectedHunks: selected.staged || selected.isNew ? void 0 : selectedHunks,
            onToggleHunk: selected.staged || selected.isNew ? void 0 : (i) => setSelectedHunks((prev) => {
              const next = new Set(prev);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              return next;
            }),
            hunkActionLabel: () => selected.staged ? t("Changes_UnstageHunk") : t("Changes_StageHunk"),
            onHunkAction: selected.staged ? (i) => void run(async () => {
              await call("changes.unstageHunks", { path: selected.path, indices: [i] });
              return t("Changes_UnstagedHunks");
            }) : selected.isNew ? void 0 : (i) => void run(async () => {
              await call("changes.stageHunks", { path: selected.path, indices: [i] });
              return t("Changes_StagedHunks");
            })
          }
        ) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", children: t("Changes_SelectFileHint") }) })
      ] }) }),
      explainText && /* @__PURE__ */ jsxRuntime.jsx(Modal, { title: explainText.title, confirmText: t("Common_Close"), onClose: () => setExplainText(null), onConfirm: () => setExplainText(null), children: /* @__PURE__ */ jsxRuntime.jsx("div", { style: { whiteSpace: "pre-wrap", maxHeight: 340, overflow: "auto", userSelect: "text", fontSize: 12.5, lineHeight: 1.5 }, children: explainText.text }) }),
      createBranch !== null && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_CreateTitle"),
          confirmText: t("Common_Create"),
          onClose: () => setCreateBranch(null),
          onConfirm: async () => {
            await run(async () => {
              await call("branches.create", { name: createBranch.trim() });
              return t("Branches_Created");
            });
            setCreateBranch(null);
            refreshCurrent();
          },
          children: /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "input",
              style: { width: "100%" },
              autoFocus: true,
              placeholder: t("Branches_NamePlaceholder"),
              value: createBranch,
              onChange: (e) => setCreateBranch(e.target.value)
            }
          )
        }
      ),
      menuElement
    ] });
  }
  function statusLetter(f) {
    if (f.isConflict) return "U";
    if (f.category === "unversioned") return "U";
    if (f.category === "staged") return "A";
    return "M";
  }
  function useCommitBlocks(fileCount) {
    const [blocks, setBlocks] = react.useState([]);
    react.useEffect(() => {
      void call("ui.commitBlocks", { fileCount, message: "" }).then(setBlocks);
    }, [fileCount]);
    return blocks;
  }
  function CommitBlocks({ fileCount }) {
    const blocks = useCommitBlocks(fileCount);
    if (blocks.length === 0) return null;
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "hint", style: { whiteSpace: "pre-wrap" }, children: blocks.map((b, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
      "▸ ",
      b.text,
      /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
        "（",
        b.packageId,
        "）"
      ] })
    ] }, i)) });
  }
  function EmptyHints({ slot }) {
    const [hints, setHints] = react.useState([]);
    react.useEffect(() => {
      void call("ui.emptyHints", { slot }).then((r) => setHints(r.map((x) => x.text)));
    }, [slot]);
    if (hints.length === 0) return null;
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "hint", style: { marginTop: 6 }, children: hints.join("  ·  ") });
  }
  window.GITTER_UI.registerPage({ id: "changes" }, (container) => {
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "changes",
        children: React.createElement(ChangesPage)
      })
    );
    return () => root.unmount();
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
