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
    on: (method, cb) => U().on(method, cb),
    t: (key, ...args) => U().t(key, ...args),
    navigate: (page) => U().navigate(page),
    openSettings: (section) => U().openSettings(section),
    toast: (title, body) => U().toast(title, body),
    refresh: () => U().refresh(),
    notifyRepoChanged: () => U().notifyRepoChanged(),
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
    runCommand: (cmd, ctx) => U().runCommand(cmd, ctx),
    extTree: () => U().extTree(),
    registerDoc: (def) => U().registerDoc(def),
    docs: () => U().docs(),
    onDocsChanged: (cb) => U().onDocsChanged(cb),
    docsVersion: () => U().docsVersion()
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  const PPTX_EXTS = /* @__PURE__ */ new Set([".pptx", ".pptm", ".ppsx"]);
  const DOCX_EXTS = /* @__PURE__ */ new Set([".docx", ".docm", ".dotx"]);
  const XLSX_EXTS = /* @__PURE__ */ new Set([".xlsx", ".xlsm", ".xltx"]);
  function officeKindOf(p) {
    const i = p.lastIndexOf(".");
    if (i < 0) return null;
    const ext = p.slice(i).toLowerCase();
    if (PPTX_EXTS.has(ext)) return "pptx";
    if (DOCX_EXTS.has(ext)) return "docx";
    if (XLSX_EXTS.has(ext)) return "xlsx";
    return null;
  }
  function officeExtLabel(p) {
    const i = p.lastIndexOf(".");
    return i >= 0 ? p.slice(i + 1).toUpperCase() : "";
  }
  const SIDEBAR_KEY = "gitter.office.sidebar";
  const SIDEBAR_DEFAULT = 248;
  const SIDEBAR_MIN = 170;
  const SIDEBAR_MAX = 420;
  function loadWidth() {
    const raw = window.localStorage.getItem(SIDEBAR_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)) : SIDEBAR_DEFAULT;
  }
  function OfficePage() {
    const repo = pageSdk.repo();
    useAppState().theme;
    const t = pageSdk.t;
    const [files, setFiles] = react.useState([]);
    const [active, setActive] = react.useState(null);
    const [width, setWidth] = react.useState(loadWidth);
    const activeRef = react.useRef(null);
    activeRef.current = active;
    const kind = react.useMemo(() => active ? officeKindOf(active) : null, [active]);
    const loadTree = react.useCallback(async () => {
      if (!repo) return;
      try {
        const r = await pageSdk.call("repo.tree", { prefix: "", taskId: null });
        const list = (r.entries ?? []).filter((e) => !e.isDir && officeKindOf(e.path) !== null).map((e) => e.path).sort();
        setFiles(list);
      } catch {
        setFiles([]);
      }
    }, [repo]);
    react.useEffect(() => {
      void loadTree();
    }, [loadTree]);
    const dragRef = react.useRef(null);
    const onGutterDown = react.useCallback((e) => {
      dragRef.current = { startX: e.clientX, startW: width };
      e.target.setPointerCapture(e.pointerId);
      e.target.classList.add("drag");
      document.body.style.userSelect = "none";
      e.preventDefault();
    }, [width]);
    const onGutterMove = react.useCallback((e) => {
      const d = dragRef.current;
      if (!d) return;
      setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, d.startW + e.clientX - d.startX)));
    }, []);
    const onGutterUp = react.useCallback((e) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      e.target.releasePointerCapture(e.pointerId);
      e.target.classList.remove("drag");
      document.body.style.userSelect = "";
      setWidth((w) => {
        window.localStorage.setItem(SIDEBAR_KEY, String(w));
        return w;
      });
    }, []);
    const nameOf = react.useCallback((p) => p.split("/").pop() ?? p, []);
    const dirOf = react.useCallback((p) => {
      const i = p.lastIndexOf("/");
      return i >= 0 ? p.slice(0, i) : "";
    }, []);
    const openExternal = react.useCallback(() => {
      if (active && repo) void pageSdk.call("shell.openPath", { path: `${repo.workDir}/${active}`, editor: true });
    }, [active, repo]);
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { textAlign: "center", opacity: 0.7 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 32, marginBottom: 8 }, children: "📊" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Office_Empty") })
      ] }) });
    }
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-split", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-side", style: { width, flex: "none" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-pane", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-head", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "cap", children: t("Office_Title") }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-hacts", children: /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Office_Refresh"), onClick: () => void loadTree(), children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "currentColor", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8 2a6 6 0 1 0 5.65 4H12.4A4.8 4.8 0 1 1 12.2 5H9.5v1.6L6.3 4 9.5 1.4V3h2.7A6 6 0 0 0 8 2z" }) }) }) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "office-list", children: files.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-empty", children: t("Office_NoFiles") }) : files.map((p) => {
          const isActive = p === active;
          const k = officeKindOf(p);
          return /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              className: "office-row" + (isActive ? " active" : ""),
              title: p,
              onClick: () => setActive(p),
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "office-ext k-" + (k ?? ""), children: officeExtLabel(p) }),
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "office-nm", children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", children: nameOf(p) }),
                  dirOf(p) && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dir", children: dirOf(p) })
                ] })
              ]
            },
            p
          );
        }) }),
        files.length > 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "office-count", children: t("Office_FileCount", files.length) })
      ] }) }),
      /* @__PURE__ */ jsxRuntime.jsx(
        "div",
        {
          className: "files-gutter",
          title: t("Files_GutterHint"),
          onPointerDown: onGutterDown,
          onPointerMove: onGutterMove,
          onPointerUp: onGutterUp,
          onLostPointerCapture: onGutterUp,
          onDoubleClick: () => {
            setWidth(SIDEBAR_DEFAULT);
            window.localStorage.setItem(SIDEBAR_KEY, String(SIDEBAR_DEFAULT));
          }
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-main", children: !active ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: "GITTER" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: t("Office_WelcomeTitle") }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Office_WelcomeHint") }) }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Office_PhaseNote") }) })
        ] })
      ] }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-headbar", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fico", children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "currentColor", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M2 2.5h12v11H2v-11zm1.5 1.5v8h9v-8h-9zM5 6h6v1.2H5V6zm0 2.6h4v1.2H5V8.6z" }) }) }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", title: active, children: nameOf(active) }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "right", children: /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: openExternal, children: t("Office_ExternalOpen") }) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "office-canvas", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: kind ? officeExtLabel(active) : "FILE" }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: nameOf(active) }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Office_PreviewUnavailable") }) }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", style: { marginTop: 10 }, onClick: openExternal, children: t("Office_ExternalOpen") })
          ] })
        ] }) })
      ] }) })
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
  window.GITTER_UI.registerPage({ id: "office" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "office",
        children: React.createElement(OfficePage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
