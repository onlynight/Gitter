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
    openRepo: (path) => U().openRepo(path),
    closeRepo: () => U().closeRepo()
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  const { call, t, openRepo, closeRepo } = pageSdk;
  const useApp = useAppState;
  const VIEW_KEY = "gitter.projects.view";
  const VIEWS = [
    { id: "card", labelKey: "Projects_ViewCard", glyph: "" },
    // GridView
    { id: "tile", labelKey: "Projects_ViewTiles", glyph: "" },
    // Tiles
    { id: "list", labelKey: "Projects_ViewList", glyph: "" },
    // List
    { id: "details", labelKey: "Projects_ViewDetails", glyph: "" }
    // CheckList
  ];
  function loadViewMode() {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "tile" || v === "list" || v === "details") return v;
    } catch {
    }
    return "card";
  }
  function ProjectsPage() {
    const app = useApp();
    const [state, setStateDto] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [view, setView] = react.useState(loadViewMode);
    const reload = react.useCallback(async () => {
      try {
        setStateDto(await call("projects.list"));
      } catch (e) {
        setError(e.message);
      }
    }, []);
    react.useEffect(() => {
      void reload();
    }, [app.refreshTick, reload]);
    const open = async (p) => {
      try {
        await openRepo(p.path);
      } catch (e) {
        setError(e.message);
      }
    };
    const add = async () => {
      try {
        const p = await call("projects.add");
        if (p) await open(p);
        await reload();
      } catch (e) {
        setError(e.message);
      }
    };
    const remove = async (p) => {
      await call("projects.remove", { path: p.path });
      closeRepo();
      await reload();
    };
    const switchView = (v) => {
      setView(v);
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch {
      }
    };
    const onSegKeyDown = (e) => {
      var _a2;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const i = VIEWS.findIndex((v) => v.id === view);
      const next = VIEWS[(i + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length];
      switchView(next.id);
      (_a2 = e.currentTarget.querySelector(`button[data-view="${next.id}"]`)) == null ? void 0 : _a2.focus();
    };
    const rowActions = (p) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "row-actions", onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "act", "data-tip": t("Projects_Open"), onClick: () => void open(p), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "act", "data-tip": t("Projects_NewWindow"), onClick: () => void call("app.newWindow", { path: p.path }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "act danger", "data-tip": t("Projects_Remove"), onClick: () => void remove(p), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) })
    ] });
    const currentChip = (p) => (state == null ? void 0 : state.currentPath) === p.path ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Projects_Current") }) : null;
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Projects_AddProject"), onClick: () => void add(), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "view-label", children: t(VIEWS.find((v) => v.id === view).labelKey) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "view-seg", role: "radiogroup", "aria-label": t("Projects_View"), onKeyDown: onSegKeyDown, children: VIEWS.map((v) => /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            "data-view": v.id,
            role: "radio",
            "aria-checked": view === v.id,
            className: view === v.id ? "on" : "",
            "data-tip": t(v.labelKey),
            onClick: () => switchView(v.id),
            children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: v.glyph })
          },
          v.id
        )) })
      ] }),
      error && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: error }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setError(null), children: "✕" })
      ] }),
      state && state.projects.length === 0 ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "📁" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Projects_EmptyHint") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Projects_AddProject"), onClick: () => void add(), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) })
      ] }) : view === "card" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-grid", children: state == null ? void 0 : state.projects.map((p) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card", onClick: () => void open(p), children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-title", children: [
          "📁 ",
          p.name,
          currentChip(p)
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: p.path }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-actions", onClick: (e) => e.stopPropagation(), children: [
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon sm", "data-tip": t("Projects_Open"), onClick: () => void open(p), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", style: { fontSize: 11 }, children: "" }) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon sm", "data-tip": t("Projects_NewWindow"), onClick: () => void call("app.newWindow", { path: p.path }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", style: { fontSize: 11 }, children: "" }) }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn icon sm",
              "data-tip": t("Projects_Remove"),
              style: { color: "var(--c-red)" },
              onClick: () => void remove(p),
              children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", style: { fontSize: 11 }, children: "" })
            }
          )
        ] })
      ] }, p.path)) }) : view === "tile" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tile-grid", children: state == null ? void 0 : state.projects.map((p) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tile", onClick: () => void open(p), children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "t-ico", children: "📁" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "t-main", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "t-name", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", children: p.name }),
            currentChip(p)
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "t-path", children: p.path })
        ] }),
        rowActions(p)
      ] }, p.path)) }) : view === "list" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "proj-list", children: state == null ? void 0 : state.projects.map((p) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lrow", onClick: () => void open(p), children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "l-ico", children: "📁" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", children: p.name }),
        currentChip(p),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "pth", children: p.path }),
        rowActions(p)
      ] }, p.path)) }) : /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "proj-details", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "dhead", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Projects_ColName") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Projects_ColPath") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dh-last", children: t("Projects_ColActions") })
        ] }),
        state == null ? void 0 : state.projects.map((p) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "drow", onClick: () => void open(p), children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "nm", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { children: "📁" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "t", children: p.name }),
            currentChip(p)
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "pth", children: p.path }),
          rowActions(p)
        ] }, p.path))
      ] })
    ] });
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
  K().Banner;
  K().Modal;
  K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  K().Select;
  K().ReflogDialog;
  K().ScrollArea;
  window.GITTER_UI.registerPage({ id: "projects" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "projects",
        children: React.createElement(ProjectsPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
