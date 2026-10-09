(function(jsxRuntime, react) {
  "use strict";
  var _a, _b;
  function U() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  const BOOT = ((_b = (_a = window.GITTER_UI) == null ? void 0 : _a.getActiveCaller) == null ? void 0 : _b.call(_a)) ?? null;
  (() => {
    var _a2, _b2;
    try {
      return ((_b2 = (_a2 = window.GITTER_UI) == null ? void 0 : _a2.pageDocs) == null ? void 0 : _b2.call(_a2)) ?? null;
    } catch {
      return null;
    }
  })();
  const pageSdk = {
    call: (method, params) => {
      const g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    t: (key, ...args) => U().t(key, ...args),
    openSettings: (section) => U().openSettings(section)
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
  K().DiffView;
  K().diffStatusLetter;
  K().renderSegments;
  K().wordDiff;
  K().SplitPane;
  const Banner = K().Banner;
  const Modal = K().Modal;
  const useContextMenu = K().useContextMenu;
  const SyncBar = K().SyncBar;
  const useSyncProgress = K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  const Select = K().Select;
  const ReflogDialog = K().ReflogDialog;
  K().ScrollArea;
  const { call, t, openSettings } = pageSdk;
  const useApp = useAppState;
  function isNoUpstreamError(msg) {
    if (!msg) return false;
    return /push\.autoSetupRemote|set-upstream|no upstream|上游/i.test(msg);
  }
  const GRAPH_LANE_W = 26;
  const GRAPH_ROW_H = 28;
  const GRAPH_PAD = 14;
  const GRAPH_COLORS = ["#6BABF5", "#B9A3EC", "#3FB950", "#E3B341", "#F0655A", "#56D364"];
  function BranchGraphPane(props) {
    const [sel, setSel] = react.useState(null);
    let slots = [];
    const colorOf = /* @__PURE__ */ new Map();
    const colorOfId = (id) => {
      if (!colorOf.has(id)) colorOf.set(id, GRAPH_COLORS[colorOf.size % GRAPH_COLORS.length]);
      return colorOf.get(id);
    };
    const segs = [];
    const rowEls = [];
    props.graph.rows.forEach((r, i) => {
      const top = i * GRAPH_ROW_H, mid = top + GRAPH_ROW_H / 2, bottom = top + GRAPH_ROW_H;
      const slotOf = (id) => slots.indexOf(id);
      const mergeFroms = new Set(r.merges.map((m) => m.from));
      const line = (x, y1, y2, c) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${c}" stroke-width="2" />`;
      const curve = (x1, y1, x2, y2, c) => `<path d="M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}" stroke="${c}" stroke-width="2" fill="none" />`;
      for (const id of slots) {
        if (mergeFroms.has(id)) continue;
        segs.push(line(GRAPH_PAD + slotOf(id) * GRAPH_LANE_W, top, bottom, colorOfId(id)));
      }
      for (const m of r.merges) segs.push(curve(GRAPH_PAD + slotOf(m.from) * GRAPH_LANE_W, top, GRAPH_PAD + slotOf(m.to) * GRAPH_LANE_W, mid, colorOfId(m.from)));
      const dotSlot = slotOf(r.lane);
      const dotX = GRAPH_PAD + dotSlot * GRAPH_LANE_W;
      const isHead = r.refs.some((x) => x.isHead);
      segs.push(`<circle cx="${dotX}" cy="${mid}" r="${isHead ? 6 : 4.5}" fill="${colorOfId(r.lane)}" stroke="var(--c-base)" stroke-width="${isHead ? 2 : 1.5}" />`);
      if (isHead) segs.push(`<circle cx="${dotX}" cy="${mid}" r="9" fill="none" stroke="${colorOfId(r.lane)}" stroke-width="1" opacity=".55" />`);
      for (const id of r.spawns) {
        segs.push(curve(dotX, mid, GRAPH_PAD + r.slotAfter.indexOf(id) * GRAPH_LANE_W, bottom, colorOfId(id)));
      }
      slots = r.slotAfter;
      r.refs.filter((x) => !x.isHead).map((x) => x.name);
      rowEls.push(
        /* @__PURE__ */ jsxRuntime.jsx(
          "div",
          {
            className: "grow-row" + (sel === r.sha ? " sel" : ""),
            style: { top },
            title: `${r.shortSha} ${r.subject} · ${r.author}`,
            onClick: () => setSel(r.sha),
            children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "grow-txt", style: { left: GRAPH_PAD + slots.length * GRAPH_LANE_W + 10 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow-sha", children: r.shortSha }),
              r.refs.map((x) => /* @__PURE__ */ jsxRuntime.jsx("span", { className: "badge" + (x.isTag ? " tag" : "") + (x.isHead ? " head" : ""), children: x.name }, x.name)),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow-subject", children: r.subject })
            ] })
          },
          r.sha + i
        )
      );
    });
    const slotsMax = Math.max(slots.length, 3);
    const svgW = GRAPH_PAD + slotsMax * GRAPH_LANE_W + 6;
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { height: props.graph.rows.length * GRAPH_ROW_H + 8, position: "relative", minWidth: svgW + 130 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "svg",
          {
            width: svgW,
            height: props.graph.rows.length * GRAPH_ROW_H + 8,
            style: { position: "absolute", left: 0, top: 4 },
            dangerouslySetInnerHTML: { __html: segs.join("") }
          }
        ),
        rowEls
      ] }),
      props.graph.hasMore && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { textAlign: "center", padding: "4px 0 8px" }, children: /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: props.loading, onClick: props.onLoadMore, children: t("Branches_LoadMore") }) })
    ] });
  }
  function BranchesPage() {
    var _a2;
    const app = useApp();
    const repo = app.repo;
    const [state, setState] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [errorDetail, setErrorDetail] = react.useState(null);
    const [transient, setTransient] = react.useState(null);
    const [busy, setBusy] = react.useState(false);
    const [selected, setSelected] = react.useState(null);
    const [graph, setGraph] = react.useState(null);
    const [graphLoading, setGraphLoading] = react.useState(false);
    const [dialog, setDialog] = react.useState(null);
    const { showMenu, menuElement } = useContextMenu();
    const [syncProgress, clearSyncProgress] = useSyncProgress();
    const reload = react.useCallback(async () => {
      if (!repo) return;
      try {
        setState(await call("branches.state"));
        setError(null);
        setErrorDetail(null);
      } catch (e) {
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      }
    }, [repo]);
    const loadGraph = react.useCallback(async () => {
      if (!repo) return;
      setGraphLoading(true);
      try {
        setGraph(await call("branch.graph", { limit: 300 }));
        setError(null);
      } catch {
        setGraph(null);
      } finally {
        setGraphLoading(false);
      }
    }, [repo]);
    const loadMoreGraph = react.useCallback(async () => {
      if (!graph || graphLoading) return;
      setGraphLoading(true);
      try {
        const more = await call("branch.graph", { limit: 300, skip: graph.rows.length });
        setGraph({ rows: [...graph.rows, ...more.rows], hasMore: more.hasMore });
      } finally {
        setGraphLoading(false);
      }
    }, [graph, graphLoading]);
    react.useEffect(() => {
      void reload();
      void loadGraph();
    }, [repo, app.refreshTick]);
    react.useEffect(() => {
      var _a3;
      if (((_a3 = app.routedCommand) == null ? void 0 : _a3.id) === "branches.create") {
        setDialog({ kind: "create", name: "", startPoint: "HEAD", startPointTab: "branch", checkout: true });
      }
    }, [app.routedCommand]);
    const startPointOptions = () => {
      const cur = (state == null ? void 0 : state.current) ?? null;
      return [
        // 钉住项：置顶、不受搜索过滤（默认起点永远可选）
        { value: "HEAD", label: t("Branches_StartHead", cur ?? "HEAD"), tab: "branch", pinned: true, triggerBadge: "head", keywords: `head ${cur ?? ""}` },
        ...((state == null ? void 0 : state.local) ?? []).filter((b) => b.name !== cur).map((b) => ({ value: "refs/heads/" + b.name, label: b.name, group: t("Branches_LocalGroup"), tab: "branch", triggerBadge: "branch" })),
        ...((state == null ? void 0 : state.remote) ?? []).map((b) => ({ value: "refs/remotes/" + b.name, label: b.name, group: t("Branches_RemoteGroup"), tab: "branch", triggerBadge: "branch" })),
        ...((state == null ? void 0 : state.tags) ?? []).map((tg) => ({ value: "refs/tags/" + tg.name, label: tg.name, group: t("Branches_TagGroup"), tab: "tag", badge: t("Branches_TagSuffix"), hint: tg.shortSha || void 0, triggerBadge: "tag" }))
      ];
    };
    const startPointType = (v) => v.startsWith("refs/tags/") ? "tag" : "branch";
    const mergeSourceOptions = () => [
      ...((state == null ? void 0 : state.local) ?? []).map((b) => ({ value: "refs/heads/" + b.name, label: b.name })),
      ...((state == null ? void 0 : state.remote) ?? []).map((b) => ({ value: "refs/remotes/" + b.name, label: b.name }))
    ];
    const mergeTargetOptions = () => ((state == null ? void 0 : state.local) ?? []).map((b) => ({ value: b.name, label: b.name }));
    const tagMenu = (name) => [
      { label: t("Branches_CreateBranchFromTag"), action: () => setDialog({ kind: "create", name: "", startPoint: "refs/tags/" + name, startPointTab: "tag", checkout: true }) },
      { sep: true, label: "", action: () => {
      } },
      { label: t("Branches_DeleteTag"), action: () => setDialog({ kind: "deleteTag", name }) }
    ];
    const run = async (fn) => {
      setBusy(true);
      try {
        setTransient(await fn());
        await reload();
      } catch (e) {
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      } finally {
        clearSyncProgress();
        setBusy(false);
      }
    };
    const branchMenu = (name, isRemote) => {
      if (isRemote) {
        return [
          { label: t("Branches_CheckoutLocal"), action: () => void run(async () => {
            const local = await call("branches.checkoutRemote", { name });
            return t("Branches_CheckedOut", local);
          }) },
          { label: t("Branches_FastForward"), action: () => void run(async () => {
            await call("branches.ff", { name });
            return t("Branches_FastForwarded");
          }) },
          { sep: true, label: "", action: () => {
          } },
          { label: t("Branches_DeleteRemote"), action: () => setDialog({ kind: "deleteRemote", name }) }
        ];
      }
      const isCurrent = (state == null ? void 0 : state.current) === name;
      return [
        ...isCurrent ? [] : [{ label: t("Branches_Checkout"), action: () => void run(async () => {
          await call("branches.checkout", { name });
          return t("Branches_CheckedOut", name);
        }) }],
        { label: t("Branches_Rename"), action: () => setDialog({ kind: "rename", oldName: name, newName: name }) },
        { label: t("Reflog_View"), action: () => setDialog({ kind: "reflog", name }) },
        { sep: true, label: "", action: () => {
        } },
        { label: t("Branches_Merge"), action: () => {
          var _a3, _b2;
          return setDialog({ kind: "merge", source: "refs/heads/" + name, target: (state == null ? void 0 : state.current) ?? ((_b2 = (_a3 = state == null ? void 0 : state.local) == null ? void 0 : _a3[0]) == null ? void 0 : _b2.name) ?? "", noFf: false, message: "" });
        } },
        { label: t("Branches_Rebase"), action: () => void run(async () => {
          await call("branches.rebase", { name });
          return t("Branches_Rebased", name);
        }) },
        { sep: true, label: "", action: () => {
        } },
        { label: t("Branches_Delete"), action: () => void (async () => {
          try {
            const preview = await call("branches.deletePreview", { name });
            setDialog({ kind: "deletePreview", name, preview });
          } catch (e) {
            setError(e.message);
            setErrorDetail(e.detail ?? null);
          }
        })() }
      ];
    };
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "⑂" }),
        t("Common_NoProjectSelected")
      ] });
    }
    const groupHeader = (title, count) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "group-header solid", children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { children: title }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontWeight: 400 }, children: count })
    ] });
    const renderBranchRows = (remote) => (remote ? (state == null ? void 0 : state.remote) ?? [] : (state == null ? void 0 : state.local) ?? []).map((b) => /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: "list-row" + ((selected == null ? void 0 : selected.kind) === (remote ? "remote" : "local") && (selected == null ? void 0 : selected.name) === b.name ? " selected" : ""),
        onClick: () => setSelected({ kind: remote ? "remote" : "local", name: b.name }),
        onContextMenu: (e) => {
          setSelected({ kind: remote ? "remote" : "local", name: b.name });
          void (async () => {
            showMenu(e, [...branchMenu(b.name, remote), ...await seamMenuItems("branchRow")]);
          })();
        },
        children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: b.shortSha }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "trim", style: { flex: 1 }, children: [
            b.name,
            (state == null ? void 0 : state.current) === b.name && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "badge", style: { marginLeft: 6 }, children: "HEAD" })
          ] }),
          !remote && b.ahead != null && b.ahead > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chip ahead", title: t("Branches_AheadBehind", b.ahead, 0), children: [
            "↑",
            b.ahead
          ] }),
          !remote && b.behind != null && b.behind > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chip behind", title: t("Branches_AheadBehind", 0, b.behind), children: [
            "↓",
            b.behind
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { color: "var(--c-text3)", fontSize: 11, maxWidth: 180 }, children: b.subject })
        ]
      },
      b.name
    ));
    const renderTagRows = () => ((state == null ? void 0 : state.tags) ?? []).map((tg) => /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: "list-row" + ((selected == null ? void 0 : selected.kind) === "tag" && (selected == null ? void 0 : selected.name) === tg.name ? " selected" : ""),
        onClick: () => setSelected({ kind: "tag", name: tg.name }),
        onContextMenu: (e) => {
          setSelected({ kind: "tag", name: tg.name });
          showMenu(e, tagMenu(tg.name));
        },
        children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: tg.shortSha }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { flex: 1 }, children: tg.name }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { color: "var(--c-text3)", fontSize: 11, maxWidth: 140 }, children: tg.subject })
        ]
      },
      tg.name
    ));
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_Create"), onClick: () => setDialog({ kind: "create", name: "", startPoint: "HEAD", startPointTab: "branch", checkout: true }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_Pull"), disabled: busy, onClick: () => void run(async () => {
          await call("branches.pull", { rebase: false });
          return t("Branches_Pulled");
        }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_PullRebase"), disabled: busy, onClick: () => void run(async () => {
          await call("branches.pull", { rebase: true });
          return t("Branches_PulledRebase");
        }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_Push"), disabled: busy, onClick: () => void run(async () => {
          await call("branches.push", {});
          return t("Branches_Pushed");
        }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) })
      ] }),
      error && /* @__PURE__ */ jsxRuntime.jsx(
        Banner,
        {
          text: error,
          detail: errorDetail ?? void 0,
          error: true,
          onCopyDetail: errorDetail ? () => navigator.clipboard.writeText(errorDetail) : void 0,
          onClose: () => {
            setError(null);
            setErrorDetail(null);
          },
          actions: isNoUpstreamError(error) ? [{ label: t("Common_GoToSettings"), onClick: () => openSettings("git") }] : void 0
        }
      ),
      transient && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: transient }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setTransient(null), children: "✕" })
      ] }),
      busy && /* @__PURE__ */ jsxRuntime.jsx(SyncBar, { progress: syncProgress }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", gap: 10, margin: "8px 12px 10px" }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "pane-card", style: { flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: [
          groupHeader(t("Branches_Graph"), (graph == null ? void 0 : graph.rows.length) ?? 0),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "branch-graph-scroll", children: graph ? graph.rows.length > 0 ? /* @__PURE__ */ jsxRuntime.jsx(BranchGraphPane, { graph, loading: graphLoading, onLoadMore: () => void loadMoreGraph() }) : /* @__PURE__ */ jsxRuntime.jsx("div", { style: { padding: "14px 12px", color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_NoTags") }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", children: graphLoading ? t("Common_Loading") : t("Branches_NoTags") }) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "pane-card", style: { flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: state ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" }, children: [
          groupHeader(t("Branches_LocalGroup"), state.local.length),
          renderBranchRows(false),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { height: 8 } }),
          groupHeader(t("Branches_RemoteGroup"), state.remote.length),
          renderBranchRows(true)
        ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", style: { flex: 1 }, children: t("Common_Loading") }) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "pane-card", style: { flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: state ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" }, children: [
          groupHeader(t("Branches_TagGroup"), state.tags.length),
          state.tags.length > 0 ? renderTagRows() : /* @__PURE__ */ jsxRuntime.jsx("div", { style: { padding: "14px 12px", color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_NoTags") })
        ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", style: { flex: 1 }, children: t("Common_Loading") }) })
      ] }),
      (dialog == null ? void 0 : dialog.kind) === "create" && /* @__PURE__ */ jsxRuntime.jsxs(
        Modal,
        {
          title: t("Branches_CreateTitle"),
          confirmText: t("Common_Create"),
          confirmDisabled: !dialog.name.trim() || !dialog.startPoint,
          onClose: () => setDialog(null),
          onConfirm: () => {
            const name = dialog.name.trim();
            const from = dialog.startPoint === "HEAD" ? null : dialog.startPoint;
            void run(async () => {
              await call("branches.create", { name, fromSha: from, checkout: dialog.checkout });
              return t("Branches_Created", name);
            });
            setDialog(null);
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                autoFocus: true,
                className: "input",
                style: { width: "100%" },
                placeholder: t("Branches_NamePlaceholder"),
                value: dialog.name,
                onChange: (e) => setDialog({ ...dialog, name: e.target.value })
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_StartPoint") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "full",
                  style: { width: "100%" },
                  value: dialog.startPoint,
                  options: startPointOptions(),
                  onChange: (v) => setDialog({ ...dialog, startPoint: v }),
                  searchable: true,
                  searchPlaceholder: t("Branches_SearchPlaceholder"),
                  tabs: [{ key: "branch", label: t("Common_Branch") }, { key: "tag", label: t("Branches_TagGroup") }],
                  activeTab: dialog.startPointTab,
                  onTabChange: (key) => setDialog({
                    ...dialog,
                    startPointTab: key,
                    // 切到没有选中值的类型：清空选择（创建钮置灰），不静默代选
                    startPoint: startPointType(dialog.startPoint) === key ? dialog.startPoint : ""
                  }),
                  placeholder: t("Branches_StartPointPlaceholder")
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: dialog.checkout, onChange: (e) => setDialog({ ...dialog, checkout: e.target.checked }) }),
                t("Branches_CheckoutAfter")
              ] })
            ] })
          ]
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "rename" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_RenameTitle"),
          confirmText: t("Common_Rename"),
          confirmDisabled: !dialog.newName.trim() || dialog.newName === dialog.oldName,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("branches.rename", { oldName: dialog.oldName, newName: dialog.newName.trim() });
              return t("Branches_Renamed");
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              autoFocus: true,
              className: "input",
              style: { width: "100%" },
              value: dialog.newName,
              onChange: (e) => setDialog({ ...dialog, newName: e.target.value })
            }
          )
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "deletePreview" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_DeleteTitle", dialog.name),
          confirmText: t("Common_Delete"),
          danger: true,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              var _a3;
              await call("branches.delete", { name: dialog.name, force: (_a3 = dialog.preview) == null ? void 0 : _a3.forceRequired });
              return t("Branches_Deleted", dialog.name);
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: ((_a2 = dialog.preview) == null ? void 0 : _a2.forceRequired) ? t("Branches_DeleteLoseWarning", dialog.preview.lostCount) + " " + dialog.preview.lostSamples.map((c) => c.shortSha).join(", ") : t("Branches_DeleteSafe", dialog.name) })
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "deleteRemote" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_DeleteRemoteTitle", dialog.name),
          confirmText: t("Common_Delete"),
          danger: true,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("branches.deleteRemote", { name: dialog.name });
              return t("Branches_DeletedRemote", dialog.name);
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Branches_DeleteRemoteWarning", dialog.name) })
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "reflog" && /* @__PURE__ */ jsxRuntime.jsx(
        ReflogDialog,
        {
          refName: dialog.name,
          title: t("Reflog_Title", dialog.name),
          currentBranch: (state == null ? void 0 : state.current) ?? null,
          onChanged: () => void reload(),
          onClose: () => setDialog(null)
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "deleteTag" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_DeleteTagTitle", dialog.name),
          confirmText: t("Common_Delete"),
          danger: true,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("tags.delete", { name: dialog.name });
              return t("Branches_DeletedTag", dialog.name);
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Branches_DeleteTagSafe", dialog.name) })
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "merge" && /* @__PURE__ */ jsxRuntime.jsxs(
        Modal,
        {
          title: t("Branches_MergeTitlePlain"),
          confirmText: t("Common_Merge"),
          confirmDisabled: !dialog.source || !dialog.target,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("branches.merge", { name: dialog.source, target: dialog.target, noFf: dialog.noFf, message: dialog.message || null });
              return t("Branches_MergedInto", dialog.source.replace(/^refs\/(heads|remotes)\//, ""), dialog.target);
            });
            setDialog(null);
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_MergeSource") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "full",
                  style: { width: "100%" },
                  value: dialog.source,
                  options: mergeSourceOptions(),
                  onChange: (v) => setDialog({ ...dialog, source: v })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_MergeTarget") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "full",
                  style: { width: "100%" },
                  value: dialog.target,
                  options: mergeTargetOptions(),
                  onChange: (v) => setDialog({ ...dialog, target: v })
                }
              ),
              dialog.target !== (state == null ? void 0 : state.current) && /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_MergeTargetHint") }),
              /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: dialog.noFf, onChange: (e) => setDialog({ ...dialog, noFf: e.target.checked }) }),
                t("Branches_NoFastForward")
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                className: "input",
                style: { width: "100%" },
                placeholder: t("Branches_MergeMessagePlaceholder"),
                value: dialog.message,
                onChange: (e) => setDialog({ ...dialog, message: e.target.value })
              }
            )
          ]
        }
      ),
      menuElement
    ] });
  }
  window.GITTER_UI.registerPage({ id: "branches" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "branches",
        children: React.createElement(BranchesPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
