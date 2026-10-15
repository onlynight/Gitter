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
    taskPanels: () => [],
    requestFileFocus: (path) => U().requestFileFocus(path),
    openSettings: (section) => U().openSettings(section),
    toast: (title, body) => U().toast(title, body),
    refresh: () => U().refresh(),
    notifyRepoChanged: () => U().notifyRepoChanged(),
    repo: () => U().repo(),
    pathForFile: (file) => {
      try {
        return U().pathForFile(file);
      } catch {
        return "";
      }
    },
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
  const KIND_EXTS = {
    pdf: /* @__PURE__ */ new Set([".pdf"]),
    pptx: /* @__PURE__ */ new Set([".pptx", ".pptm", ".ppsx", ".potx"]),
    docx: /* @__PURE__ */ new Set([".docx", ".docm", ".dotx"]),
    xlsx: /* @__PURE__ */ new Set([".xlsx", ".xlsm", ".xltx"]),
    ods: /* @__PURE__ */ new Set([".ods"]),
    csv: /* @__PURE__ */ new Set([".csv"]),
    tsv: /* @__PURE__ */ new Set([".tsv"]),
    legacy: /* @__PURE__ */ new Set([".doc", ".xls", ".ppt", ".odt", ".odp", ".rtf", ".pages", ".key", ".numbers"])
  };
  function officeKindOf(p) {
    const i = p.lastIndexOf(".");
    if (i < 0) return null;
    const ext = p.slice(i).toLowerCase();
    for (const kind of Object.keys(KIND_EXTS)) {
      if (KIND_EXTS[kind].has(ext)) return kind;
    }
    return null;
  }
  function previewerOf(kind) {
    switch (kind) {
      case "pdf":
        return "pdf";
      case "pptx":
        return "pptx";
      case "docx":
        return "docx";
      case "xlsx":
      case "ods":
      case "csv":
      case "tsv":
        return "sheet";
      default:
        return null;
    }
  }
  function isTextChannelKind(kind) {
    return kind === "csv" || kind === "tsv";
  }
  function officeExtLabel(p) {
    const i = p.lastIndexOf(".");
    return i >= 0 ? p.slice(i + 1).toUpperCase() : "";
  }
  function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  const IFRAME_CSS = `
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: #f2f2f2; color: #222;
}
body.dark { background: #1f1f1f; color: #ddd; }
#gitter-preview-root { position: absolute; inset: 0; overflow: auto; overflow-anchor: none; }
/* overflow-anchor:none：pdf 缩放重渲染会整片替换画布，Chromium 滚动锚定在
   DOM 替换时自行调整 scrollTop，与中心锚定的滚动补偿相互打架（实测
   st 800→1182 的补偿被锚定改写成 382）。我们是程序化滚动的确定性场景，禁用。 */
/* 内容层缩放载体：transform: scale（宿主经消息设置）。
   width:max-content 让滚动包围盒恰好等于内容（放大的空边不出现），
   margin:0 auto 在窄于视口时居中、溢出时自动归零（不会左侧不可达）。 */
.gpv-content { width: max-content; min-width: 100%; margin: 0 auto; transform-origin: 0 0; }
.gpv-empty { padding: 48px 24px; text-align: center; font-size: 12.5px; opacity: .6; }

/* pdf：灰背板 + 居中页卡 */
.gpv-pdf { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px 0; }
.gpv-pdf-page { background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, .28); }

/* docx：docx-preview 自带 .docx-wrapper 灰底，覆写为透明贴合主题背板 */
.gpv-docx .docx-wrapper { background: transparent; padding: 24px 0; }

/* 表格：工作表 tab 条（sticky，位于滚动容器直下、缩放载体之外——横纵双向钉扎）+ 白底表格 */
.gpv-sheet-tabs {
  position: sticky; top: 0; left: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 2px;
  padding: 5px 8px; background: #e8e8e8; border-bottom: 1px solid #d0d0d0;
}
body.dark .gpv-sheet-tabs { background: #262626; border-bottom-color: #3a3a3a; }
.gpv-sheet-tabs button {
  appearance: none; border: 1px solid transparent; border-radius: 4px; padding: 2px 10px;
  font: inherit; font-size: 12px; background: transparent; color: inherit; cursor: pointer;
}
.gpv-sheet-tabs button:hover { background: rgba(127, 127, 127, .15); }
.gpv-sheet-tabs button.active { background: #fff; border-color: #c9c9c9; font-weight: 600; }
body.dark .gpv-sheet-tabs button.active { background: #3a3a3a; border-color: #4a4a4a; }
.gpv-sheet-table { padding: 0 12px 24px; }
.gpv-sheet-table table { border-collapse: collapse; background: #fff; color: #1a1a1a; font-size: 12.5px; table-layout: fixed; }
.gpv-sheet-table td {
  border: 1px solid #ddd; padding: 3px 8px; vertical-align: top;
  overflow: hidden; white-space: pre-wrap; word-break: break-word; max-width: 400px;
}
.gpv-sheet-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gpv-sheet-table td.hint { text-align: center; color: #888; font-size: 11.5px; background: #f6f6f6; }

/* pptx：pptx-preview 自绘幻灯片，仅给外边距 */
.gpv-pptx { padding: 16px 0 24px; }
`;
  function nativeSepOf(workDir) {
    return workDir.replace(/[\\/]+$/, "").includes("\\") ? "\\" : "/";
  }
  function absPathOf(workDir, rel) {
    const base = workDir.replace(/[\\/]+$/, "");
    const sep = nativeSepOf(workDir);
    const tail = rel.replace(/\\/g, "/").replace(/^[/\\]+/, "");
    return base + sep + tail.split("/").join(sep);
  }
  const PREVIEW_MSG_SRC = "gitter-office-preview";
  function buildSrcdoc() {
    var _a2;
    const lib = (_a2 = window.GITTER_LIBS) == null ? void 0 : _a2.officeview;
    if (typeof (lib == null ? void 0 : lib.runtimeJs) !== "string" || !lib.runtimeJs) {
      throw new Error("GITTER_LIBS.officeview 未注册——officeview 库（gitui.page.office）未装载");
    }
    const scripts = typeof lib.srcdocScripts === "function" ? lib.srcdocScripts() : [lib.runtimeJs];
    const body = scripts.filter((s) => typeof s === "string" && s.length > 0).map((s) => `<script>${s.replace(/<\/script/gi, "<\\/script>")}<\/script>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}</style></head><body><div id="gitter-preview-root"></div>${body}</body></html>`;
  }
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];
  function zoomStep(z, dir) {
    if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-9) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-9) ?? ZOOM_STEPS[0];
  }
  function PreviewFrame(props) {
    const iframeRef = react.useRef(null);
    const sentRef = react.useRef(false);
    const settledRef = react.useRef(false);
    const [srcdoc] = react.useState(buildSrcdoc);
    const onDoneRef = react.useRef(props.onDone);
    onDoneRef.current = props.onDone;
    const onErrorRef = react.useRef(props.onError);
    onErrorRef.current = props.onError;
    const rendererRef = react.useRef(props.renderer);
    rendererRef.current = props.renderer;
    const nameRef = react.useRef(props.name);
    nameRef.current = props.name;
    const payloadRef = react.useRef(props.payload);
    payloadRef.current = props.payload;
    const darkRef = react.useRef(props.dark);
    darkRef.current = props.dark;
    const zoomRef = react.useRef(props.zoom);
    zoomRef.current = props.zoom;
    const onZoomDeltaRef = react.useRef(props.onZoomDelta);
    onZoomDeltaRef.current = props.onZoomDelta;
    const timeoutMsgRef = react.useRef(props.timeoutMessage);
    timeoutMsgRef.current = props.timeoutMessage;
    react.useEffect(() => {
      var _a2;
      if (sentRef.current && ((_a2 = iframeRef.current) == null ? void 0 : _a2.contentWindow)) {
        iframeRef.current.contentWindow.postMessage(
          { source: PREVIEW_MSG_SRC, type: "zoom", zoom: props.zoom },
          "*"
        );
      }
    }, [props.zoom]);
    react.useEffect(() => {
      sentRef.current = false;
      settledRef.current = false;
      const timer = window.setTimeout(() => {
        if (!settledRef.current) {
          settledRef.current = true;
          onErrorRef.current(timeoutMsgRef.current);
        }
      }, 3e4);
      const handler = (ev) => {
        var _a2, _b2;
        if (ev.source !== ((_a2 = iframeRef.current) == null ? void 0 : _a2.contentWindow)) return;
        const msg = ev.data;
        if (!msg || msg.source !== PREVIEW_MSG_SRC) return;
        if (msg.type === "ready" && !sentRef.current) {
          sentRef.current = true;
          const win = (_b2 = iframeRef.current) == null ? void 0 : _b2.contentWindow;
          if (win) {
            win.postMessage({
              source: PREVIEW_MSG_SRC,
              type: "render",
              id: 1,
              renderer: rendererRef.current,
              name: nameRef.current,
              dark: darkRef.current,
              base64: payloadRef.current.base64,
              text: payloadRef.current.text
            }, "*");
            if (zoomRef.current !== 1) {
              win.postMessage({ source: PREVIEW_MSG_SRC, type: "zoom", zoom: zoomRef.current }, "*");
            }
          }
          return;
        }
        if (msg.type === "zoom-request") {
          onZoomDeltaRef.current(msg.dir != null && msg.dir < 0 ? -1 : 1);
          return;
        }
        if (settledRef.current) return;
        if (msg.type === "done") {
          settledRef.current = true;
          window.clearTimeout(timer);
          onDoneRef.current(msg.info ?? {});
        } else if (msg.type === "error") {
          settledRef.current = true;
          window.clearTimeout(timer);
          onErrorRef.current(String(msg.message ?? "preview error"));
        }
      };
      window.addEventListener("message", handler);
      return () => {
        window.removeEventListener("message", handler);
        window.clearTimeout(timer);
      };
    }, [props.path]);
    return /* @__PURE__ */ jsxRuntime.jsx(
      "iframe",
      {
        ref: iframeRef,
        className: "office-preview-frame",
        sandbox: "allow-scripts",
        title: props.name,
        srcDoc: srcdoc
      }
    );
  }
  const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" };
  const RefreshIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M13 8a5 5 0 1 1-1.5-3.6M13.2 1.8v3h-3", ...S }) });
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
    const [phase, setPhase] = react.useState("loading");
    const [payload, setPayload] = react.useState(null);
    const [errorMsg, setErrorMsg] = react.useState(null);
    const [size, setSize] = react.useState(null);
    const [pageCount, setPageCount] = react.useState(null);
    const [width, setWidth] = react.useState(loadWidth);
    const [nonce, setNonce] = react.useState(0);
    const [zoom, setZoom] = react.useState(1);
    const activeRef = react.useRef(null);
    const kind = react.useMemo(() => active ? officeKindOf(active) : null, [active]);
    const renderer = react.useMemo(() => kind ? previewerOf(kind) : null, [kind]);
    const dark = (document.documentElement.getAttribute("data-base") ?? "dark") !== "light";
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
    const openFile = react.useCallback(async (path) => {
      if (activeRef.current === path) return;
      activeRef.current = path;
      setActive(path);
      setErrorMsg(null);
      setPageCount(null);
      setSize(null);
      setPayload(null);
      setZoom(1);
      setNonce((n) => n + 1);
      const k = officeKindOf(path);
      if (k === null || k === "legacy") {
        setPhase("legacy");
        return;
      }
      setPhase("loading");
      try {
        const st = await pageSdk.call("file.stat", { path });
        if (activeRef.current !== path) return;
        setSize((st == null ? void 0 : st.size) ?? null);
        let p;
        if (isTextChannelKind(k)) {
          const r = await pageSdk.call("file.content", { path });
          if (activeRef.current !== path) return;
          if (r.binary) throw new Error(t("Office_PreviewFailed"));
          if (r.truncated) throw new Error(t("Office_TooLarge"));
          p = { text: r.content };
        } else {
          const r = await pageSdk.call("file.readBinary", { path });
          if (activeRef.current !== path) return;
          if (!r) throw new Error(t("Files_Missing"));
          if (r.truncated) throw new Error(t("Office_TooLarge"));
          p = { base64: r.base64 };
        }
        setPayload(p);
        setPhase("rendering");
      } catch (e) {
        if (activeRef.current !== path) return;
        setErrorMsg(e.message);
        setPhase("error");
      }
    }, []);
    const onPreviewDone = react.useCallback((info) => {
      setPageCount(info.pages ?? null);
      setPhase("ready");
    }, []);
    const onPreviewError = react.useCallback((message) => {
      setErrorMsg(message);
      setPhase("error");
    }, []);
    const retry = react.useCallback(() => {
      setErrorMsg(null);
      setPhase("rendering");
      setNonce((n) => n + 1);
    }, []);
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
      if (active && repo) void pageSdk.call("shell.openPath", { path: absPathOf(repo.workDir, active), editor: true });
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
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-hacts", children: /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Office_Refresh"), onClick: () => void loadTree(), children: /* @__PURE__ */ jsxRuntime.jsx(RefreshIcon, {}) }) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "office-list", children: files.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-empty", children: t("Office_NoFiles") }) : files.map((p) => {
          const isActive = p === active;
          const k = officeKindOf(p);
          return /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              className: "office-row" + (isActive ? " active" : ""),
              title: p,
              onClick: () => void openFile(p),
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
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "right", children: [
            size != null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "it", children: formatSize(size) }),
            pageCount != null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "it", children: t("Office_PageCount", pageCount) }),
            phase !== "legacy" && phase !== "error" && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "office-zoom", children: [
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "files-ibtn",
                  title: t("Office_ZoomOut"),
                  disabled: zoom <= ZOOM_STEPS[0],
                  onClick: () => setZoom((z) => zoomStep(z, -1)),
                  children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 12 12", stroke: "currentColor", strokeWidth: "1.4", fill: "none", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M1.5 6h9" }) })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "office-zoom-pct", title: t("Office_ZoomReset"), onClick: () => setZoom(1), children: [
                Math.round(zoom * 100),
                "%"
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "files-ibtn",
                  title: t("Office_ZoomIn"),
                  disabled: zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1],
                  onClick: () => setZoom((z) => zoomStep(z, 1)),
                  children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 12 12", stroke: "currentColor", strokeWidth: "1.4", fill: "none", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6 1.5v9M1.5 6h9" }) })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: openExternal, children: t("Office_ExternalOpen") })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-canvas", children: [
          phase === "error" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: "!" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: t("Office_PreviewFailed") }),
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: errorMsg }) }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, marginTop: 10 }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", onClick: retry, children: t("Office_Retry") }),
                /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: openExternal, children: t("Office_ExternalOpen") })
              ] })
            ] })
          ] }) : phase === "legacy" || !payload || !renderer ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: kind ? officeExtLabel(active) : "FILE" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: nameOf(active) }),
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Office_PreviewUnavailable") }) }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", style: { marginTop: 10 }, onClick: openExternal, children: t("Office_ExternalOpen") })
            ] })
          ] }) : /* @__PURE__ */ jsxRuntime.jsx(
            PreviewFrame,
            {
              path: active,
              renderer,
              name: nameOf(active),
              payload,
              dark,
              zoom,
              onZoomDelta: (dir) => setZoom((z) => zoomStep(z, dir)),
              timeoutMessage: t("Office_PreviewTimeout"),
              onDone: onPreviewDone,
              onError: onPreviewError
            },
            `${active}:${nonce}`
          ),
          (phase === "loading" || phase === "rendering") && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "office-loading", children: t("Office_Loading") })
        ] })
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
  K().MonacoDiffView;
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
