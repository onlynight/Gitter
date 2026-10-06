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
    openRepo: (path) => U().openRepo(path),
    closeRepo: () => U().closeRepo()
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  const { call, t, openRepo, closeRepo } = pageSdk;
  const useApp = useAppState;
  function ProjectsPage() {
    const app = useApp();
    const [state, setStateDto] = react.useState(null);
    const [error, setError] = react.useState(null);
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
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", onClick: () => void add(), children: t("Projects_AddProject") }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" })
      ] }),
      error && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: error }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setError(null), children: "✕" })
      ] }),
      state && state.projects.length === 0 ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "📁" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Projects_EmptyHint") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", onClick: () => void add(), children: t("Projects_AddProject") })
      ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-grid", children: state == null ? void 0 : state.projects.map((p) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card", onClick: () => void open(p), children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-title", children: [
          "📁 ",
          p.name,
          state.currentPath === p.path && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Projects_Current") })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: p.path }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-actions", onClick: (e) => e.stopPropagation(), children: [
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void open(p), children: t("Projects_Open") }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("app.newWindow", { path: p.path }), children: t("Projects_NewWindow") }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn",
              onClick: async () => {
                await call("projects.remove", { path: p.path });
                closeRepo();
                await reload();
              },
              children: t("Projects_Remove")
            }
          )
        ] })
      ] }, p.path)) })
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
  window.GITTER_UI.registerPage({ id: "projects" }, (container) => {
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "projects",
        children: React.createElement(ProjectsPage)
      })
    );
    return () => root.unmount();
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
