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
  K().Select;
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
  const PATHS = {
    // 纸飞机（Octicons paper-airplane-16 改绘）
    send: "M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.342 1.342 0 0 1-1.85-1.463L.99 8Zm.603-5.288L2.38 7.25h4.87a.75.75 0 0 1 0 1.5H2.38l-.788 4.538L13.929 8 1.592 2.712Z",
    // 实心圆角方块
    stop: "M3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3Z",
    // 终端提示符（>_）
    terminal: "M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm0 1.5v7h12v-7H2Zm2.7 1.1L3.6 6.6l1.8 1.9-1.8 1.9 1.1 1 2.6-2.9-2.6-2.9ZM8.5 10.5H12V12H8.5Z",
    // 铅笔（Octicons pencil-16）
    pencil: "M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z",
    // 放大镜（Octicons search-16）
    search: "M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z",
    // 文件夹（design-mockups/log-page.html）
    folder: "M1.5 3A1.5 1.5 0 0 1 3 1.5h3.4l1.5 2H13A1.5 1.5 0 0 1 14.5 5v8A1.5 1.5 0 0 1 13 14.5H3A1.5 1.5 0 0 1 1.5 13V3Z",
    // 文档
    file: "M3 1.5h6L13 5v9a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5ZM9 2.6V5h2.4L9 2.6Z",
    // 分支（design-mockups/log-page.html，分支页同源）
    branch: "M13.1 3.9a2.3 2.3 0 0 0-3.25 3.25l-.1.1a2.3 2.3 0 0 1-3.25 0L5.4 6.2a2.3 2.3 0 1 0-1.06 1.06l1.1 1.05a3.8 3.8 0 0 0 2.31 1.09v1.2a2.3 2.3 0 1 0 1.5 0V9.4a3.8 3.8 0 0 0 2.31-1.09l.1-.1a2.3 2.3 0 1 0 1.44-4.31Z",
    // diff（design-mockups/log-page.html，变更页同源）
    diff: "M2 4.25 5 8l-3 3.75V4.25ZM6 3h1.5v10H6V3Zm3 0h5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9v-1.5h4.5v-7H9V3Z",
    // 时钟（提交历史）
    clock: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm.75 1.5h-1.5v4l3 1.8.75-1.23-2.25-1.35V4.5Z",
    // 下载托盘（读取网页）
    download: "M8 1.5a.75.75 0 0 1 .75.75v5.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 1.06-1.06l1.72 1.72V2.25A.75.75 0 0 1 8 1.5Zm-5.5 8a.75.75 0 0 1 .75.75v1.5c0 .14.11.25.25.25h9a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 12.5 14h-9A1.75 1.75 0 0 1 2 12.25v-1.5a.75.75 0 0 1 .5-.75Z",
    // 提交节点（圆环 + 两侧线）
    commit: "M1 7.25h2.5v1.5H1v-1.5Zm11.5 0H15v1.5h-2.5v-1.5ZM8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 1.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
    // 向上箭头（暂存/推送）
    up: "M8 2.5 12 6.5H9.75V11h-3.5V6.5H4L8 2.5ZM3 12.5h10V14H3v-1.5Z",
    // 圆圈对勾（checkpoint / todo 完成）
    "check-circle": "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm2.28 2.66-3.03 3.4-1.53-1.53-1.06 1.06 2.61 2.61 4.07-4.6-1.06-.94Z",
    // 空圈（todo 待办）
    circle: "M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
    // 圈中点（todo 进行中）
    "circle-dot": "M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    // 实心点（日志/默认工具）
    dot: "M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z",
    // 空心点（空闲）
    "dot-hollow": "M8 4.75a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5Zm0 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z",
    // 四角星光（思考中，✻ 的矢量形）
    sparkle: "M7 1c.55 3.5 2 4.95 5.5 5.5C9 7.05 7.55 8.5 7 12c-.55-3.5-2-4.95-5.5-5.5C5 5.95 6.45 4.5 7 1Zm5.5 8.4c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z",
    // 盾牌（授权请求）
    shield: "M8 1.2 13.6 3.3v4.2c0 3.4-2.3 6.1-5.6 7.3C4.7 13.6 2.4 10.9 2.4 7.5V3.3L8 1.2Zm0 1.6L3.9 4.4v3.1c0 2.6 1.7 4.7 4.1 5.7 2.4-1 4.1-3.1 4.1-5.7V4.4L8 2.8Z",
    // 机器人（子代理）
    bot: "M6.2 1.5c.44 0 .8.36.8.8v1.2h2V2.3a.8.8 0 1 1 1.6 0v1.2h1.15A2.25 2.25 0 0 1 14 5.75v5A2.25 2.25 0 0 1 11.75 13h-7.5A2.25 2.25 0 0 1 2 10.75v-5a2.25 2.25 0 0 1 2.25-2.25h1.15V2.3c0-.44.36-.8.8-.8ZM5.4 6.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm5.2 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm-5.1 3.5h5v1.3h-5v-1.3Z",
    // 用量柱（turn 统计）
    usage: "M2 13.25h12v1.25H2v-1.25ZM3.25 8.5H5v3.25H3.25V8.5Zm4-4H9v7.25H7.25V4.5Zm4 2H13v5.25h-1.75V6.5Z",
    // 清单（todo_write）
    list: "M2.5 3h2.2v2.2H2.5V3Zm4 .4h7v1.4h-7V3.4ZM2.5 6.9h2.2v2.2H2.5V6.9Zm4 .4h7v1.4h-7V7.3Zm-4 3.1h2.2v2.2H2.5v-2.2Zm4 .4h7v1.4h-7v-1.4Z",
    // 对话气泡（提问）
    chat: "M2.5 2h11A1.5 1.5 0 0 1 15 3.5v6a1.5 1.5 0 0 1-1.5 1.5H8.6L5 14.2V11H2.5A1.5 1.5 0 0 1 1 9.5v-6A1.5 1.5 0 0 1 2.5 2Z",
    // 罗盘菱形（计划）
    plan: "M8 1.5 14.5 8 8 14.5 1.5 8 8 1.5Zm0 2.1L3.6 8 8 12.4 12.4 8 8 3.6Zm0 3.15a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z",
    // 分叉（Octicons git-branch-16）
    fork: "M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z",
    // 归档（Octicons archive-16）
    archive: "M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v1.5A1.75 1.75 0 0 1 14.25 6H14v6.25A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25V6h-.25A1.75 1.75 0 0 1 0 4.25v-1.5ZM3.5 6v6.25c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6h-9ZM1.75 2.5a.25.25 0 0 0-.25.25v1.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-1.5a.25.25 0 0 0-.25-.25H1.75ZM6.25 8h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z",
    // 外开新窗（Octicons external-link-16）
    external: "M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z",
    // 展开箭头（Octicons chevron-right-16）：默认指向右，展开时由 CSS 旋转 90°
    "chevron-right": "M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06L7.28 12.78a.75.75 0 1 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z",
    // 收起箭头（Octicons chevron-down-16）
    "chevron-down": "M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 1 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0Z",
    // 加号（Octicons plus-16）
    plus: "M7.25 2.5h1.5v3.75h3.75v1.5H8.75v3.75h-1.5V7.75H3.5v-1.5h3.75V2.5Z",
    // 闪电（访问控制 / yolo 模式）
    bolt: "M8.94.54a.75.75 0 0 1 1.24.83L7.75 8.5h3.5a.75.75 0 0 1 .57 1.24l-4.5 5.75a.75.75 0 0 1-1.24-.83l2.43-4.65h-3.5a.75.75 0 0 1-.57-1.24l4.5-5.75Z",
    // 齿轮（思考深度）
    gear: "M9.5 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM7.25.5h1.5c.2 0 .39.09.52.24l1.32 1.58a4.5 4.5 0 0 1 .63.22l1.9-.55a.75.75 0 0 1 .93.86l-.45 1.98c.06.2.14.4.22.6l1.9.47a.75.75 0 0 1 .4 1.34l-1.56.97a4.5 4.5 0 0 1 .1.66l1.22 1.52a.75.75 0 0 1-.4 1.34l-2 .47a4.5 4.5 0 0 1-.34.57l.62 1.94a.75.75 0 0 1-.94.93l-1.86-.54a4.5 4.5 0 0 1-.57.34l-.46 1.93a.75.75 0 0 1-1.35.4l-.97-1.57a4.5 4.5 0 0 1-.66.1l-1.52 1.22a.75.75 0 0 1-1.34-.4l-.47-2a4.5 4.5 0 0 1-.57-.34l-1.94.62a.75.75 0 0 1-.93-.94l.54-1.86a4.5 4.5 0 0 1-.34-.57l-1.93-.46a.75.75 0 0 1-.4-1.35l1.57-.97a4.5 4.5 0 0 1 0-.66L.72 6.92a.75.75 0 0 1 .4-1.34l2-.47a4.5 4.5 0 0 1 .34-.57l-.62-1.94a.75.75 0 0 1 .94-.93l1.86.54a4.5 4.5 0 0 1 .57-.34l.46-1.93a.75.75 0 0 1 1.35-.4l.97 1.57a4.5 4.5 0 0 1 .66-.1Zm.75 2.5A3.75 3.75 0 1 0 11.75 6.75 3.75 3.75 0 0 0 8 3.25Zm0 1.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5Z",
    "chevron-up": "M3.22 9.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L8 6.06 4.28 9.78a.75.75 0 0 1-1.06 0Z",
    // 关闭（Octicons x-16）
    "x": "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z",
    // 删除（Octicons trash-16）
    "trash": "M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.748 1.748 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z",
    // 对勾（Octicons check-16）
    "check": "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
  };
  function TlIcon(props) {
    const d = PATHS[props.name];
    if (!d) return null;
    return /* @__PURE__ */ jsxRuntime.jsx(
      "svg",
      {
        width: props.size ?? 13,
        height: props.size ?? 13,
        viewBox: "0 0 16 16",
        "aria-hidden": "true",
        className: props.className,
        style: { flex: "none", color: props.color, ...props.style },
        children: /* @__PURE__ */ jsxRuntime.jsx("path", { d, fill: "currentColor", fillRule: "evenodd" })
      }
    );
  }
  function toolIconName(name) {
    switch (name) {
      case "terminal_run":
      case "terminal_poll":
        return "terminal";
      case "file_write":
      case "file_patch":
        return "pencil";
      case "web_search":
      case "repo_glob":
      case "repo_grep":
        return "search";
      case "web_fetch":
        return "download";
      case "repo_read_file":
        return "file";
      case "repo_list_files":
        return "folder";
      case "repo_status":
      case "repo_diff":
        return "diff";
      case "repo_log":
        return "clock";
      case "git_stage":
        return "up";
      case "git_commit":
        return "commit";
      case "git_push":
        return "up";
      case "ask_user":
        return "chat";
      case "todo_write":
        return "list";
      case "plan_submit":
        return "plan";
      case "task":
      case "review_get_state":
        return "bot";
      default:
        return "dot";
    }
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
  const THINKING_META = {
    off: { label: "思考·关", hint: "跳过推理，响应最快" },
    low: { label: "思考·低", hint: "轻量推理，适合明确指令" },
    medium: { label: "思考·中", hint: "平衡推理与速度（默认）" },
    high: { label: "思考·高", hint: "深度推理，适合复杂设计" }
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
    { name: "cp", hint: "立即创建检查点" },
    { name: "diff", hint: "查看当前改动" },
    { name: "attach", hint: "附加图片（随下条消息发送）" },
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
        return pushCap(blocks, { kind: "status", text: `${ev.phase ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}`, phase: ev.phase });
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
  function ErrorFloat(props) {
    const [open, setOpen] = react.useState(false);
    const [truncated, setTruncated] = react.useState(false);
    const textRef = react.useRef(null);
    react.useEffect(() => {
      setOpen(false);
      const el = textRef.current;
      setTruncated(!!el && el.scrollWidth > el.clientWidth + 1);
    }, [props.text]);
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", style: { position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 30, margin: 0, maxWidth: props.maxWidth, boxShadow: "0 8px 20px color-mix(in srgb, #000 25%, transparent)" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx(
        "span",
        {
          ref: textRef,
          className: "banner-text",
          style: open ? { whiteSpace: "normal", wordBreak: "break-word", maxHeight: "40vh", overflowY: "auto", userSelect: "text" } : void 0,
          children: props.text
        }
      ),
      (truncated || open) && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: { flex: "none" }, onClick: () => setOpen((v) => !v), children: open ? "收起" : "展开" }),
      props.go && props.onGo && /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          className: "tool-btn",
          title: `打开设置 · ${props.go.section}`,
          style: { flex: "none", color: "var(--c-link)", textDecoration: "underline", textUnderlineOffset: 2 },
          onClick: () => props.onGo(props.go.section),
          children: props.go.label
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: { flex: "none" }, onClick: props.onClose, children: "✕" })
    ] });
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
    const { mention, items, onPick, onSelect } = props;
    if (!mention || items.length === 0) return null;
    const sel = Math.max(0, Math.min(props.selectedIndex, items.length - 1));
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mention-pop", style: { position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, maxHeight: 180, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }, children: items.map((it, i) => /* @__PURE__ */ jsxRuntime.jsx(
      "div",
      {
        ref: (el) => {
          if (el && i === sel) el.scrollIntoView({ block: "nearest" });
        },
        style: {
          padding: "4px 10px",
          fontSize: 12,
          cursor: "pointer",
          borderRadius: 6,
          background: i === sel ? "var(--c-selected)" : "transparent",
          color: i === sel ? "var(--c-text)" : "var(--c-text2)"
        },
        onMouseEnter: () => onSelect(i),
        onMouseDown: (e) => {
          e.preventDefault();
          onPick(it.insert);
        },
        children: it.label
      },
      it.label
    )) });
  }
  function SlashPopover(props) {
    if (!props.open || props.items.length === 0) return null;
    const sel = Math.max(0, Math.min(props.selectedIndex, props.items.length - 1));
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mention-pop", style: { position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, maxHeight: 240, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }, children: props.items.map((it, i) => /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        ref: (el) => {
          if (el && i === sel) el.scrollIntoView({ block: "nearest" });
        },
        style: {
          padding: "5px 10px",
          fontSize: 12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRadius: 6,
          background: i === sel ? "var(--c-selected)" : "transparent"
        },
        onMouseEnter: () => props.onSelect(i),
        onMouseDown: (e) => {
          e.preventDefault();
          props.onPick(it.insert);
        },
        children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontFamily: "var(--mono, monospace)", color: "var(--c-text)", fontWeight: 600, flex: "none" }, children: it.name }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: it.hint })
        ]
      },
      it.name
    )) });
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
        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: toolIconName(b.name), color: glyphColor, className: b.state === "running" ? "tl-pulse" : void 0 }),
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
    const running = todos.some((x) => x.status === "in_progress");
    const allDone = todos.length > 0 && done === todos.length;
    const [open, setOpen] = react.useState(() => !allDone);
    const bodyRef = react.useRef(null);
    const innerRef = react.useRef(null);
    const openRef = react.useRef(open);
    openRef.current = open;
    react.useEffect(() => {
      if (allDone) setOpen(false);
      else if (running) setOpen(true);
    }, [allDone, running]);
    react.useEffect(() => {
      const body = bodyRef.current;
      const inner = innerRef.current;
      if (!body || !inner) return;
      if (!openRef.current) {
        body.style.height = "0px";
        return;
      }
      body.style.height = `${inner.scrollHeight}px`;
      const settle = () => {
        if (openRef.current) body.style.height = "auto";
        body.removeEventListener("transitionend", settle);
      };
      body.addEventListener("transitionend", settle);
    }, [open, todos]);
    const pct = todos.length > 0 ? Math.round(done / todos.length * 100) : 0;
    const title = allDone ? "全部完成" : running ? "进行中" : "等待中";
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "todo-card", children: [
      /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "todo-head",
          onClick: () => setOpen((o) => !o),
          role: "button",
          tabIndex: 0,
          "aria-expanded": open,
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-right", size: 11, className: "todo-chev" + (open ? " open" : "") }),
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "plan", size: 12, color: allDone ? "var(--c-green)" : running ? "var(--c-amber)" : "var(--c-text3)" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontWeight: 700 }, children: title }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "todo-progress", children: /* @__PURE__ */ jsxRuntime.jsx("i", { style: { width: `${pct}%` } }) }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { fontVariantNumeric: "tabular-nums" }, children: [
                done,
                "/",
                todos.length
              ] })
            ] }),
            running && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tl-pulse", style: { width: 6, height: 6, borderRadius: "50%", background: "var(--c-amber)", marginLeft: "auto" } })
          ]
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx("div", { ref: bodyRef, className: "todo-body", children: /* @__PURE__ */ jsxRuntime.jsx("div", { ref: innerRef, className: "todo-inner", children: todos.map((td, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "todo-item" + (td.status === "completed" ? " done" : td.status === "in_progress" ? " cur" : ""), children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          TlIcon,
          {
            name: td.status === "completed" ? "check-circle" : td.status === "in_progress" ? "circle-dot" : "circle",
            color: td.status === "completed" ? "var(--c-green)" : td.status === "in_progress" ? "var(--c-amber)" : "var(--c-text3)",
            className: td.status === "in_progress" ? "tl-pulse" : void 0
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, minWidth: 0, fontWeight: td.status === "in_progress" ? 600 : 400 }, children: td.content })
      ] }, i)) }) })
    ] });
  }
  function CompPopover(props) {
    const ref = react.useRef(null);
    const [maxH, setMaxH] = react.useState(void 0);
    react.useLayoutEffect(() => {
      if (!props.open) {
        setMaxH(void 0);
        return;
      }
      const measure = () => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setMaxH(Math.max(160, Math.min(320, r.bottom - 12)));
      };
      measure();
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }, [props.open]);
    react.useEffect(() => {
      if (!props.open) return;
      const h = (e) => {
        if (ref.current && !ref.current.contains(e.target)) props.onClose();
      };
      const k = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      };
      document.addEventListener("mousedown", h);
      document.addEventListener("keydown", k);
      return () => {
        document.removeEventListener("mousedown", h);
        document.removeEventListener("keydown", k);
      };
    }, [props.open, props.onClose]);
    return /* @__PURE__ */ jsxRuntime.jsx(
      "div",
      {
        ref,
        className: "comp-pop" + (props.open ? " open" : "") + (props.anchor === "right" ? " right" : ""),
        style: { maxHeight: maxH, overflowY: maxH !== void 0 ? "auto" : void 0 },
        "aria-hidden": !props.open,
        children: props.children
      }
    );
  }
  function CompOption(props) {
    const { icon, color, name, sub, on, disabled, onSelect } = props;
    return /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: "comp-opt" + (on ? " on" : "") + (disabled ? "" : ""),
        style: disabled ? { opacity: 0.45, cursor: "default" } : void 0,
        onClick: () => {
          if (!disabled) onSelect();
        },
        children: [
          icon ? /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: icon, size: 13, color }) : /* @__PURE__ */ jsxRuntime.jsx("span", { style: { width: 13, flex: "none" } }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-opt-name", children: name }),
            sub ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-opt-sub", children: sub }) : null
          ] }),
          on && /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "check-circle", size: 13, className: "comp-check", color: "var(--c-green)" })
        ]
      }
    );
  }
  const Composer = react.forwardRef(function Composer2(props, ref) {
    const { value, onChange, onKeyDown, placeholder, maxH } = props;
    const [open, setOpen] = react.useState("");
    const toggle = (k) => setOpen((o) => o === k ? "" : k);
    const [modelNav, setModelNav] = react.useState("");
    react.useEffect(() => {
      if (open !== "model") setModelNav("");
    }, [open]);
    react.useEffect(() => {
      const el = typeof ref === "function" ? null : ref == null ? void 0 : ref.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, maxH) + "px";
    }, [value, maxH]);
    const pick = (v, set) => {
      set(v);
      setOpen("");
    };
    const curHit = (() => {
      for (const g of props.groups) {
        const mem = g.members.find((x) => x.id === props.model);
        if (mem) return { g, mem };
      }
      return null;
    })();
    const s = props.stats;
    const pct = s ? Math.round(s.ratio * 100) : 0;
    const pctColor = s ? pct > 92 ? "var(--c-red)" : pct > 80 ? "var(--c-amber)" : "var(--c-text3)" : "var(--c-text3)";
    const fmtK = (n) => n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : `${n}`;
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "composer-box", style: { position: "relative" }, children: [
      props.attachments && props.attachments.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }, children: [
        props.attachments.map((img, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { position: "relative" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("img", { src: img.dataUrl, alt: img.name, style: { width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-border)" } }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", title: "移除", style: { position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 10 }, onClick: img.onRemove, children: "✕" })
        ] }, `${img.name}:${i}`)),
        props.attachmentHint ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { alignSelf: "center" }, children: props.attachmentHint }) : null
      ] }),
      props.children,
      /* @__PURE__ */ jsxRuntime.jsx(
        "textarea",
        {
          ref,
          className: "composer-input",
          rows: 1,
          autoFocus: props.autoFocus,
          style: { minHeight: props.minH ?? 24 },
          placeholder,
          value,
          onChange: (e) => onChange(e.target.value),
          onPaste: (e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              props.onAttachImage();
            }
          },
          onDrop: (e) => {
            const files = [...e.dataTransfer.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              props.onAttachImage();
            }
          },
          onKeyDown
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-bar", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { position: "relative", display: "inline-flex" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "comp-item",
              title: "附加附件 / 命令",
              "aria-haspopup": "menu",
              "aria-expanded": open === "plus",
              style: { padding: "0 7px" },
              onClick: () => toggle("plus"),
              children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "plus", size: 14 })
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs(CompPopover, { open: open === "plus", anchor: "left", onClose: () => setOpen(""), children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-head", children: "附件" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-opt", onClick: () => {
              props.onAttachImage();
              setOpen("");
            }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "file", size: 13, color: "var(--c-text2)" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-opt-name", children: "添加图片" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-opt-sub", children: "最多 4 张 · 4MB" })
            ] }),
            props.slash && props.slash.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-sep" }),
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-head", children: "命令（插入输入框）" }),
              props.slash.slice(0, 14).map((c) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-opt", onClick: () => {
                var _a2;
                (_a2 = props.onPickSlash) == null ? void 0 : _a2.call(props, c.insert);
                setOpen("");
              }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontFamily: "var(--mono, monospace)", color: "var(--c-text)", fontSize: 12 }, children: c.name }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-opt-sub", children: c.hint })
              ] }, c.name))
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { position: "relative", display: "inline-flex" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs(
            "button",
            {
              className: "comp-item",
              title: "访问控制（Shift+Tab 循环）",
              "aria-haspopup": "menu",
              "aria-expanded": open === "mode",
              onClick: () => toggle("mode"),
              disabled: props.modeDisabled,
              children: [
                props.mode === "yolo" ? /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "bolt", size: 13, color: "var(--c-red)" }) : props.mode === "plan" ? /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "plan", size: 13, color: "var(--c-chip-purple-fg, #b490ff)" }) : /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 13, color: "var(--c-text2)" }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-label", children: props.modeLabel }),
                /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 10, className: "comp-chev" + (open === "mode" ? " open" : "") })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs(CompPopover, { open: open === "mode", anchor: "left", onClose: () => setOpen(""), children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-head", children: "访问控制" }),
            MODE_ORDER.map((m) => /* @__PURE__ */ jsxRuntime.jsx(
              CompOption,
              {
                on: props.mode === m,
                onSelect: () => pick(m, props.onMode),
                icon: m === "yolo" ? "bolt" : m === "plan" ? "plan" : "shield",
                color: MODE_META[m].color,
                name: MODE_META[m].label.replace(/^[●◆◇⚡]\s*/, ""),
                sub: m === "plan" ? "只读调研，出计划待批准" : m === "yolo" ? "全部放行，高危除外" : "写操作逐条授权"
              },
              m
            ))
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { position: "relative", display: "inline-flex" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs(
            "button",
            {
              className: "comp-item",
              title: "模型档案",
              "aria-haspopup": "menu",
              "aria-expanded": open === "model",
              onClick: () => toggle("model"),
              disabled: props.modelDisabled,
              children: [
                /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "bot", size: 13, color: "var(--c-text2)" }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-label", children: curHit ? curHit.g.members.length > 1 ? `${curHit.g.name} · ${curHit.mem.name}` : curHit.mem.name : props.model || "默认模型" }),
                /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 10, className: "comp-chev" + (open === "model" ? " open" : "") })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx(CompPopover, { open: open === "model", anchor: "left", onClose: () => setOpen(""), children: modelNav ? (() => {
            const g = props.groups.find((x) => x.id === modelNav);
            if (!g) return null;
            return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsxs(
                "div",
                {
                  className: "comp-opt comp-group",
                  role: "button",
                  tabIndex: 0,
                  "aria-label": g.name,
                  onClick: () => setModelNav(""),
                  onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setModelNav("");
                    }
                  },
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-right", size: 11, style: { transform: "rotate(180deg)" }, color: "var(--c-text3)" }),
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-opt-name", children: g.name }),
                      g.hint ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-opt-sub", children: g.hint }) : null
                    ] }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-count", children: g.members.length })
                  ]
                }
              ),
              g.members.map((mem) => /* @__PURE__ */ jsxRuntime.jsx(
                CompOption,
                {
                  on: mem.id === props.model,
                  onSelect: () => pick(mem.id, props.onModel),
                  name: mem.name,
                  sub: mem.sub
                },
                mem.id
              ))
            ] });
          })() : (
            // 一级面板：供应商列表；单模型档案直接选中，多模型进入二级
            /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-head", children: "模型" }),
              props.groups.map((g) => {
                if (g.members.length > 1) {
                  return /* @__PURE__ */ jsxRuntime.jsxs(
                    "div",
                    {
                      className: "comp-opt comp-group",
                      role: "button",
                      tabIndex: 0,
                      "aria-haspopup": "menu",
                      "aria-label": g.name,
                      onClick: () => setModelNav(g.id),
                      onKeyDown: (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setModelNav(g.id);
                        }
                      },
                      children: [
                        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "bot", size: 13, color: "var(--c-text2)" }),
                        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-opt-name", children: g.name }),
                          g.hint ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-opt-sub", children: g.hint }) : null
                        ] }),
                        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-count", children: g.members.length }),
                        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-right", size: 10, color: "var(--c-text3)" })
                      ]
                    },
                    g.id
                  );
                }
                const mem = g.members[0];
                return /* @__PURE__ */ jsxRuntime.jsx(
                  CompOption,
                  {
                    on: mem.id === props.model,
                    onSelect: () => pick(mem.id, props.onModel),
                    icon: "bot",
                    color: "var(--c-text2)",
                    name: g.name,
                    sub: g.hint ?? mem.sub
                  },
                  g.id
                );
              })
            ] })
          ) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { position: "relative", display: "inline-flex" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "comp-item", title: "思考深度", "aria-haspopup": "menu", "aria-expanded": open === "think", onClick: () => toggle("think"), children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "gear", size: 13, color: "var(--c-text2)" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-label", children: THINKING_META[props.thinking].label }),
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 10, className: "comp-chev" + (open === "think" ? " open" : "") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs(CompPopover, { open: open === "think", anchor: "left", onClose: () => setOpen(""), children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-head", children: "思考深度" }),
            ["off", "low", "medium", "high"].map((v) => /* @__PURE__ */ jsxRuntime.jsx(
              CompOption,
              {
                on: v === props.thinking,
                onSelect: () => pick(v, props.onThinking),
                icon: "sparkle",
                color: v === "off" ? "var(--c-text3)" : "var(--c-amber)",
                name: THINKING_META[v].label,
                sub: THINKING_META[v].hint
              },
              v
            ))
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "comp-send", title: props.sendTitle, disabled: !props.canSend && !props.busy, onClick: () => props.busy ? props.onStop() : props.onSend(), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: props.busy ? "stop" : "send", size: 13 }) })
      ] }),
      s && (s.estTokens > 0 || s.totalInput != null) && /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { position: "relative", display: "block" }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("button", { type: "button", className: "comp-stats", title: "用量明细", "aria-haspopup": "menu", "aria-expanded": open === "stats", onClick: () => toggle("stats"), children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-stats-bar", children: /* @__PURE__ */ jsxRuntime.jsx("i", { style: { width: `${Math.min(100, pct)}%`, background: pctColor } }) }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "comp-stats-item", children: [
            "上下文 ",
            /* @__PURE__ */ jsxRuntime.jsx("b", { children: s ? `${fmtK(s.estTokens)} / ${fmtK(s.contextWindow)}` : "—" }),
            s ? ` · ${pct}%` : ""
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "comp-stats-item", children: [
            "输入 ",
            /* @__PURE__ */ jsxRuntime.jsx("b", { children: (s == null ? void 0 : s.totalInput) != null ? fmtK(s.totalInput) : "—" })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "comp-stats-item", children: [
            "输出 ",
            /* @__PURE__ */ jsxRuntime.jsx("b", { children: (s == null ? void 0 : s.totalOutput) != null ? fmtK(s.totalOutput) : "—" })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-stats-item", children: /* @__PURE__ */ jsxRuntime.jsx("b", { children: (s == null ? void 0 : s.tokPerSec) != null ? `${s.tokPerSec} tok/s` : "—" }) }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "comp-stats-item", children: [
            "缓存 ",
            /* @__PURE__ */ jsxRuntime.jsx("b", { children: (s == null ? void 0 : s.cacheHitRate) != null ? `${Math.round(s.cacheHitRate * 100)}%` : "—" })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 10, className: "comp-chev" + (open === "stats" ? " open" : "") })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs(CompPopover, { open: open === "stats", anchor: "right", onClose: () => setOpen(""), children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-head", children: "用量明细" }),
          s ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "上下文窗口" }),
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                fmtK(s.contextWindow),
                " · ",
                pct,
                "%"
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "系统提示" }),
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                Math.round(s.breakdown.system),
                " tok"
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "历史消息" }),
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                Math.round(s.breakdown.messages),
                " tok"
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "预留输出" }),
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                Math.round(s.breakdown.reserved),
                " tok"
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "comp-pop-sep" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "剩余预算" }),
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: fmtK(s.budget) })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "累计输入" }),
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: s.totalInput != null ? `${s.totalInput.toLocaleString()} tok` : "—" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "累计输出" }),
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: s.totalOutput != null ? `${s.totalOutput.toLocaleString()} tok` : "—" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "最近一轮输出" }),
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: s.lastOutput != null ? `${s.lastOutput.toLocaleString()} tok` : "—" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "生成速度" }),
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: s.tokPerSec != null ? `${s.tokPerSec} tok/s` : "—" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "缓存命中率" }),
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: s.cacheHitRate != null ? `${Math.round(s.cacheHitRate * 100)}%` : "—" })
            ] }),
            s.compactions > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "已自动压缩" }),
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                s.compactions,
                " 次"
              ] })
            ] }),
            pct > 80 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { padding: "2px 9px 6px", fontSize: 11, color: "var(--c-amber)" }, children: "已接近上限，建议 /compact 压缩历史" })
          ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { style: { padding: "2px 9px 8px", fontSize: 11, color: "var(--c-text3)" }, children: "发送首条消息后开始统计" })
        ] })
      ] })
    ] });
  });
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
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: decided ? "var(--c-text3)" : "var(--c-amber)", fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 13 }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
          "授权请求 · ",
          kindLabel[kind] ?? kind
        ] }),
        ((_b2 = b.payload) == null ? void 0 : _b2.source) ? /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 10, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px" }, children: b.payload.source }) : null,
        ((_c = b.payload) == null ? void 0 : _c.risk) && /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: b.payload.risk === "high" ? "var(--c-red)" : "var(--c-amber)", marginLeft: "auto", fontWeight: 700 }, children: [
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
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chat", size: 13, color: "var(--c-accent)" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { children: b.question })
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
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-chip-purple-fg, #b490ff)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "plan", size: 13 }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
          "执行计划",
          decided ? decided === "ok" ? " · 已批准" : " · 需修订" : ""
        ] })
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
        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "bot", size: 14, color: stateColor, className: b.state === "running" ? "tl-pulse" : void 0 }),
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
        return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", justifyContent: "flex-end", padding: "12px 0 4px" }, children: /* @__PURE__ */ jsxRuntime.jsx("div", { style: { maxWidth: "78%", background: "var(--c-panel2, var(--c-panel))", border: "1px solid var(--c-border)", borderRadius: 14, padding: "10px 14px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.65 }, children: b.text }) });
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
        const icon = b.phase === "thinking" ? "sparkle" : b.phase === "editing" ? "pencil" : "dot";
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11.5, color: "var(--c-text3)", display: "flex", alignItems: "center", gap: 6 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: icon, size: 12, className: b.phase === "thinking" ? "tl-pulse" : void 0 }),
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
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "check-circle", size: 13, color: "var(--c-text)" }),
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
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 5 }, children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "usage", size: 12 }),
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
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11, color: b.level === "error" ? "var(--c-red)" : b.level === "warn" ? "var(--c-amber)" : "var(--c-text3)", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 6 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "dot", size: 8 }),
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
    react.useEffect(() => {
      if (tab !== "chat") return;
      requestAnimationFrame(() => {
        const el = timelineRef.current;
        if (!el) return;
        const saved = lastChatScrollRef.current;
        if (saved != null) {
          el.scrollTop = saved;
          lastChatScrollRef.current = null;
        } else scrollTimelineToBottom(false);
      });
    }, [tab]);
    const [evMap, setEvMap] = react.useState({});
    const [selectedTask, setSelectedTask] = react.useState(null);
    const [focusTaskId, consumeTaskFocus] = useTaskFocus();
    react.useEffect(() => {
      if (!focusTaskId) return;
      setSelectedTask(focusTaskId);
      consumeTaskFocus();
    }, [focusTaskId]);
    const [error, setError] = react.useState(null);
    const [errorGo, setErrorGo] = react.useState(null);
    const errorGoFor = react.useRef(null);
    const setConfigError = (text, label, section) => {
      errorGoFor.current = text;
      setErrorGo({ label, section });
      setError(text);
    };
    react.useEffect(() => {
      if (error !== errorGoFor.current) setErrorGo(null);
    }, [error]);
    const [inputText, setInputText] = react.useState("");
    const [composeText, setComposeText] = react.useState("");
    const defaultProfile = modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
    const resolveRefProfile = (ref) => {
      if (!ref) return void 0;
      const gid = ref.split("#")[0];
      return modelProfiles.find((m) => m.id === ref) ?? modelProfiles.find((m) => m.id === gid);
    };
    const resolveRefVision = (ref) => {
      const profile = resolveRefProfile(ref);
      if (!profile) return false;
      const gid = profile.groupId;
      if (ref && ref.startsWith(`${gid}#`) && profile.groupModels) {
        const mem = profile.groupModels.find((g) => g.modelId === ref.slice(gid.length + 1));
        if (mem) return mem.vision;
      }
      return profile.capabilities.vision ?? false;
    };
    const resolveRefThinking = (ref) => {
      const profile = resolveRefProfile(ref);
      if (!profile) return "medium";
      const gid = profile.groupId;
      if (ref && ref.startsWith(`${gid}#`) && profile.groupModels) {
        const mem = profile.groupModels.find((g) => g.modelId === ref.slice(gid.length + 1));
        if (mem) return mem.thinking;
      }
      return profile.thinking ?? "medium";
    };
    const [thinking, setThinking] = react.useState((defaultProfile == null ? void 0 : defaultProfile.thinking) ?? "medium");
    react.useEffect(() => {
      var _a3;
      if (!selectedTask) setThinking(resolveRefThinking(modelId || ((_a3 = app.settings) == null ? void 0 : _a3.defaultModelId) || (defaultProfile == null ? void 0 : defaultProfile.id)));
    }, [modelId, modelProfiles]);
    const [sending, setSending] = react.useState(false);
    const [decided, setDecided] = react.useState({});
    const [stats, setStats] = react.useState(null);
    const [changesTick, setChangesTick] = react.useState(0);
    const [mention, setMention] = react.useState(null);
    const [mentionItems, setMentionItems] = react.useState([]);
    const [slashQuery, setSlashQuery] = react.useState(null);
    const [slashSel, setSlashSel] = react.useState(0);
    const [mentionSel, setMentionSel] = react.useState(0);
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
    const [awayFromBottom, setAwayFromBottom] = react.useState(false);
    const timelineRef = react.useRef(null);
    const lastChatScrollRef = react.useRef(null);
    const loadOlderRef = react.useRef(null);
    const onTimelineScroll = react.useCallback(() => {
      var _a3;
      const el = timelineRef.current;
      if (!el) return;
      const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
      setAwayFromBottom((v) => v === away ? v : away);
      lastChatScrollRef.current = el.scrollTop;
      if (el.scrollTop < 160) void ((_a3 = loadOlderRef.current) == null ? void 0 : _a3.call(loadOlderRef));
    }, []);
    react.useRef(/* @__PURE__ */ new Set());
    const inputHistory = react.useRef([]);
    const historyIdx = react.useRef(-1);
    const escTs = react.useRef(0);
    const oldestTs = react.useRef(null);
    const composeRef = react.useRef(null);
    const inputRef = react.useRef(null);
    const imageInputRef = react.useRef(null);
    const [, forceTick] = react.useState(0);
    useAgentUIVersion();
    registerBuiltinAgentUI();
    const scrollTimelineToBottom = react.useCallback((smooth) => {
      const doScroll = () => {
        const el = timelineRef.current;
        if (!el) return;
        if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        else el.scrollTop = el.scrollHeight;
        setAwayFromBottom(false);
      };
      doScroll();
      requestAnimationFrame(doScroll);
    }, []);
    const startNewTask = react.useCallback(() => {
      setSelectedTask(null);
      setTab("chat");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        var _a3;
        return (_a3 = composeRef.current) == null ? void 0 : _a3.focus();
      }));
    }, []);
    react.useEffect(() => {
      const h = (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
          e.preventDefault();
          startNewTask();
        }
      };
      window.addEventListener("keydown", h);
      return () => window.removeEventListener("keydown", h);
    }, [startNewTask]);
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
    (agentTasks ?? []).filter((x) => LIVE_STATES.has(x.state)).length;
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
        { taskId: selectedTask, limit: 100 }
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
      const el = timelineRef.current;
      setLoadingOlder(true);
      const prevScrollHeight = (el == null ? void 0 : el.scrollHeight) ?? 0;
      const prevScrollTop = (el == null ? void 0 : el.scrollTop) ?? 0;
      try {
        const h = await call(
          "agent.task.history",
          { taskId: selectedTask, before: oldestTs.current, limit: 100 }
        );
        const older = eventsToBlocks(h.events);
        if ((_a3 = h.events[0]) == null ? void 0 : _a3.ts) oldestTs.current = h.events[0].ts;
        setHasMoreHistory(!!h.hasMore);
        if (older.length > 0) {
          skippingAutoScroll.current = true;
          setEvMap((m) => ({ ...m, [selectedTask]: [...older, ...m[selectedTask] ?? []] }));
          requestAnimationFrame(() => {
            const e2 = timelineRef.current;
            if (!e2) return;
            const delta = e2.scrollHeight - prevScrollHeight;
            if (delta > 0) e2.scrollTop = prevScrollTop + delta;
          });
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingOlder(false);
      }
    };
    loadOlderRef.current = loadOlder;
    const skippingAutoScroll = react.useRef(false);
    react.useEffect(() => {
      if (skippingAutoScroll.current) {
        skippingAutoScroll.current = false;
        return;
      }
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
      var _a3;
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
            else if (name === "cp") await call("agent.task.checkpoint", { taskId: selected.taskId, summary: arg || "手动检查点（/cp）" });
            else if (name === "diff") {
              setTab("diff");
              setInputText("");
              return;
            } else if (name === "attach") {
              (_a3 = imageInputRef.current) == null ? void 0 : _a3.click();
              setInputText("");
              return;
            } else if (name === "plan" || name === "default" || name === "yolo" || name === "approvals") {
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
      var _a3, _b3;
      if (!composeText.trim() || sending) return;
      if (composeText.trim().startsWith("/")) {
        const cmd = composeText.trim().split(/\s+/)[0].slice(1);
        if (cmd === "attach") {
          (_a3 = imageInputRef.current) == null ? void 0 : _a3.click();
          setComposeText("");
          return;
        }
        setError(`命令 /${cmd} 需在具体任务的对话中使用（新任务页仅支持 /attach）`);
        return;
      }
      setSending(true);
      try {
        if (pendingImages.length > 0) {
          const chosenRef = modelId || ((_b3 = modelProfiles.find((m) => m.isDefault)) == null ? void 0 : _b3.id);
          if (!resolveRefVision(chosenRef)) {
            setConfigError("所选模型档案未声明视觉（vision）能力，无法带图创建任务——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models");
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
    const forkTask = async (taskId) => {
      try {
        const forked = await call("agent.task.fork", { taskId });
        await reloadAgents();
        setSelectedTask(forked.taskId);
        setTab("chat");
      } catch (e) {
        setError(e.message);
      }
    };
    const archiveTask = async (taskId) => {
      try {
        await call("agent.task.archive", { taskId, archived: true });
        if (selectedTask === taskId) setSelectedTask(null);
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      }
    };
    const setTaskMode = async (taskId, m) => {
      try {
        await call("agent.task.setMode", { taskId, mode: m });
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
      const slashM = /(^|\s)\/([\w-]*)$/.exec(before);
      if (slashM) {
        setSlashQuery(slashM[2]);
        setSlashSel(0);
        setMention(null);
        return;
      }
      setSlashQuery(null);
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
      setMentionSel(0);
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
    const pickSlash = (insert, setText, current) => {
      const el = document.activeElement;
      const caret = (el == null ? void 0 : el.selectionStart) ?? current.length;
      const before = current.slice(0, caret);
      const m = /(^|\s)\/[\w-]*$/.exec(before);
      setText(m ? current.slice(0, caret - m[0].length + m[1].length) + (insert || "") + " " : current);
      setSlashQuery(null);
    };
    const navKeyDown = (e, text, setText) => {
      const matches = slashQuery !== null ? slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8) : [];
      if (matches.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashSel((s) => (s + 1) % matches.length);
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashSel((s) => (s - 1 + matches.length) % matches.length);
          return true;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          pickSlash(matches[Math.min(slashSel, matches.length - 1)].insert, setText, text);
          return true;
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setSlashQuery(null);
          return true;
        }
      } else if (mention && mentionItems.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionSel((s) => (s + 1) % mentionItems.length);
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionSel((s) => (s - 1 + mentionItems.length) % mentionItems.length);
          return true;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          insertMention(mentionItems[Math.min(mentionSel, mentionItems.length - 1)].insert, setText, text);
          return true;
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setMention(null);
          return true;
        }
      }
      return false;
    };
    const chatKeyDown = (e) => {
      if (navKeyDown(e, inputText, setInputText)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendInput();
        return;
      }
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]);
        return;
      }
    };
    const composeKeyDown = (e) => {
      if (navKeyDown(e, composeText, setComposeText)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void createFromCompose();
        return;
      }
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]);
        return;
      }
    };
    const fmtCtx = (n) => n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`;
    const modelGroups = (modelProfiles ?? []).filter((m) => m.configured).map((m) => ({
      id: m.id,
      name: m.name,
      hint: m.isDefault ? "默认" : m.source === "package" ? "包" : void 0,
      members: m.groupModels && m.groupModels.length > 1 ? m.groupModels.map((g, i) => ({
        // 首成员复用分组 id（与后端约定一致），其余 `<分组id>#<模型id>`
        id: i === 0 ? m.id : `${m.groupId}#${g.modelId}`,
        name: g.modelId,
        sub: [g.vision ? "视觉" : null, g.contextTokens ? `${fmtCtx(g.contextTokens)} ctx` : null].filter(Boolean).join(" · ") || void 0
      })) : [{ id: m.id, name: m.modelId }]
    }));
    const slashItems = (() => {
      const list = BUILTIN_SLASH.map((c) => ({ name: `/${c.name}`, hint: c.hint, insert: `/${c.name}` }));
      for (const c of pkgCommands) list.push({ name: `/${c.name}`, hint: c.packageId, insert: `/${c.name}` });
      return list;
    })();
    const renderBlock = (b, key) => {
      switch (b.kind) {
        case "permission":
          return /* @__PURE__ */ jsxRuntime.jsx(PermissionCard, { b, decided: decided[b.requestId], sel: permSel[b.requestId] ?? 0, showFullAccess, onSel: (id, i) => setPermSel((m) => ({ ...m, [id]: i })), onReply: replyPerm, onFullAccess: (id) => void replyFullAccess(id) }, key);
        case "question":
          return /* @__PURE__ */ jsxRuntime.jsx(QuestionCard, { b, decided: decided[b.requestId], onAnswer: replyAnswer }, key);
        case "plan":
          return /* @__PURE__ */ jsxRuntime.jsx(PlanCard, { b, decided: decided[b.requestId], onPlan: replyPlan }, key);
        case "todo":
          return null;
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
          title: `${task.title}
${stateChip(task.state).label} · ${task.branch}`,
          style: { border: `1px solid ${selectedNow ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 10, padding: "6px 6px 6px 11px", cursor: "pointer", background: "var(--c-panel)", display: "flex", alignItems: "center", gap: 8, minHeight: 34 },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { width: 7, height: 7, borderRadius: "50%", background: dotColor, flex: "none", opacity: working ? 1 : 0.85 } }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600 }, children: task.title }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "icon-btn",
                title: live ? "运行中不可分叉，请先停止" : "分叉任务（复制对话历史到新分支）",
                disabled: live,
                onClick: (e) => {
                  e.stopPropagation();
                  void forkTask(task.taskId);
                },
                children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "fork", size: 14 })
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "icon-btn",
                title: live ? "运行中不可归档，请先停止" : "归档任务（从列表隐藏，可恢复）",
                disabled: live,
                onClick: (e) => {
                  e.stopPropagation();
                  void archiveTask(task.taskId);
                },
                children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "archive", size: 14 })
              }
            )
          ]
        },
        task.taskId
      );
    };
    const busy = selected ? BUSY_STATES.has(selected.state) : false;
    const activeProfile = resolveRefProfile(selected == null ? void 0 : selected.modelRef) ?? modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
    const visionOk = resolveRefVision((selected == null ? void 0 : selected.modelRef) ?? (activeProfile == null ? void 0 : activeProfile.id));
    const attachmentsPayload = pendingImages.map((img) => ({ name: img.name, dataBase64: img.dataUrl }));
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", flex: 1, minHeight: 0, height: "100%" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx(
        "input",
        {
          ref: imageInputRef,
          type: "file",
          accept: "image/*",
          multiple: true,
          style: { display: "none" },
          onChange: (e) => {
            const files = [...e.target.files ?? []];
            e.target.value = "";
            if (files.length === 0) return;
            if (!visionOk) {
              setConfigError("当前模型档案未声明视觉（vision）能力，无法附加图片——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models");
              return;
            }
            filesToImages(files);
          }
        }
      ),
      preview && /* @__PURE__ */ jsxRuntime.jsxs(Modal, { title: `预览：${preview.path}`, confirmText: "关闭", onConfirm: () => setPreview(null), onClose: () => setPreview(null), children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11, color: "var(--c-text3)", marginBottom: 6 }, children: previewLoading ? "加载中…" : `${preview.binary ? "二进制文件" : `${(preview.size / 1024).toFixed(1)} KB`}${preview.truncated ? " · 已截断（前 64KB）" : ""}` }),
        /* @__PURE__ */ jsxRuntime.jsx("pre", { style: { maxHeight: 420, overflow: "auto", background: "var(--c-panel2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, fontFamily: "var(--mono, monospace)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }, children: preview.content })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "new-task-btn", style: { margin: "10px 10px 6px", width: "calc(100% - 20px)" }, onClick: startNewTask, children: "＋ 新任务（描述目标，Ctrl+N）" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }, children: [
          ((agentTasks == null ? void 0 : agentTasks.length) ?? 0) === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 12, color: "var(--c-text3)", padding: "4px 2px" }, children: t("Agents_EmptyHint") }),
          agentTasks == null ? void 0 : agentTasks.map(agentCard)
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", gap: 2, padding: "6px 14px 0", borderBottom: "1px solid var(--c-border)" }, children: [["chat", "对话"], ["diff", `改动${diffCount ? ` ${diffCount}` : ""}`], ["cp", `检查点${cpCount ? ` ${cpCount}` : ""}`]].map(([id, label]) => /* @__PURE__ */ jsxRuntime.jsx(
          "div",
          {
            onClick: () => setTab(id),
            style: { padding: "5px 14px", fontSize: 12.5, color: tab === id ? "var(--c-text)" : "var(--c-text3)", cursor: "pointer", border: `1px solid ${tab === id ? "var(--c-border)" : "transparent"}`, borderBottom: "none", borderRadius: "8px 8px 0 0" },
            children: label
          },
          id
        )) }),
        selected && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: tab === "chat" ? "flex" : "none", flexDirection: "column", overflow: "hidden" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap", color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)" }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { fontSize: 11.5, padding: "1px 10px", borderRadius: 999, border: `1px solid ${stateChip(selected.state).color}`, color: stateChip(selected.state).color }, children: [
              stateChip(selected.state).label,
              busy && selected.lastActiveAt ? " · " + Math.max(0, Math.round((Date.now() - new Date(selected.lastActiveAt).getTime()) / 1e3)) + "s" : ""
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 11.5 }, children: selected.branch }),
            runningTool ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-amber)", display: "inline-flex", alignItems: "center", gap: 5 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: toolIconName(runningTool.name), size: 11, className: "tl-pulse" }),
              TOOL_LABELS[runningTool.name] ?? runningTool.name,
              " ",
              ((Date.now() - runningTool.startTs) / 1e3).toFixed(1),
              "s"
            ] }) : null,
            (((_b2 = selected.queued) == null ? void 0 : _b2.length) ?? 0) > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-amber)", display: "inline-flex", alignItems: "center", gap: 5 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "clock", size: 11 }),
              "排队 ",
              selected.queued.length
            ] }) : null,
            /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
              "子代理 ",
              runningSubs,
              "/",
              maxSubagents
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { children: "Esc 中断 · Esc×2 回滚 · Shift+Tab 模式 · ↑↓ 历史" }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": "在新窗口打开 worktree", onClick: () => void call("app.newWindow", { path: selected.worktreePath }), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "external", size: 14 }) })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, minWidth: 0, position: "relative" }, children: [
            error && /* @__PURE__ */ jsxRuntime.jsx(ErrorFloat, { text: error, maxWidth: "calc(100% - 292px)", go: errorGo, onGo: (s) => {
              openSettings(s);
              setError(null);
            }, onClose: () => setError(null) }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "div",
              {
                ref: timelineRef,
                style: { height: "100%", overflowY: "auto", overflowX: "hidden" },
                onScroll: onTimelineScroll,
                onDoubleClick: (e) => {
                  var _a3;
                  const pre = e.target.closest("pre");
                  if (pre) void ((_a3 = navigator.clipboard) == null ? void 0 : _a3.writeText(pre.textContent ?? ""));
                },
                children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { maxWidth: 880, margin: "0 auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }, children: [
                  loadingOlder && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { textAlign: "center", color: "var(--c-text3)", fontSize: 11 }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tl-pulse", children: "加载中…" }) }),
                  hasMoreHistory && !loadingOlder && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { textAlign: "center", color: "var(--c-text3)", fontSize: 11, opacity: 0.6 }, children: "↑ 上滚加载更早" }),
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
            (() => {
              const todoBlock = [...timeline].reverse().find((b) => b.kind === "todo");
              if (!todoBlock) return null;
              return /* @__PURE__ */ jsxRuntime.jsx(
                "div",
                {
                  style: {
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 260,
                    maxWidth: "calc(100% - 16px)",
                    background: "var(--c-panel2)",
                    border: "1px solid var(--c-border-strong)",
                    borderRadius: 10,
                    boxShadow: "0 2px 8px rgba(0,0,0,.22)",
                    zIndex: 10,
                    overflow: "hidden"
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TodoList, { todos: todoBlock.todos })
                }
              );
            })(),
            awayFromBottom && /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn icon",
                "data-tip": "返回底部",
                "aria-label": "返回底部",
                style: {
                  position: "absolute",
                  left: "50%",
                  bottom: 10,
                  transform: "translateX(-50%)",
                  width: 28,
                  height: 28,
                  padding: 0,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--c-panel2)",
                  border: "1px solid var(--c-border-strong)",
                  color: "var(--c-text2)",
                  boxShadow: "0 2px 8px rgba(0,0,0,.22)"
                },
                onClick: () => scrollTimelineToBottom(false),
                children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 14 })
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { borderTop: "1px solid var(--c-border)", padding: "8px 20px 8px" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { maxWidth: 880, margin: "0 auto", position: "relative" }, children: [
            pendingPerm && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: 8, fontSize: 11.5, color: "var(--c-amber)", display: "flex", alignItems: "center", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 12, className: "tl-pulse" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "等待授权（↑↓+Enter 或数字直选上方卡片选项）" })
            ] }),
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
            /* @__PURE__ */ jsxRuntime.jsx(
              Composer,
              {
                ref: inputRef,
                value: inputText,
                onChange: (v) => onComposeChange(v, setInputText),
                maxH: 240,
                placeholder: busy ? "agent 正在工作——输入将排队，本轮结束后自动注入（Esc 中断 / Esc×2 回滚）" : "继续对话…输入 / 唤起命令、@ 唤起文件、Shift+Tab 切模式",
                busy,
                sending,
                canSend: !!inputText.trim(),
                sendTitle: busy ? "停止（Esc 同效）" : "发送（Enter）",
                onStop: () => void stopTask(selected.taskId),
                onSend: () => void sendInput(),
                mode: selected.permissionMode ?? "default",
                modeLabel: MODE_META[selected.permissionMode ?? "default"].label.replace(/^[●◆◇⚡]\s*/, ""),
                onMode: (m) => void setTaskMode(selected.taskId, m).then(() => setMode(m)),
                groups: modelGroups,
                model: selected.modelRef ?? "",
                modelDisabled: busy && selected.state !== "awaiting-input",
                onModel: (id) => void (async () => {
                  try {
                    await call("agent.task.setModel", { taskId: selected.taskId, model: id });
                    await reloadAgents();
                    setThinking(resolveRefThinking(id));
                  } catch (err) {
                    setError(err.message);
                  }
                })(),
                thinking,
                onThinking: (v) => {
                  setThinking(v);
                },
                stats,
                attachments: pendingImages.map((img, i) => ({ name: img.name, dataUrl: img.dataUrl, onRemove: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)) })),
                attachmentHint: `图片 ${pendingImages.length}/4${!visionOk ? " · ⚠ 当前模型未声明视觉能力" : ""}`,
                onAttachImage: () => {
                  var _a3;
                  return (_a3 = imageInputRef.current) == null ? void 0 : _a3.click();
                },
                slash: slashItems,
                onPickSlash: (insert) => {
                  setInputText((cur) => cur ? `${cur} ${insert}` : insert);
                  setTimeout(() => {
                    var _a3;
                    return (_a3 = inputRef.current) == null ? void 0 : _a3.focus();
                  }, 0);
                },
                onKeyDown: chatKeyDown,
                children: /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                  mention ? /* @__PURE__ */ jsxRuntime.jsx(MentionPopover, { mention, items: mentionItems, selectedIndex: mentionSel, onSelect: setMentionSel, onPick: (x) => insertMention(x, setInputText, inputText) }) : null,
                  slashQuery !== null && /* @__PURE__ */ jsxRuntime.jsx(SlashPopover, { open: true, items: slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8), selectedIndex: slashSel, onSelect: setSlashSel, onPick: (insert) => pickSlash(insert, setInputText, inputText) })
                ] })
              }
            )
          ] }) })
        ] }),
        tab === "chat" && !selected && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }, children: [
          error && /* @__PURE__ */ jsxRuntime.jsx(ErrorFloat, { text: error, maxWidth: "min(680px, 92%)", go: errorGo, onGo: (s) => {
            openSettings(s);
            setError(null);
          }, onClose: () => setError(null) }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { width: 680, maxWidth: "90%" }, children: [
            modelInfo && !modelInfo.available ? /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "tool-btn", style: { color: "var(--c-amber)", borderColor: "var(--c-amber)", marginBottom: 10 }, onClick: () => openSettings("models"), children: [
              "● ",
              t("Agents_ModelMissing"),
              " → ",
              t("Agents_OpenSettings")
            ] }) : null,
            /* @__PURE__ */ jsxRuntime.jsx(
              Composer,
              {
                ref: composeRef,
                value: composeText,
                onChange: (v) => onComposeChange(v, setComposeText),
                maxH: 208,
                minH: 42,
                autoFocus: true,
                placeholder: `${t("Agents_ComposePlaceholder")}
支持 @文件 提及；规划类任务先切「◇ 规划」模式（Shift+Tab）`,
                busy: false,
                sending,
                canSend: !!composeText.trim(),
                sendTitle: "创建任务（Enter）",
                onStop: () => {
                },
                onSend: () => void createFromCompose(),
                mode,
                modeLabel: MODE_META[mode].label.replace(/^[●◆◇⚡]\s*/, ""),
                onMode: setMode,
                groups: modelGroups,
                model: modelId || (((_c = modelProfiles.find((m) => m.isDefault)) == null ? void 0 : _c.id) ?? ""),
                onModel: setModelId,
                thinking,
                onThinking: setThinking,
                stats: null,
                attachments: pendingImages.map((img, i) => ({ name: img.name, dataUrl: img.dataUrl, onRemove: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)) })),
                attachmentHint: `图片 ${pendingImages.length}/4（随首条消息发送）`,
                onAttachImage: () => {
                  var _a3;
                  return (_a3 = imageInputRef.current) == null ? void 0 : _a3.click();
                },
                slash: slashItems,
                onPickSlash: (insert) => {
                  setComposeText((cur) => cur ? `${cur} ${insert}` : insert);
                  setTimeout(() => {
                    var _a3;
                    return (_a3 = composeRef.current) == null ? void 0 : _a3.focus();
                  }, 0);
                },
                onKeyDown: composeKeyDown,
                children: /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                  mention ? /* @__PURE__ */ jsxRuntime.jsx(MentionPopover, { mention, items: mentionItems, selectedIndex: mentionSel, onSelect: setMentionSel, onPick: (x) => insertMention(x, setComposeText, composeText) }) : null,
                  slashQuery !== null && /* @__PURE__ */ jsxRuntime.jsx(SlashPopover, { open: true, items: slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8), selectedIndex: slashSel, onSelect: setSlashSel, onPick: (insert) => pickSlash(insert, setComposeText, composeText) })
                ] })
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { color: "var(--c-text3)", fontSize: 11, marginTop: 6 }, children: [
              "Enter 发送 · Shift+Enter 换行 · ",
              t("Agents_TargetHint"),
              " · 规划模式：先调研出计划，批准后自动执行"
            ] })
          ] })
        ] }),
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
