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
    runCommand: (cmd, ctx) => U().runCommand(cmd, ctx),
    extTree: () => U().extTree()
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
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
  const Modal = K().Modal;
  K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  const NavIcon = K().NavIcon;
  const Select = K().Select;
  K().ReflogDialog;
  K().ScrollArea;
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
  const { call, t, updateSettings, applySettings, clearSettingsFocus, reloadTheme } = pageSdk;
  const useApp = useAppState;
  const GIT_KEYS = {
    userName: "user.name",
    userEmail: "user.email",
    autoSetupRemote: "push.autoSetupRemote",
    pullRebase: "pull.rebase",
    autocrlf: "core.autocrlf"
  };
  const CATEGORIES = [
    { id: "appearance", titleKey: "Settings_CatAppearance", glyph: "" },
    { id: "terminal", titleKey: "Settings_CatTerminal", glyph: "" },
    {
      id: "repo",
      titleKey: "Settings_CatRepo",
      svg: "M13.1 3.9a2.3 2.3 0 0 0-3.25 3.25l-.1.1a2.3 2.3 0 0 1-3.25 0L5.4 6.2a2.3 2.3 0 1 0-1.06 1.06l1.1 1.05a3.8 3.8 0 0 0 2.31 1.09v1.2a2.3 2.3 0 1 0 1.5 0V9.4a3.8 3.8 0 0 0 2.31-1.09l.1-.1a2.3 2.3 0 1 0 1.44-4.31z"
    },
    { id: "models", titleKey: "Settings_CatModels", glyph: "" },
    { id: "ai", titleKey: "Settings_CatAi", glyph: "" },
    { id: "extensions", titleKey: "Settings_CatExtensions", glyph: "" },
    { id: "about", titleKey: "Settings_CatAbout", glyph: "" }
  ];
  const SECTIONS = [
    { id: "appearance", cat: "appearance", titleKey: "Settings_AppearanceSection" },
    { id: "diff", cat: "appearance", titleKey: "Settings_DiffSection" },
    { id: "terminal", cat: "terminal", titleKey: "Settings_TerminalSection" },
    { id: "git", cat: "repo", titleKey: "Settings_GitSection" },
    { id: "monitor", cat: "repo", titleKey: "Settings_MonitorSection" },
    { id: "editor", cat: "repo", titleKey: "Settings_EditorSection" },
    { id: "models", cat: "models", titleKey: "Settings_ModelsSection" },
    { id: "ai", cat: "ai", titleKey: "Settings_AiSection" },
    { id: "safety", cat: "ai", titleKey: "Settings_SafetyNetSection" },
    { id: "agent", cat: "ai", titleKey: "Settings_AgentSection" },
    { id: "mcp", cat: "ai", titleKey: "Settings_McpSection" },
    { id: "extensions", cat: "extensions", titleKey: "Settings_ExtensionsSection" },
    { id: "about", cat: "about", titleKey: "Settings_AboutSection" }
  ];
  const SEARCH_INDEX = [
    { section: "appearance", labelKey: "Settings_Theme", kw: "dark light 深色 浅色 theme" },
    { section: "appearance", labelKey: "Settings_ThemePackage", kw: "主题包 theme package tokenColors" },
    { section: "appearance", labelKey: "Settings_Language", kw: "language 语言 i18n 中文 english" },
    { section: "diff", labelKey: "Settings_DiffMode", kw: "diff side inline 并排 内联 差异" },
    { section: "terminal", labelKey: "Settings_Shell", kw: "shell powershell cmd bash 终端" },
    { section: "terminal", labelKey: "Settings_TerminalFont", kw: "font 字体 字号" },
    { section: "terminal", labelKey: "Settings_TerminalFollowRepo", kw: "follow 跟随仓库 cwd" },
    { section: "terminal", labelKey: "Settings_BashPath", kw: "bash 路径 git bash" },
    { section: "git", labelKey: "Settings_GitScope", kw: "scope 仓库级 全局 层级" },
    { section: "git", labelKey: "Settings_GitUserName", kw: "user.name 用户名" },
    { section: "git", labelKey: "Settings_GitUserEmail", kw: "user.email 邮箱" },
    { section: "git", labelKey: "Settings_GitAutoSetupRemote", kw: "push.autoSetupRemote 上游" },
    { section: "git", labelKey: "Settings_GitPullRebase", kw: "pull.rebase 拉取 变基" },
    { section: "git", labelKey: "Settings_GitAutocrlf", kw: "autocrlf 换行" },
    { section: "git", labelKey: "Settings_GitRemotes", kw: "remote 远程 origin" },
    { section: "monitor", labelKey: "Settings_AutoFetch", kw: "fetch 自动拉取 后台 轮询" },
    { section: "editor", labelKey: "Settings_ExternalEditor", kw: "编辑器 vscode 外部" },
    { section: "ai", labelKey: "Settings_AiProvider", kw: "provider openai anthropic ollama deepseek 模型端点" },
    { section: "ai", labelKey: "Settings_AiEndpoint", kw: "endpoint model 端点 模型名" },
    { section: "ai", labelKey: "Settings_AiApiKey", kw: "api key 密钥 safeStorage" },
    { section: "ai", labelKey: "Settings_AiPrivacy", kw: "privacy 隐私 元数据 全量 diff" },
    { section: "ai", labelKey: "Settings_AiTrailer", kw: "trailer assisted-by 署名" },
    { section: "models", labelKey: "Settings_ModelsSection", kw: "模型档案 model profile deepseek ollama anthropic key 密钥 用量" },
    { section: "safety", labelKey: "Settings_SafetyNet", kw: "安全网 secrets 拦截 block warn 提交扫描" },
    { section: "agent", labelKey: "Settings_AgentCheckpoint", kw: "agent checkpoint 托管 wip 提交" },
    { section: "agent", labelKey: "Settings_AgentOnExit", kw: "agent 退出 终止 保留 会话" },
    { section: "agent", labelKey: "Settings_AgentRules", kw: "agent 权限规则 allow deny 允许 拒绝 rules 前缀" },
    { section: "agent", labelKey: "Settings_AgentCompaction", kw: "agent 上下文压缩 compact compaction 摘要" },
    { section: "mcp", labelKey: "Settings_McpEnabled", kw: "mcp server 管道 工具" },
    { section: "extensions", labelKey: "Extensions_Import", kw: "扩展 包 .gpk 导入 卸载 主题 语法 harness" },
    { section: "about", labelKey: "Settings_AboutSection", kw: "about 版本 version git" }
  ];
  function SettingsPage() {
    var _a2;
    const app = useApp();
    const s = app.settings;
    const [themes, setThemes] = react.useState([]);
    const [profiles, setProfiles] = react.useState([
      { id: "powershell", name: "PowerShell", source: "builtin" },
      { id: "cmd", name: "CMD", source: "builtin" },
      { id: "bash", name: "Git Bash", source: "builtin" }
    ]);
    const [gitVersion, setGitVersion] = react.useState("…");
    const [configScope, setConfigScope] = react.useState("repo");
    const [localCfg, setLocalCfg] = react.useState({});
    const [globalCfg, setGlobalCfg] = react.useState({});
    const [noRepo, setNoRepo] = react.useState(false);
    const [remotes, setRemotes] = react.useState([]);
    const [newRemote, setNewRemote] = react.useState({ name: "", url: "" });
    const [cfgError, setCfgError] = react.useState(null);
    const [exts, setExts] = react.useState([]);
    const [extError, setExtError] = react.useState(null);
    const [catalogUrl, setCatalogUrl] = react.useState("");
    const [extView, setExtView] = react.useState("tree");
    const [treeOpen, setTreeOpen] = react.useState({});
    const [extTreeData, setExtTreeData] = react.useState(null);
    const [agentCmds, setAgentCmds] = react.useState([]);
    const KIND_SECTIONS = [
      { kind: "theme", label: "主题" },
      { kind: "grammar", label: "语法" },
      { kind: "skills", label: "技能" },
      { kind: "commands", label: "命令" },
      { kind: "pages", label: "页面" },
      { kind: "mcpServers", label: "MCP 服务器" },
      { kind: "models", label: "模型" },
      { kind: "taskTypes", label: "任务型" },
      { kind: "harness", label: "Agent 宿主" },
      { kind: "terminalProfiles", label: "终端档位" },
      { kind: "safetyRules", label: "安全网规则" },
      { kind: "emptyHints", label: "空状态提示" },
      { kind: "menus", label: "菜单" },
      { kind: "keybindings", label: "快捷键" },
      { kind: "configuration", label: "配置" }
    ];
    const primaryKindOf = (p) => p.kinds.find((k) => KIND_SECTIONS.some((x) => x.kind === k)) ?? p.kinds[0] ?? "__other";
    const kindLabel = (k) => {
      var _a3;
      return ((_a3 = KIND_SECTIONS.find((x) => x.kind === k)) == null ? void 0 : _a3.label) ?? k;
    };
    const treeHeader = (id, glyph, title, sub, count) => {
      const open = treeOpen[id] ?? false;
      return /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          onClick: () => setTreeOpen((m) => ({ ...m, [id]: !open })),
          style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 8, cursor: "pointer", background: "var(--c-hover)", fontSize: 12.5 },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", style: { color: "var(--c-text3)", width: 12 }, children: open ? "▾" : "▸" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { children: glyph }),
            /* @__PURE__ */ jsxRuntime.jsx("b", { children: title }),
            sub,
            count !== null && count > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
              "· 挂载 ",
              count
            ] })
          ]
        }
      );
    };
    const extMountTree = () => {
      const pkgById = new Map(exts.map((p) => [p.id, p]));
      const consumed = /* @__PURE__ */ new Set();
      const cmdsByPkg = /* @__PURE__ */ new Map();
      for (const c of agentCmds) {
        const a = c.args ?? {};
        const pid = c.packageId ?? "";
        if (!pid) continue;
        if (!cmdsByPkg.has(pid)) cmdsByPkg.set(pid, []);
        cmdsByPkg.get(pid).push(`${pid.split(".").pop() ?? "pkg"}:${a.slash ?? c.id}`);
      }
      const AGENT_TIMELINE_SLOT = "tasks";
      const tierLabel = (x) => x === "user" ? "用户包" : x === "builtin" ? "内置包" : "宿主";
      const agentUI = (extTreeData == null ? void 0 : extTreeData.agentUI) ?? [];
      const pageNodes = ((extTreeData == null ? void 0 : extTreeData.pages) ?? []).map((pg) => {
        const provider = pg.packageId ? pkgById.get(pg.packageId) ?? null : null;
        if (provider) consumed.add(provider.id);
        const mountees = [];
        for (const sh of pg.shadowed) {
          const p2 = pkgById.get(sh.packageId);
          if (p2) {
            consumed.add(p2.id);
            mountees.push({ pkg: p2, note: "页面提供者（替补 · 同槽位竞争落败）" });
          }
        }
        if (pg.slot === AGENT_TIMELINE_SLOT) {
          for (const r of agentUI) {
            if (r.packageId === pg.packageId) continue;
            const p2 = pkgById.get(r.packageId);
            if (!p2) continue;
            consumed.add(p2.id);
            mountees.push({ pkg: p2, note: `挂载：时间线渲染器 ×${r.renderers} · 输入台 provider ×${r.providers}（${tierLabel(r.tier)}层）` });
          }
          for (const [pid, names] of cmdsByPkg) {
            if (pid === pg.packageId) continue;
            const p2 = pkgById.get(pid);
            if (!p2) continue;
            consumed.add(pid);
            mountees.push({ pkg: p2, note: `挂载：会话命令 ×${names.length}（${names.map((n) => `/${n}`).join(" ")}）` });
          }
        }
        const providerReg = agentUI.find((r) => r.packageId === pg.packageId) ?? null;
        return { pg, provider, providerReg, mountees };
      });
      const knownKinds = new Set(KIND_SECTIONS.map((x) => x.kind));
      const globalGroups = KIND_SECTIONS.map(({ kind, label }) => ({
        key: kind,
        label,
        pkgs: exts.filter((p) => !consumed.has(p.id) && primaryKindOf(p) === kind).sort((a, b) => a.name.localeCompare(b.name))
      })).filter((g) => g.pkgs.length > 0);
      const otherGlobal = exts.filter((p) => !consumed.has(p.id) && !knownKinds.has(primaryKindOf(p)));
      const globalCount = globalGroups.reduce((n, g) => n + g.pkgs.length, 0) + otherGlobal.length;
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
        pageNodes.map(({ pg, provider, providerReg, mountees }) => {
          const title = pg.titleKey ? t(pg.titleKey) : pg.title ?? pg.slot;
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
            treeHeader(`page:${pg.slot}`, "📄", title, /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint mono", children: pg.slot }),
              !provider && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "（提供者未装载）" })
            ] }), mountees.length),
            (treeOpen[`page:${pg.slot}`] ?? mountees.length > 0) && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginLeft: 16, borderLeft: "2px solid var(--c-border)", paddingLeft: 12, paddingTop: 6, display: "flex", flexDirection: "column", gap: 8 }, children: [
              provider && renderExtCard(provider, /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
                "页面提供者",
                pg.isBuiltIn ? " · 内置" : " · 用户包",
                providerReg ? ` · 本页自举：渲染器 ×${providerReg.renderers} · 输入台 provider ×${providerReg.providers}` : ""
              ] })),
              mountees.map(({ pkg, note }, idx) => /* @__PURE__ */ jsxRuntime.jsx("div", { children: renderExtCard(pkg, /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: note })) }, `${pkg.id}:${idx}`))
            ] })
          ] }, pg.slot);
        }),
        globalCount > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
          treeHeader("__global", "🌐", "全局（非页面级）", null, -1),
          (treeOpen["__global"] ?? false) && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginLeft: 16, borderLeft: "2px solid var(--c-border)", paddingLeft: 12, paddingTop: 6, display: "flex", flexDirection: "column", gap: 8 }, children: [
            globalGroups.map((g) => /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }, children: [
                g.label,
                " ",
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
                  "（",
                  g.pkgs.length,
                  "）"
                ] })
              ] }),
              g.pkgs.map((p) => renderExtCard(p))
            ] }, g.key)),
            otherGlobal.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }, children: [
                "其他 ",
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
                  "（",
                  otherGlobal.length,
                  "）"
                ] })
              ] }),
              otherGlobal.map((p) => renderExtCard(p))
            ] })
          ] })
        ] })
      ] });
    };
    const renderExtCard = (p, extra) => {
      var _a3, _b2;
      const cfgValues = ((_b2 = (_a3 = s == null ? void 0 : s.packages) == null ? void 0 : _a3[p.id]) == null ? void 0 : _b2.config) ?? {} ?? {};
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              type: "checkbox",
              checked: p.state === "active",
              disabled: p.state === "error",
              title: p.state === "disabled" && p.reason ? p.reason : void 0,
              onChange: (e) => void setPkgEnabled(p, e.target.checked)
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text2)" }, children: [
              "[",
              kindLabel(primaryKindOf(p)),
              "]"
            ] }),
            " ",
            p.name,
            " ",
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
              "v",
              p.version
            ] })
          ] }),
          p.isBuiltIn && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Extensions_BuiltIn") }),
          p.kinds.map((k) => /* @__PURE__ */ jsxRuntime.jsxs(
            "button",
            {
              className: "tool-btn",
              title: p.kindStates[k] ? "点击禁用该类内容" : "点击启用该类内容",
              style: { opacity: p.kindStates[k] === false ? 0.45 : 1, padding: "0 6px" },
              onClick: async () => {
                setExtError(null);
                try {
                  await refreshExts(await call("extensions.setKindEnabled", {
                    id: p.id,
                    kind: k,
                    enabled: p.kindStates[k] === false
                  }));
                } catch (e) {
                  setExtError(e.message);
                }
              },
              children: [
                k,
                p.kindStates[k] === false ? "（已禁用）" : ""
              ]
            },
            k
          )),
          p.permissions.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", title: "权限域声明", children: [
            "权限: ",
            p.permissions.join(" / ")
          ] }),
          p.state !== "active" && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { color: "var(--c-red)" }, children: p.state === "error" ? `${t("Extensions_Error")}: ${p.reason ?? ""}` : t("Extensions_Disabled") + (p.reason ? ` — ${p.reason}` : "") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          !p.isBuiltIn && p.state !== "error" && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void uninstallPkg(p), children: t("Extensions_Uninstall") })
        ] }),
        extra && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { paddingLeft: 24, marginTop: -2 }, children: extra }),
        p.state === "active" && p.kindStates.configuration && p.configuration.map((item) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", paddingLeft: 24 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { width: 140 }, children: item.title ?? item.key }),
          item.type === "boolean" ? /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              type: "checkbox",
              checked: typeof cfgValues[item.key] === "boolean" ? cfgValues[item.key] : !!item.default,
              onChange: (e) => void call("extensions.setConfig", { id: p.id, key: item.key, value: e.target.checked })
            }
          ) : /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "input",
              style: { width: 200 },
              type: item.type === "number" ? "number" : "text",
              value: cfgValues[item.key] !== void 0 ? String(cfgValues[item.key]) : String(item.default),
              onChange: (e) => {
                const v = item.type === "number" ? Number(e.target.value) : e.target.value;
                void call("extensions.setConfig", { id: p.id, key: item.key, value: v });
              }
            }
          )
        ] }, item.key))
      ] }, p.id);
    };
    const [modelProfiles, setModelProfiles] = react.useState([]);
    const [modelAddOpen, setModelAddOpen] = react.useState(false);
    const [modelEdit, setModelEdit] = react.useState(null);
    const [defaultPickFor, setDefaultPickFor] = react.useState(null);
    const loadModels = react.useCallback(async () => {
      try {
        setModelProfiles(await call("models.list"));
      } catch {
      }
    }, []);
    const [cat, setCat] = react.useState("appearance");
    const [query, setQuery] = react.useState("");
    const [flash, setFlash] = react.useState(null);
    const flashTimer = react.useRef(null);
    const pullExtTree = react.useCallback(() => {
      try {
        setExtTreeData(pageSdk.extTree());
      } catch {
      }
    }, []);
    react.useEffect(() => pageSdk.on("extensions.changed", () => pullExtTree()), [pullExtTree]);
    react.useEffect(() => {
      void call("themes.list").then(setThemes);
      void call("terminal.profiles").then(setProfiles);
      void call("app.gitVersion").then((v) => setGitVersion(v ?? t("Settings_GitNotFound")));
      void call("extensions.list").then(setExts);
      void call("commands.list").then((cmds) => setAgentCmds(cmds.filter((c) => c.action === "agent.command"))).catch(() => {
      });
      pullExtTree();
      void loadModels();
    }, [loadModels, pullExtTree]);
    const refreshExts = async (list) => {
      setExts(list);
      pullExtTree();
      if (list.some((p) => p.kinds.includes("theme"))) {
        const fresh = await call("settings.get");
        applySettings(fresh);
        await reloadTheme();
      }
    };
    const importGpk = async () => {
      setExtError(null);
      try {
        const r = await call("extensions.importGpk");
        if (r) await refreshExts(r);
      } catch (e) {
        setExtError(e.message);
      }
    };
    const setPkgEnabled = async (p, enabled) => {
      setExtError(null);
      try {
        await refreshExts(await call("extensions.setEnabled", { id: p.id, enabled }));
      } catch (e) {
        setExtError(e.message);
      }
    };
    const uninstallPkg = async (p) => {
      setExtError(null);
      try {
        await refreshExts(await call("extensions.uninstall", { id: p.id }));
      } catch (e) {
        setExtError(e.message);
      }
    };
    react.useEffect(() => {
      (async () => {
        const [l, g] = await Promise.all([
          call("gitconfig.list", { scope: "repo" }).catch(() => null),
          call("gitconfig.list", { scope: "global" }).catch(() => ({}))
        ]);
        setNoRepo(l === null);
        setLocalCfg(l ?? {});
        setGlobalCfg(g);
        setRemotes(l !== null ? await call("remote.list").catch(() => []) : []);
      })();
    }, [(_a2 = app.repo) == null ? void 0 : _a2.workDir]);
    const gotoSection = (id) => {
      const sec = SECTIONS.find((x) => x.id === id);
      if (!sec) return;
      setCat(sec.cat);
      setQuery("");
      window.setTimeout(() => {
        var _a3;
        (_a3 = document.getElementById(`set-sec-${id}`)) == null ? void 0 : _a3.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlash(id);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
      }, 60);
    };
    react.useEffect(() => {
      if (app.settingsFocus) {
        gotoSection(app.settingsFocus);
        clearSettingsFocus();
      }
    }, [app.settingsFocus]);
    if (!s) return null;
    const patch = async (p) => {
      await updateSettings(p);
    };
    const q = query.trim().toLowerCase();
    const matches = q ? SEARCH_INDEX.filter((it) => {
      const label = t(it.labelKey).toLowerCase();
      return label.includes(q) || it.labelKey.toLowerCase().includes(q) || (it.kw ?? "").toLowerCase().includes(q);
    }) : [];
    const cfgGet = (map, key) => map[key.toLowerCase()];
    const cfgInherited = (key) => cfgGet(localCfg, key) === void 0 ? globalCfg[key.toLowerCase()] ?? null : null;
    const reloadGitConfig = async () => {
      const [l, g, r] = await Promise.all([
        call("gitconfig.list", { scope: "repo" }).catch(() => null),
        call("gitconfig.list", { scope: "global" }).catch(() => ({})),
        call("remote.list").catch(() => [])
      ]);
      setNoRepo(l === null);
      setLocalCfg(l ?? {});
      setGlobalCfg(g);
      setRemotes(r);
    };
    const saveConfig = async (key, value) => {
      setCfgError(null);
      try {
        await call("gitconfig.set", { key, value, scope: configScope });
        await reloadGitConfig();
      } catch (e) {
        setCfgError(e.message);
        await reloadGitConfig();
      }
    };
    const cfgTextLabel = (key) => {
      const inherited = cfgInherited(key);
      return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "input",
          {
            className: "input",
            style: { width: 260 },
            value: configScope === "repo" ? cfgGet(localCfg, key) ?? "" : cfgGet(globalCfg, key) ?? "",
            placeholder: inherited ?? "",
            title: inherited !== null ? t("Settings_GitInheritGlobal", inherited) : void 0,
            onChange: (e) => void saveConfig(key, e.target.value === "" ? null : e.target.value),
            disabled: configScope === "repo" && noRepo
          }
        ),
        inherited !== null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitInheritGlobal", inherited) })
      ] });
    };
    const cfgSelect = (key, options) => {
      const value = configScope === "repo" ? cfgGet(localCfg, key) ?? "" : cfgGet(globalCfg, key) ?? "";
      const inherited = cfgInherited(key);
      return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          Select,
          {
            value,
            disabled: configScope === "repo" && noRepo,
            onChange: (v) => void saveConfig(key, v === "" ? null : v),
            options: [{ value: "", label: t("Settings_Unset") }, ...options.map((o) => ({ value: o, label: o }))]
          }
        ),
        inherited !== null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitInheritGlobal", inherited) })
      ] });
    };
    const Radio = (props) => /* @__PURE__ */ jsxRuntime.jsx("div", { className: "radio-group", children: props.options.map((o) => /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn" + (props.value === o.value ? " chosen" : ""), onClick: () => props.onChange(o.value), children: o.label }, o.value)) });
    const secCls = (id) => flash === id ? "settings-section flash" : "settings-section";
    const renderSection = (id) => {
      var _a3, _b2, _c, _d;
      switch (id) {
        case "appearance":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AppearanceSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_Theme") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.theme,
                  options: [
                    { value: "system", label: t("Settings_ThemeSystem") },
                    { value: "light", label: t("Settings_ThemeLight") },
                    { value: "dark", label: t("Settings_ThemeDark") }
                  ],
                  onChange: (v) => void patch({ theme: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_ThemePackage") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  value: s.themePackageId ?? "",
                  onChange: (v) => void patch({ themePackageId: v || null }),
                  options: [
                    { value: "", label: t("Settings_ThemeDefault") },
                    ...themes.map((tp) => {
                      var _a4;
                      const covers = (((_a4 = tp.bases) == null ? void 0 : _a4.length) ?? 1) > 1;
                      return { value: tp.id, label: covers ? tp.name : `${tp.name}（${tp.base === "dark" ? t("Settings_Dark") : t("Settings_Light")}）` };
                    })
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_Language") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.language,
                  options: [
                    { value: "system", label: t("Settings_LangSystem") },
                    { value: "en", label: "English" },
                    { value: "zh-Hans", label: "简体中文" }
                  ],
                  onChange: (v) => void patch({ language: v })
                }
              )
            ] })
          ] }, id);
        case "diff":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_DiffSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_DiffMode") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.diffMode,
                  options: [
                    { value: "sideBySide", label: t("Settings_DiffSide") },
                    { value: "inline", label: t("Settings_DiffInline") }
                  ],
                  onChange: (v) => void patch({ diffMode: v })
                }
              )
            ] })
          ] }, id);
        case "terminal":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_TerminalSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_Shell") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.terminalShell,
                  options: profiles.map((p) => ({ value: p.id, label: p.name })),
                  onChange: (v) => void patch({ terminalShell: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_TerminalFont") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", value: s.terminalFontFamily, onChange: (e) => void patch({ terminalFontFamily: e.target.value }) }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  className: "input",
                  type: "number",
                  min: 8,
                  max: 28,
                  style: { width: 70 },
                  value: s.terminalFontSize,
                  onChange: (e) => void patch({ terminalFontSize: Number(e.target.value) || 13 })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_TerminalFollowRepo") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.terminalFollowRepo, onChange: (e) => void patch({ terminalFollowRepo: e.target.checked }) })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_BashPath") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 320 }, placeholder: t("Settings_BashPathHint"), value: s.bashPath ?? "", onChange: (e) => void patch({ bashPath: e.target.value || null }) })
            ] })
          ] }, id);
        case "git":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_GitSection") }),
            cfgError && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", style: { marginBottom: 8 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: cfgError }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setCfgError(null), children: "✕" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitScope") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: configScope,
                  options: [
                    { value: "repo", label: t("Settings_GitRepoLevel") },
                    { value: "global", label: t("Settings_GitGlobalLevel") }
                  ],
                  onChange: (v) => setConfigScope(v)
                }
              ),
              configScope === "repo" && noRepo && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_NoRepoHint") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitUserName") }),
              cfgTextLabel(GIT_KEYS.userName)
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitUserEmail") }),
              cfgTextLabel(GIT_KEYS.userEmail)
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitAutoSetupRemote") }),
              cfgSelect(GIT_KEYS.autoSetupRemote, ["true", "false"]),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitAutoSetupRemoteHint") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitPullRebase") }),
              cfgSelect(GIT_KEYS.pullRebase, ["true", "false"])
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitAutocrlf") }),
              cfgSelect(GIT_KEYS.autocrlf, ["input", "true", "false"])
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { style: { paddingTop: 4 }, children: t("Settings_GitRemotes") }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, flex: 1 }, children: [
                remotes.map((r) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontFamily: "var(--mono)", fontSize: 11.5, width: 80, flex: "none" }, children: r.name }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { fontFamily: "var(--mono)", userSelect: "text", flex: 1, wordBreak: "break-all" }, children: r.url }),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "button",
                    {
                      className: "tool-btn",
                      onClick: async () => {
                        setCfgError(null);
                        try {
                          await call("remote.remove", { name: r.name });
                          await reloadGitConfig();
                        } catch (e) {
                          setCfgError(e.message);
                        }
                      },
                      children: t("Projects_Remove")
                    }
                  )
                ] }, r.name)),
                remotes.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitNoRemotes") }),
                /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 110 }, placeholder: t("Settings_GitRemoteName"), value: newRemote.name, onChange: (e) => setNewRemote((n) => ({ ...n, name: e.target.value })) }),
                  /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { flex: 1 }, placeholder: t("Settings_GitRemoteUrl"), value: newRemote.url, onChange: (e) => setNewRemote((n) => ({ ...n, url: e.target.value })) }),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "button",
                    {
                      className: "tool-btn",
                      disabled: !newRemote.name.trim() || !newRemote.url.trim() || noRepo,
                      onClick: async () => {
                        setCfgError(null);
                        try {
                          await call("remote.add", { name: newRemote.name.trim(), url: newRemote.url.trim() });
                          setNewRemote({ name: "", url: "" });
                          await reloadGitConfig();
                        } catch (e) {
                          setCfgError(e.message);
                        }
                      },
                      children: t("Settings_GitAddRemote")
                    }
                  )
                ] })
              ] })
            ] })
          ] }, id);
        case "monitor":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_MonitorSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AutoFetch") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.autoFetch, onChange: (e) => void patch({ autoFetch: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AutoFetchHint") })
            ] })
          ] }, id);
        case "editor":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_EditorSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_ExternalEditor") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 320 }, placeholder: "code --wait", value: s.externalEditor ?? "", onChange: (e) => void patch({ externalEditor: e.target.value || null }) }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "tool-btn",
                  onClick: async () => {
                    const p = await call("dialog.pickFile", { title: t("Settings_PickEditor"), filters: [{ name: "exe", ext: ["exe"] }] });
                    if (p) await patch({ externalEditor: `"${p}"` });
                  },
                  children: "…"
                }
              )
            ] })
          ] }, id);
        case "ai":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AiSection") }),
            (((_a3 = s.models) == null ? void 0 : _a3.length) ?? 0) > 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "settings-row", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AiMigrated") }) }),
            (((_b2 = s.models) == null ? void 0 : _b2.length) ?? 0) === 0 && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiProvider") }),
                /* @__PURE__ */ jsxRuntime.jsx(
                  Radio,
                  {
                    value: s.aiProvider,
                    options: [
                      { value: "off", label: t("Settings_AiOff") },
                      { value: "openai", label: "OpenAI 兼容" },
                      { value: "anthropic", label: "Anthropic" },
                      { value: "cli", label: "CLI 桥" }
                    ],
                    onChange: (v) => void patch({ aiProvider: v })
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AiProviderHint") })
              ] }),
              s.aiProvider === "openai" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: "Endpoint / Model" }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 220 }, placeholder: "https://api.xx.com/v1", value: s.aiEndpoint ?? "", onChange: (e) => void patch({ aiEndpoint: e.target.value || null }) }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 160 }, placeholder: "model", value: s.aiModel ?? "", onChange: (e) => void patch({ aiModel: e.target.value || null }) })
              ] }),
              s.aiProvider === "anthropic" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: "Endpoint / Model" }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 220 }, placeholder: "https://api.anthropic.com", value: s.aiEndpoint ?? "", onChange: (e) => void patch({ aiEndpoint: e.target.value || null }) }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 160 }, placeholder: "claude-…", value: s.aiModel ?? "", onChange: (e) => void patch({ aiModel: e.target.value || null }) })
              ] }),
              s.aiProvider === "cli" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiCliCommand") }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 320 }, placeholder: `claude -p / codex exec`, value: s.aiCliCommand ?? "", onChange: (e) => void patch({ aiCliCommand: e.target.value || null }) })
              ] }),
              (s.aiProvider === "openai" || s.aiProvider === "anthropic") && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiApiKey") }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", type: "password", style: { width: 260 }, placeholder: s.aiApiKeyProtected ? "••••••（已保存）" : "sk-…", onChange: (e) => {
                  const key = e.target.value;
                  if (key.length >= 8) void call("settings.setAiKey", { key });
                } }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AiKeyHint") })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiPrivacy") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.aiPrivacy,
                  options: [
                    { value: "metadataOnly", label: t("Settings_AiMetadata") },
                    { value: "fullDiff", label: t("Settings_AiFullDiff") },
                    { value: "disabled", label: t("Settings_AiDisabled") }
                  ],
                  onChange: (v) => void patch({ aiPrivacy: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiTrailer") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.aiAppendTrailer, onChange: (e) => void patch({ aiAppendTrailer: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "Assisted-by: Gitter" })
            ] })
          ] }, id);
        case "models":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "section-head", children: [
              /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_ModelsSection") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "tool-btn icon",
                  "data-tip": t("Settings_ModelsAddBtn"),
                  "aria-label": t("Settings_ModelsAddBtn"),
                  onClick: () => {
                    setModelEdit(null);
                    setModelAddOpen(true);
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "plus", size: 14 })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { style: { paddingTop: 4 }, children: t("Settings_ModelsProfiles") }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, flex: 1 }, children: [
                modelProfiles.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_ModelsEmpty") }),
                modelProfiles.map((m) => {
                  var _a4, _b3, _c2;
                  return m.source === "package" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }, children: [
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 12.5 }, children: m.name }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint mono", children: m.modelId }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: m.kind === "anthropic" ? "Anthropic" : "OpenAI 兼容" }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsSourcePackage") }),
                      !m.configured && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", style: { color: "var(--c-amber)", background: "transparent", border: "1px solid var(--c-amber)" }, children: t("Settings_ModelsNeedKey") }),
                      m.isDefault && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsDefault") }),
                      m.isFast && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsFast") }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
                      m.usage.turns > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint mono", children: [
                        m.usage.turns,
                        " 轮 · in ",
                        m.usage.inputTokens,
                        " / out ",
                        m.usage.outputTokens
                      ] })
                    ] }),
                    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: m.baseURL }),
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx(
                        "input",
                        {
                          className: "input",
                          type: "password",
                          style: { width: 200 },
                          placeholder: m.hasKey ? "••••••（已保存）" : m.keyHint ?? t("Settings_ModelsKeyPlaceholder"),
                          onChange: (e) => {
                            const k = e.target.value;
                            if (k.length >= 8) void call("models.setKey", { id: m.id, key: k }).then(loadModels);
                          }
                        }
                      ),
                      !m.isDefault && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("models.setDefault", { id: m.id }).then(loadModels), children: t("Settings_ModelsSetDefault") }),
                      m.isDefault && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsDefault") }),
                      !m.isFast && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("models.setFast", { id: m.id }).then(loadModels), children: t("Settings_ModelsSetFast") })
                    ] })
                  ] }, m.id) : /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }, children: [
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 12.5 }, children: m.name }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: m.kind === "anthropic" ? "Anthropic" : "OpenAI 兼容" }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsSourceUser") }),
                      !m.configured && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", style: { color: "var(--c-amber)", background: "transparent", border: "1px solid var(--c-amber)" }, children: t("Settings_ModelsNeedKey") }),
                      m.isDefault && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chip", title: defaultMemberName(m, (s == null ? void 0 : s.defaultModelId) ?? null) ?? void 0, children: [
                        t("Settings_ModelsDefault"),
                        (((_a4 = m.groupModels) == null ? void 0 : _a4.length) ?? 1) > 1 ? `：${defaultMemberName(m, (s == null ? void 0 : s.defaultModelId) ?? null)}` : ""
                      ] }),
                      m.isFast && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsFast") }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsCount", ((_b3 = m.groupModels) == null ? void 0 : _b3.length) ?? 1) }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
                      m.usage.turns > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint mono", children: [
                        m.usage.turns,
                        " 轮 · in ",
                        m.usage.inputTokens,
                        " / out ",
                        m.usage.outputTokens
                      ] })
                    ] }),
                    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: m.baseURL }),
                    /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }, children: (m.groupModels ?? [{ modelId: m.modelId, vision: false, thinking: m.thinking ?? "medium" }]).map((g) => /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip mono", title: [g.vision ? t("Settings_ModelsVision") : null, g.contextTokens ? `${g.contextTokens} tokens` : null].filter(Boolean).join(" · ") || void 0, children: g.modelId }, g.modelId)) }),
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx(
                        "input",
                        {
                          className: "input",
                          type: "password",
                          style: { width: 200 },
                          placeholder: m.hasKey ? "••••••（已保存）" : t("Settings_ModelsKeyPlaceholder"),
                          onChange: (e) => {
                            const k = e.target.value;
                            if (k.length >= 8) void call("models.setKey", { id: m.id, key: k }).then(loadModels);
                          }
                        }
                      ),
                      (((_c2 = m.groupModels) == null ? void 0 : _c2.length) ?? 1) > 1 ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                        /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "tool-btn", onClick: () => setDefaultPickFor(defaultPickFor === m.id ? null : m.id), children: [
                          t("Settings_ModelsSetDefault"),
                          "…"
                        ] }),
                        defaultPickFor === m.id && /* @__PURE__ */ jsxRuntime.jsx("span", { style: { display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }, children: (m.groupModels ?? []).map((g, i) => {
                          const ref = i === 0 ? m.id : `${m.groupId}#${g.modelId}`;
                          const isCur = (s == null ? void 0 : s.defaultModelId) === ref;
                          return /* @__PURE__ */ jsxRuntime.jsxs(
                            "button",
                            {
                              className: "tool-btn" + (isCur ? " primary" : ""),
                              title: g.modelId,
                              onClick: () => void call("models.setDefault", { id: ref }).then(() => {
                                setDefaultPickFor(null);
                                return Promise.all([loadModels(), call("settings.get").then(applySettings)]);
                              }),
                              children: [
                                g.modelId,
                                isCur ? " ✓" : ""
                              ]
                            },
                            g.modelId
                          );
                        }) })
                      ] }) : !m.isDefault && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("models.setDefault", { id: m.id }).then(loadModels), children: t("Settings_ModelsSetDefault") }),
                      !m.isFast && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("models.setFast", { id: m.id }).then(loadModels), children: t("Settings_ModelsSetFast") }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
                      /* @__PURE__ */ jsxRuntime.jsx(
                        "button",
                        {
                          className: "tool-btn icon",
                          "data-tip": t("Settings_ModelsEditBtn"),
                          "aria-label": t("Settings_ModelsEditBtn"),
                          onClick: () => {
                            setModelEdit(m);
                            setModelAddOpen(true);
                          },
                          children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "pencil", size: 13 })
                        }
                      ),
                      /* @__PURE__ */ jsxRuntime.jsx(
                        "button",
                        {
                          className: "tool-btn icon danger",
                          "data-tip": t("Settings_ModelsDelete"),
                          "aria-label": t("Settings_ModelsDelete"),
                          onClick: () => void call("models.delete", { id: m.id }).then(loadModels),
                          children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "trash", size: 13 })
                        }
                      )
                    ] })
                  ] }, m.id);
                }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_ModelsHint") })
              ] })
            ] }),
            modelAddOpen && /* @__PURE__ */ jsxRuntime.jsx(
              AddModelDialog,
              {
                edit: modelEdit ?? void 0,
                onClose: () => setModelAddOpen(false),
                onSaved: () => {
                  setModelAddOpen(false);
                  void loadModels();
                }
              }
            )
          ] }, id);
        case "safety":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_SafetyNetSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_SafetyNet") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.safetyNet,
                  options: [
                    { value: "off", label: t("Settings_SafetyOff") },
                    { value: "warn", label: t("Settings_SafetyWarn") },
                    { value: "block", label: t("Settings_SafetyBlock") }
                  ],
                  onChange: (v) => void patch({ safetyNet: v })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_SafetyNetHint") })
            ] })
          ] }, id);
        case "agent":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AgentSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AgentCheckpoint") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.agentsCheckpoint, onChange: (e) => void patch({ agentsCheckpoint: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AgentCheckpointHint") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AgentOnExit") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.agentsOnExit,
                  options: [
                    { value: "terminate", label: t("Settings_AgentOnExitTerminate") },
                    { value: "keep", label: t("Settings_AgentOnExitKeep") }
                  ],
                  onChange: (v) => void patch({ agentsOnExit: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "上下文压缩" }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.agentsCompaction ?? "auto",
                  options: [
                    { value: "auto", label: "自动（80% 阈值）" },
                    { value: "manual", label: "仅 /compact" },
                    { value: "off", label: "关闭" }
                  ],
                  onChange: (v) => void patch({ agentsCompaction: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "压缩调参" }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
                "阈值",
                /* @__PURE__ */ jsxRuntime.jsx(
                  "input",
                  {
                    className: "input",
                    style: { width: 70, marginLeft: 4 },
                    type: "number",
                    min: 50,
                    max: 95,
                    value: Math.round((((_c = s.agentsCompactionPolicy) == null ? void 0 : _c.threshold) ?? 0.8) * 100),
                    onChange: (e) => {
                      const v = Math.min(95, Math.max(50, Number(e.target.value) || 80)) / 100;
                      void patch({ agentsCompactionPolicy: { ...s.agentsCompactionPolicy ?? {}, threshold: v } });
                    }
                  }
                ),
                "% · 保留最近",
                /* @__PURE__ */ jsxRuntime.jsx(
                  "input",
                  {
                    className: "input",
                    style: { width: 70, marginLeft: 4 },
                    type: "number",
                    min: 4,
                    max: 32,
                    value: ((_d = s.agentsCompactionPolicy) == null ? void 0 : _d.keepLast) ?? 8,
                    onChange: (e) => {
                      const v = Math.min(32, Math.max(4, Number(e.target.value) || 8));
                      void patch({ agentsCompactionPolicy: { ...s.agentsCompactionPolicy ?? {}, keepLast: v } });
                    }
                  }
                ),
                "条"
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "轮末钩子" }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.agentsPostTurnHooks ?? true, onChange: (e) => void patch({ agentsPostTurnHooks: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "插件 post-turn 钩子产物以 system-reminder 注入下一轮" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "完成通知" }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.agentsNotify ?? true, onChange: (e) => void patch({ agentsNotify: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "任务完成/失败时弹系统通知（窗口聚焦时静默）" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "子代理并发上限" }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  className: "input",
                  style: { width: 80 },
                  type: "number",
                  min: 1,
                  max: 6,
                  value: s.agentsMaxSubagents ?? 3,
                  onChange: (e) => void patch({ agentsMaxSubagents: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "MCP 工具入循环" }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  type: "checkbox",
                  checked: s.agentsExternalMcpTools ?? false,
                  onChange: (e) => void patch({ agentsExternalMcpTools: e.target.checked })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "允许 agent 调用包声明的 MCP server 工具（每次调用都需授权确认）" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx(AgentRulesEditor, { rules: s.agentRules ?? [], onChange: (rules) => void patch({ agentRules: rules }) }),
            /* @__PURE__ */ jsxRuntime.jsx(SeamsAuditView, {})
          ] }, id);
        case "mcp":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_McpSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_McpEnabled") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.mcpEnabled, onChange: (e) => void patch({ mcpEnabled: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_McpHint") })
            ] })
          ] }, id);
        case "extensions":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_ExtensionsSection") }),
            extError && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", style: { marginBottom: 8 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: extError }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setExtError(null), children: "✕" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { style: { paddingTop: 4 }, children: t("Settings_ExtensionsSection") }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, flex: 1 }, children: [
                /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
                  /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "input",
                      {
                        type: "checkbox",
                        checked: s.allowCodePlugins,
                        onChange: (e) => void patch({ allowCodePlugins: e.target.checked })
                      }
                    ),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Ext_AllowCodePlugins") }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Ext_AllowCodePluginsHint") })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "input",
                      {
                        type: "checkbox",
                        checked: s.externalMcpEnabled,
                        onChange: (e) => void patch({ externalMcpEnabled: e.target.checked })
                      }
                    ),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Ext_ExternalMcp") }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Ext_ExternalMcpHint") })
                  ] })
                ] }),
                /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
                  /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Extensions_Import"), onClick: () => void importGpk(), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "input",
                    {
                      className: "input",
                      style: { width: 260 },
                      placeholder: "https://…/pack.gpk（目录安装）",
                      value: catalogUrl,
                      onChange: (e) => setCatalogUrl(e.target.value)
                    }
                  ),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "button",
                    {
                      className: "tool-btn",
                      disabled: !catalogUrl.trim().startsWith("http"),
                      onClick: async () => {
                        setExtError(null);
                        try {
                          const r = await call("extensions.installFromCatalog", { url: catalogUrl.trim() });
                          if (r) await refreshExts(r);
                          setCatalogUrl("");
                        } catch (e) {
                          setExtError(e.message);
                        }
                      },
                      children: t("Extensions_InstallFromUrl")
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", margin: "6px 0" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "视图" }),
                  /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: extView === "tree" ? { borderColor: "var(--c-text)", color: "var(--c-text)" } : void 0, onClick: () => setExtView("tree"), children: "树状（按页面挂载）" }),
                  /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", style: extView === "kind" ? { borderColor: "var(--c-text)", color: "var(--c-text)" } : void 0, onClick: () => setExtView("kind"), children: "类型分组" })
                ] }),
                exts.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Extensions_Empty") }),
                extView === "tree" ? (
                  /* 插件挂载树：页面（槽位）→ 页面提供者 / 挂载其下的插件（agent UI 渲染器、
                     输入台 provider、会话命令、同槽位替补）→ 贡献明细；非页面级包归入全局分支。 */
                  extMountTree()
                ) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                  KIND_SECTIONS.map(({ kind, label }) => {
                    const group = exts.filter((p) => primaryKindOf(p) === kind).sort((a, b) => a.name.localeCompare(b.name));
                    if (group.length === 0) return null;
                    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: 10 }, children: [
                      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }, children: [
                        label,
                        " ",
                        /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
                          "（",
                          group.length,
                          "）"
                        ] })
                      ] }),
                      group.map((p) => renderExtCard(p))
                    ] }, kind);
                  }),
                  (() => {
                    const known = new Set(KIND_SECTIONS.map((x) => x.kind));
                    const others = exts.filter((p) => !known.has(primaryKindOf(p)));
                    if (others.length === 0) return null;
                    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: 10 }, children: [
                      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }, children: [
                        "其他（",
                        others.length,
                        "）"
                      ] }),
                      others.map((p) => renderExtCard(p))
                    ] });
                  })()
                ] })
              ] })
            ] })
          ] }, id);
        case "about":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AboutSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "Gitter" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "v0.1.0 · Electron 全栈（winui3-to-web-migration.md）" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "git" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { fontFamily: "var(--mono)" }, children: gitVersion })
            ] })
          ] }, id);
      }
    };
    const catTitle = (c) => t(CATEGORIES.find((x) => x.id === c).titleKey);
    const matchedSections = [...new Set(matches.map((m) => m.section))];
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "toolbar", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "settings-page-title", children: t("Nav_Settings") }) }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-layout", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-nav", children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "input",
              style: { width: "100%", flex: "none" },
              placeholder: t("Settings_Search"),
              value: query,
              onChange: (e) => setQuery(e.target.value)
            }
          ),
          !q && CATEGORIES.map((c) => /* @__PURE__ */ jsxRuntime.jsxs(
            "button",
            {
              className: "settings-cat" + (cat === c.id ? " active" : ""),
              onClick: () => setCat(c.id),
              title: t(c.titleKey),
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ic", children: /* @__PURE__ */ jsxRuntime.jsx(NavIcon, { glyph: c.glyph, svg: c.svg }) }),
                t(c.titleKey)
              ]
            },
            c.id
          )),
          q && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
            matchedSections.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "hint", style: { padding: "6px 4px" }, children: t("Settings_NoResults") }),
            matchedSections.map((sid) => {
              const sec = SECTIONS.find((x) => x.id === sid);
              return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card", style: { padding: "8px 10px" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("div", { className: "search-result-cat", children: catTitle(sec.cat) }),
                /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 12.5, color: "var(--c-text)", marginBottom: 4 }, children: t(sec.titleKey) }),
                matches.filter((m) => m.section === sid).map((m, i) => /* @__PURE__ */ jsxRuntime.jsx("div", { className: "search-result-item", onClick: () => gotoSection(sid), children: t(m.labelKey) }, i))
              ] }, sid);
            })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "settings-content", children: SECTIONS.filter((x) => x.cat === cat).map((x) => renderSection(x.id)) })
      ] })
    ] });
  }
  const AGENT_RULE_TOOLS = [
    "terminal_run",
    "terminal_poll",
    "git_stage",
    "git_commit",
    "git_push",
    "file_write",
    "file_patch",
    "task"
  ];
  function AgentRulesEditor(props) {
    const { rules, onChange } = props;
    const [tool, setTool] = react.useState("terminal_run");
    const [pattern, setPattern] = react.useState("");
    const [effect, setEffect] = react.useState("allow");
    const add = () => {
      const rule = {
        id: `rule-${Date.now().toString(36)}`,
        tool,
        pattern: pattern.trim() ? pattern.trim() : null,
        effect,
        scope: "global",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      onChange([...rules, rule]);
      setPattern("");
    };
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", style: { alignItems: "flex-start" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx("label", { style: { paddingTop: 4 }, children: "权限规则" }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, flex: 1 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "hint", children: "deny 优先于 allow；pattern 为空 = 工具全量，否则为命令/参数前缀。agent 执行时先查本表，再走分级授权卡。" }),
        rules.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "hint", children: "（暂无规则）" }),
        rules.map((r) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", fontSize: 12 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", style: { color: r.effect === "deny" ? "var(--c-red)" : "var(--c-green)", fontSize: 10.5 }, children: r.effect === "deny" ? "拒绝" : "允许" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: r.tool }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "card-path", style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: r.pattern === null || r.pattern === "" ? "（全量）" : `前缀：${r.pattern}` }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => onChange(rules.filter((x) => x.id !== r.id)), children: "删除" })
        ] }, r.id)),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            Select,
            {
              style: { width: 150 },
              value: tool,
              onChange: (v) => setTool(v),
              options: AGENT_RULE_TOOLS.map((x) => ({ value: x, label: x }))
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx(
            Select,
            {
              style: { width: 90 },
              value: effect,
              onChange: (v) => setEffect(v),
              options: [{ value: "allow", label: "允许" }, { value: "deny", label: "拒绝" }]
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { flex: 1 }, placeholder: "前缀（空 = 工具全量），如 npm test", value: pattern, onChange: (e) => setPattern(e.target.value) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", disabled: !!rules.find((r) => r.tool === tool && r.effect === effect && (r.pattern ?? "") === (pattern.trim() || null)), onClick: add, children: "添加" })
        ] })
      ] })
    ] });
  }
  function SeamsAuditView() {
    const { call: call2 } = pageSdk;
    const [audit, setAudit] = react.useState(null);
    const refresh = react.useCallback(() => {
      void call2("agent.seams.audit").then(setAudit).catch(() => {
      });
    }, [call2]);
    react.useEffect(() => {
      refresh();
      const iv = setInterval(refresh, 1e4);
      return () => clearInterval(iv);
    }, [refresh]);
    if (!audit) return null;
    const group = (items, label) => items.length > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: 6 }, children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: label }),
      items.map((it) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11.5, display: "flex", gap: 6 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: it.id }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "card-path", children: it.extra })
      ] }, it.id))
    ] }) : null;
    return /* @__PURE__ */ jsxRuntime.jsxs("details", { className: "settings-row", style: { display: "block" }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("summary", { className: "card-path", style: { cursor: "pointer" }, children: [
        "贡献审计（段 ",
        audit.sections.length,
        " · 采集器 ",
        audit.collectors.length,
        " · 钩子 ",
        audit.hooks.length,
        " · 压缩器 ",
        audit.compactors.length,
        " · 子代理预设 ",
        audit.presets.length,
        "）"
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginTop: 8, border: "1px solid var(--c-border)", borderRadius: 8, padding: 10, maxHeight: 280, overflowY: "auto" }, children: [
        group(audit.sections.map((x) => ({ id: x.id, extra: `${x.slot} · order ${x.order} · ${x.source}${x.chars ? ` · ${x.chars}字` : ""}` })), "提示词段"),
        group(audit.collectors.map((x) => ({ id: x.id, extra: `order ${x.order} · ${x.tokenBudget} tokens · ${x.source}` })), "上下文采集器"),
        group(audit.hooks.map((x) => ({ id: x.id, extra: `order ${x.order} · ${x.source}` })), "turn 钩子"),
        group(audit.compactors.map((x) => ({ id: x.id, extra: x.source })), "压缩器"),
        group(audit.presets.map((x) => ({ id: x.id, extra: `${x.readonly ? "只读" : "可写"} · ${x.tools ? x.tools.length + " 工具" : "全集"}` })), "子代理预设")
      ] })
    ] });
  }
  const THINKING_LEVELS = ["medium", "high", "low", "off"];
  const THINKING_LABEL = {
    medium: "Agents_ThinkingMedium",
    high: "Agents_ThinkingHigh",
    low: "Agents_ThinkingLow",
    off: "Agents_ThinkingOff"
  };
  function parseTokens(text) {
    const n = Number(text.replace(/[,\s]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  function defaultMemberName(m, defaultModelId) {
    var _a2, _b2;
    if (!m.isDefault) return null;
    if (defaultModelId && defaultModelId.startsWith(`${m.groupId}#`)) {
      return defaultModelId.slice(m.groupId.length + 1);
    }
    return ((_b2 = (_a2 = m.groupModels) == null ? void 0 : _a2[0]) == null ? void 0 : _b2.modelId) ?? m.modelId;
  }
  function ctxSource(r) {
    if (r.entry.contextTokens == null) return t("Settings_ModelsContextUnknown");
    if (r.entry.contextHint) return t("Settings_ModelsContextGuess");
    return t("Settings_ModelsContextFromApi");
  }
  function AddModelDialog(props) {
    const edit = props.edit;
    const [kind, setKind] = react.useState((edit == null ? void 0 : edit.kind) ?? "openai-compatible");
    const [name, setName] = react.useState((edit == null ? void 0 : edit.name) ?? "");
    const [baseURL, setBaseURL] = react.useState((edit == null ? void 0 : edit.baseURL) ?? "");
    const [apiKey, setApiKey] = react.useState("");
    const [status, setStatus] = react.useState("idle");
    const [error, setError] = react.useState(null);
    const [note, setNote] = react.useState(null);
    const [rows, setRows] = react.useState(
      () => edit ? (
        // 编辑：已配置成员直接成行（无需探测即可改配/增删）
        (edit.groupModels ?? [{ modelId: edit.modelId, vision: edit.capabilities.vision ?? false, contextTokens: edit.capabilities.contextTokens, thinking: edit.thinking ?? "medium" }]).map((g) => ({
          entry: { id: g.modelId, name: g.modelId, contextTokens: g.contextTokens ?? null, image: null, imageGuess: g.vision, contextHint: null },
          checked: true,
          visionEnabled: true,
          vision: g.vision,
          contextTokens: g.contextTokens ? String(g.contextTokens) : "",
          thinking: g.thinking
        }))
      ) : []
    );
    const [filter, setFilter] = react.useState("");
    const [saving, setSaving] = react.useState(false);
    const [savedMsg, setSavedMsg] = react.useState(null);
    const discover = async () => {
      if (!baseURL.trim()) return;
      setStatus("loading");
      setError(null);
      setNote(null);
      try {
        const r = await call(
          "models.discover",
          // 编辑模式密钥留空 → 后端取该分组已保存的密钥探测
          { kind, baseURL, apiKey: apiKey || void 0, profileId: edit == null ? void 0 : edit.id }
        );
        if (r.error) {
          setStatus("error");
          setError(r.error);
          return;
        }
        if (r.models.length === 0) {
          setStatus("error");
          setError(t("Settings_ModelsEmptyResult"));
          return;
        }
        setRows((prev) => {
          const kept = new Map(prev.filter((x) => x.checked).map((x) => [x.entry.id, x]));
          return r.models.map((entry) => {
            const old = kept.get(entry.id);
            return {
              entry,
              checked: !!old,
              // 端点显式声明"无图片模态" → 视觉置灰不可选；未声明 → 取名称启发式默认
              visionEnabled: entry.image !== false,
              vision: old ? old.vision : entry.image === true ? true : entry.image === null ? entry.imageGuess : false,
              contextTokens: (old == null ? void 0 : old.contextTokens) ?? (entry.contextTokens ? String(entry.contextTokens) : ""),
              thinking: (old == null ? void 0 : old.thinking) ?? "medium"
            };
          });
        });
        setStatus("idle");
        setNote(r.probesTruncated ? `${t("Settings_ModelsProbesLimited", 12)}；${kind === "anthropic" ? t("Settings_ModelsAnthropicNote") : t("Settings_ModelsNoCard")}` : kind === "anthropic" ? t("Settings_ModelsAnthropicNote") : t("Settings_ModelsNoCard"));
      } catch (e) {
        setStatus("error");
        setError(e.message);
      }
    };
    const patchRow = (id, patch) => setRows((rs) => rs.map((r) => r.entry.id === id ? { ...r, ...patch } : r));
    const filtered = react.useMemo(() => {
      const q = filter.trim().toLowerCase();
      return q ? rows.filter((r) => r.entry.id.toLowerCase().includes(q)) : rows;
    }, [rows, filter]);
    const checkedCount = rows.filter((r) => r.checked).length;
    const allChecked = rows.length > 0 && checkedCount === rows.length;
    const setChecked = (id, on) => setRows((rs) => rs.map((r) => {
      if (r.entry.id !== id || r.checked === on) return r;
      return {
        ...r,
        checked: on,
        contextTokens: r.entry.contextTokens ? String(r.entry.contextTokens) : "",
        vision: r.entry.image === true ? true : r.entry.image === null ? r.entry.imageGuess : false
      };
    }));
    const selectAll = (on) => setRows((rs) => rs.map((r) => ({ ...r, checked: on })));
    const saveAll = async () => {
      const chosen = rows.filter((r) => r.checked);
      if (chosen.length === 0 || !name.trim() || !baseURL.trim() || saving) return;
      setSaving(true);
      setSavedMsg(null);
      try {
        await call("models.save", {
          profile: {
            id: edit == null ? void 0 : edit.id,
            name: name.trim(),
            kind,
            baseURL: baseURL.trim(),
            models: chosen.map((r) => ({
              modelId: r.entry.id,
              vision: r.vision,
              contextTokens: parseTokens(r.contextTokens) ?? void 0,
              thinking: r.thinking
            }))
          },
          apiKey: apiKey.length >= 8 ? apiKey : void 0
        });
        setSavedMsg(t("Settings_ModelsSaved", chosen.length));
        void call("settings.get").then(applySettings).catch(() => {
        });
        props.onSaved();
      } catch (e) {
        setSavedMsg(null);
        setError(`${t("Settings_ModelsTestFail")}: ${e.message}`);
      } finally {
        setSaving(false);
      }
    };
    const placeholder = kind === "anthropic" ? "https://api.anthropic.com" : "https://api.deepseek.com/v1（或 OpenRouter /v1、Ollama http://127.0.0.1:11434/v1）";
    return /* @__PURE__ */ jsxRuntime.jsxs(
      Modal,
      {
        title: edit ? t("Settings_ModelsEditTitle") : t("Settings_ModelsAddTitle"),
        confirmText: saving ? "…" : t("Settings_ModelsSaveSelected", checkedCount),
        confirmDisabled: checkedCount === 0 || !name.trim() || !baseURL.trim() || saving,
        onClose: props.onClose,
        onConfirm: () => void saveAll(),
        className: "model-add",
        cancelContent: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "x", size: 13 }),
        confirmContent: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "check", size: 13 }),
        titleAside: /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          status === "loading" ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsDiscovering") }) : rows.length > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chip", children: [
            t("Settings_ModelsFound", rows.length),
            " · ",
            t("Settings_ModelsChecked", checkedCount)
          ] }) : null,
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn icon sm",
              "data-tip": t("Common_Close"),
              "aria-label": t("Common_Close"),
              onClick: props.onClose,
              children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "x", size: 13 })
            }
          )
        ] }),
        children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-form", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_ModelsAddHint") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-grid", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_ModelsNameFor") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  className: "input",
                  style: { height: 30 },
                  placeholder: t("Settings_ModelsNamePlaceholder"),
                  value: name,
                  onChange: (e) => setName(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-grid", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_ModelsType") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  value: kind,
                  onChange: (v) => {
                    setKind(v);
                    setRows([]);
                    setStatus("idle");
                    setError(null);
                    setNote(null);
                  },
                  options: [{ value: "openai-compatible", label: "OpenAI 兼容（/v1/models）" }, { value: "anthropic", label: "Anthropic（/v1/models）" }]
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-grid", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "API URL" }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  className: "input",
                  style: { height: 30 },
                  placeholder,
                  value: baseURL,
                  onChange: (e) => setBaseURL(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-grid", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_ModelsApiKey") }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8 }, children: [
                /* @__PURE__ */ jsxRuntime.jsx(
                  "input",
                  {
                    className: "input",
                    type: "password",
                    style: { flex: 1, height: 30, minWidth: 0 },
                    placeholder: (edit == null ? void 0 : edit.hasKey) ? t("Settings_ModelsKeyKept") : "sk-…",
                    value: apiKey,
                    onChange: (e) => setApiKey(e.target.value)
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx(
                  "button",
                  {
                    className: "tool-btn icon",
                    "data-tip": t("Settings_ModelsDiscover"),
                    "aria-label": t("Settings_ModelsDiscover"),
                    disabled: status === "loading" || !baseURL.trim(),
                    onClick: () => void discover(),
                    children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "search", size: 13 })
                  }
                )
              ] })
            ] }),
            error && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-conn-err", children: [
              "✕ ",
              error
            ] }),
            note && status !== "loading" && !error && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ma-conn-note", children: note })
          ] }),
          rows.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  className: "input",
                  style: { flex: 1, height: 30 },
                  placeholder: t("Settings_ModelsSearchFilter"),
                  value: filter,
                  onChange: (e) => setFilter(e.target.value)
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => selectAll(!allChecked), children: allChecked ? t("Settings_ModelsUnselectAll") : t("Settings_ModelsSelectAll") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-list-head", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", {}),
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "Model ID" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { title: t("Settings_ModelsContextUnit"), children: t("Settings_ModelsContext") }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { title: t("Settings_ModelsVisionHint"), children: t("Settings_ModelsVision") }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { title: t("Settings_ModelsThinkingHint"), children: t("Settings_ModelsThinking") })
            ] }),
            filtered.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ma-none hint", children: t("Settings_ModelsNoMatch") }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ma-list", children: filtered.map((r) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-row" + (r.checked ? " checked" : ""), children: [
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: r.checked, onChange: (e) => setChecked(r.entry.id, e.target.checked) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ma-cell", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", title: r.entry.id, children: r.entry.id }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ma-cell", children: /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  className: "input",
                  style: { flex: 1, height: 26, minWidth: 0 },
                  placeholder: t("Settings_ModelsContextPlaceholder"),
                  value: r.contextTokens,
                  disabled: !r.checked,
                  title: ctxSource(r),
                  onChange: (e) => patchRow(r.entry.id, { contextTokens: e.target.value.replace(/[^\d,]/g, "") })
                }
              ) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ma-cell", children: /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  type: "checkbox",
                  checked: r.vision && r.checked,
                  disabled: !r.visionEnabled || !r.checked,
                  title: r.visionEnabled ? r.entry.image === true ? t("Settings_ModelsVisionFromApi") : t("Settings_ModelsVisionInferred") : t("Settings_ModelsVisionOff"),
                  onChange: (e) => patchRow(r.entry.id, { vision: e.target.checked })
                }
              ) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ma-cell", children: /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  value: r.thinking,
                  style: { width: "100%", maxWidth: 92 },
                  disabled: !r.checked,
                  title: t("Settings_ModelsThinkingHint"),
                  options: THINKING_LEVELS.map((v) => ({ value: v, label: t(THINKING_LABEL[v]) })),
                  onChange: (v) => patchRow(r.entry.id, { thinking: v })
                }
              ) })
            ] }, r.entry.id)) }),
            savedMsg && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ma-conn-ok", children: [
              "✓ ",
              savedMsg
            ] })
          ] })
        ]
      }
    );
  }
  window.GITTER_UI.registerPage({ id: "settings" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "settings",
        children: React.createElement(SettingsPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
