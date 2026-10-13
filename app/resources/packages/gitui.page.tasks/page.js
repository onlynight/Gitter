(function(jsxRuntime, react, reactDom) {
  "use strict";
  var _a, _b;
  function U$1() {
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
      const g = U$1();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    on: (method, cb) => U$1().on(method, cb),
    t: (key, ...args) => U$1().t(key, ...args),
    navigate: (page) => U$1().navigate(page),
    taskPanels: () => [],
    requestFileFocus: (path) => U$1().requestFileFocus(path),
    openSettings: (section) => U$1().openSettings(section),
    toast: (title, body) => U$1().toast(title, body),
    refresh: () => U$1().refresh(),
    notifyRepoChanged: () => U$1().notifyRepoChanged(),
    repo: () => U$1().repo(),
    pathForFile: (file) => {
      try {
        return U$1().pathForFile(file);
      } catch {
        return "";
      }
    },
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
    extTree: () => U$1().extTree(),
    registerDoc: (def) => U$1().registerDoc(def),
    docs: () => U$1().docs(),
    onDocsChanged: (cb) => U$1().onDocsChanged(cb),
    docsVersion: () => U$1().docsVersion()
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
  function taskPanels() {
    return U().taskPanels();
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
    // 向下箭头（取消暂存/拉取）——up 的镜像
    down: "M8 13.5 4 9.5h2.25V5h3.5v4.5H12L8 13.5ZM3 1.5h10V3H3v-1.5Z",
    // 同步循环箭头（抓取/fetch）
    sync: "M8 3a5 5 0 0 1 4.6 3.04l-1.36.55A3.5 3.5 0 0 0 4.6 6.9L6.2 8.5H1.5V3.8l1.7 1.7A5 5 0 0 1 8 3Zm6.5 4.5v4.7l-1.7-1.7A5 5 0 0 1 3.4 9.96l1.36-.55A3.5 3.5 0 0 0 11.4 9.1L9.8 7.5h4.7Z",
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
    // 归档（Octicons archive-16 改绘：整体下移 0.5 使墨迹中心 = 视框中心 8——原路径上留白 1px/下留白 2px 视觉偏高）
    archive: "M0 3.25C0 2.284.784 1.5 1.75 1.5h12.5c.966 0 1.75.784 1.75 1.75v1.5A1.75 1.75 0 0 1 14.25 6.5H14v6.25A1.75 1.75 0 0 1 12.25 14.5h-8.5A1.75 1.75 0 0 1 2 12.75V6.5h-.25A1.75 1.75 0 0 1 0 4.75v-1.5ZM3.5 6.5v6.25c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6.5h-9ZM1.75 3a.25.25 0 0 0-.25.25v1.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-1.5a.25.25 0 0 0-.25-.25H1.75ZM6.25 8.5h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z",
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
    "check": "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z",
    // 复制（Octicons copy-16：双叠方块）
    "copy": "M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z",
    // 分屏（分栏切换钮，VS Code 布局钮同型）：左右两个圆角栏
    // 分屏（VS Code split-editor 同构：外框 + 中缝，左右栏挖孔）
    "splitpane": "M2 3h12v10H2V3Zm1 1v8h4.5V4H3Zm5.5 0v8H13V4H8.5Z",
    // 灯泡（思考深度；Octicons light-bulb-16 改绘）——密齿 gear 缩到 13px 糊成一团（v3 设计稿 task-page-v3-mockup）
    "bulb": "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319a8.456 8.456 0 0 0-.542.68c-.207.3-.33.565-.37.847a.75.75 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z",
    // 排序（Octicons arrow-up-down-16）：列表工具条排序下拉（task-page-wrapup-and-list-design.md v3.4）
    "sort": "M4.25 3.5a.75.75 0 0 1 .75.75v7.44l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l1.72 1.72V4.25a.75.75 0 0 1 .75-.75Zm7.5 9a.75.75 0 0 1-.75-.75V4.31L9.28 6.03a.75.75 0 0 1-1.06-1.06l3-3a.75.75 0 0 1 1.06 0l3 3a.75.75 0 1 1-1.06 1.06l-1.72-1.72v7.44a.75.75 0 0 1-.75.75Z",
    // 筛选漏斗（Octicons filter-16 改绘：整体上移 1.25 使墨迹中心 = 视框中心 8，与排序/归档钮对齐）
    "filter": "M.75 1.75h14.5a.75.75 0 0 1 .587 1.219L10.5 9.25v4.25a.75.75 0 0 1-.908.733l-3.5-.875A.75.75 0 0 1 5.5 12.25v-3L.163 2.97A.75.75 0 0 1 .75 1.75Zm1.7 1.5L7 8.495v3.63l2 .5V8.495l4.55-5.245H2.45Z"
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
  function api() {
    if (!window.gitter) {
      return {
        invoke: async () => ({ ok: false, error: { message: "不在 Electron 宿主内（桥不可用）" } }),
        onEvent: () => () => {
        },
        winAction: () => {
        },
        isMaximized: async () => false
      };
    }
    return window.gitter;
  }
  class BridgeCallError extends Error {
    constructor(message, detail) {
      super(message);
      this.detail = detail;
    }
  }
  async function call$1(method, params) {
    const res = await api().invoke(method, params);
    if (!res.ok) throw new BridgeCallError(res.error.message, res.error.detail);
    return res.data;
  }
  const listeners = /* @__PURE__ */ new Set();
  let subscribed = false;
  function ensureSubscribe() {
    if (subscribed) return;
    subscribed = true;
    api().onEvent((method, params) => {
      for (const fn of listeners) {
        try {
          fn(method, params);
        } catch {
        }
      }
    });
  }
  function onEvent$1(method, cb) {
    ensureSubscribe();
    const fn = (m, p) => {
      if (m === method) cb(p);
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
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
  K().Select;
  K().ReflogDialog;
  K().ScrollArea;
  const MD_EXTS = [".md", ".markdown"];
  const HTML_EXTS = [".html", ".htm"];
  function isMdPath(p) {
    const i = p.lastIndexOf(".");
    return i >= 0 && MD_EXTS.includes(p.slice(i).toLowerCase());
  }
  function isHtmlPath(p) {
    const i = p.lastIndexOf(".");
    return i >= 0 && HTML_EXTS.includes(p.slice(i).toLowerCase());
  }
  function isExternalPreviewPath(p) {
    return isMdPath(p) || isHtmlPath(p);
  }
  function isProviderResult(r) {
    return !!r && typeof r.kind === "string" && typeof r.content === "string";
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function runsToHtml(line, runs, colors) {
    let out = "";
    let pos = 0;
    for (const r of runs) {
      if (r.start > pos) out += escapeHtml(line.slice(pos, r.start));
      const seg = escapeHtml(line.slice(r.start, r.end));
      const color = r.color ?? colors[r.style];
      out += color ? `<span style="color:${color}">${seg}</span>` : seg;
      pos = r.end;
    }
    if (pos < line.length) out += escapeHtml(line.slice(pos));
    return out;
  }
  async function injectCodeHighlight(html) {
    if (!html.includes("<code")) return html;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const codes = [...doc.querySelectorAll("pre > code")];
    if (codes.length === 0) return html;
    const results = await Promise.all(codes.map(async (el) => {
      var _a2;
      const lang = ((_a2 = /language-([\w+#.-]+)/.exec(el.className)) == null ? void 0 : _a2[1]) ?? null;
      if (!lang) return null;
      const code = el.textContent ?? "";
      if (!code.trim()) return null;
      try {
        const r = await call$1(
          "highlight.snippet",
          { code, lang }
        );
        if (!r || r.lines.length === 0) return null;
        const htmlLines = code.split("\n").map((line, i) => runsToHtml(line, r.lines[i] ?? [], r.syntaxColors));
        return { el, html: htmlLines.join("\n") };
      } catch {
        return null;
      }
    }));
    let changed = false;
    for (const res of results) {
      if (!res) continue;
      res.el.innerHTML = res.html;
      changed = true;
    }
    return changed ? doc.body.innerHTML : html;
  }
  function mdSrcdoc(html, dark) {
    const c = dark ? { bg: "#14161B", fg: "#D4D4D4", fg2: "#A8B0BC", border: "#FFFFFF21", thumb: "#FFFFFF40", thumbHover: "#FFFFFF59", codeBg: "#FFFFFF12", link: "#6BABF5" } : { bg: "#FFFFFF", fg: "#1B1B1B", fg2: "#5C5C5C", border: "#E5E5E5", thumb: "#C9C9CE", thumbHover: "#AFAFB5", codeBg: "#F2F2F3", link: "#0B6BCB" };
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { background: ${c.bg}; }
body { margin: 0; padding: 28px 34px 48px; font: 14px/1.75 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; color: ${c.fg}; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${c.thumb}; border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: ${c.thumbHover}; background-clip: content-box; }
h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.4em 0 .55em; }
h1, h2 { border-bottom: 1px solid ${c.border}; padding-bottom: .3em; }
h1:first-child, h2:first-child, h1 + h2 { margin-top: .4em; }
p { margin: .65em 0; }
code { background: ${c.codeBg}; padding: .15em .38em; border-radius: 4px; font-family: Consolas,"Cascadia Mono",monospace; font-size: 92%; }
pre { background: ${c.codeBg}; padding: 12px 14px; border-radius: 8px; overflow: auto; line-height: 1.6; }
pre code { background: transparent; padding: 0; }
blockquote { margin: .8em 0; padding: 0 1em; color: ${c.fg2}; border-left: 3px solid ${c.border}; }
table { border-collapse: collapse; margin: .8em 0; }
th, td { border: 1px solid ${c.border}; padding: 5px 12px; }
th { background: ${c.codeBg}; }
img { max-width: 100%; }
a { color: ${c.link}; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: 0; border-top: 1px solid ${c.border}; margin: 1.6em 0; }
ul, ol { padding-left: 1.6em; }
li { margin: .25em 0; }
</style></head><body>${html}</body></html>`;
  }
  function ExternalFilePreview(props) {
    const theme = useAppState().theme;
    const dark = props.dark ?? ((theme == null ? void 0 : theme.base) ?? "dark") !== "light";
    const htmlRaw = isHtmlPath(props.path);
    const [phase, setPhase] = react.useState({ kind: "loading" });
    react.useEffect(() => {
      let stale = false;
      setPhase({ kind: "loading" });
      call$1("file.preview", { path: props.path }).then(async (r) => {
        if (stale) return;
        if (isProviderResult(r)) {
          const content = r.kind === "html" && !isHtmlPath(props.path) ? await injectCodeHighlight(r.content).catch(() => r.content) : r.content;
          if (!stale) setPhase({ kind: r.kind, content });
        } else setPhase({ kind: "fallback" });
      }).catch(() => {
        if (!stale) setPhase({ kind: "fallback" });
      });
      return () => {
        stale = true;
      };
    }, [props.path, dark]);
    const name = props.path.split("/").pop() ?? props.path;
    const frameRef = react.useRef(null);
    const preRef = react.useRef(null);
    const scrollTimerRef = react.useRef(null);
    const propsRef = react.useRef({ initialScrollTop: props.initialScrollTop, onScrollTop: props.onScrollTop });
    propsRef.current = { initialScrollTop: props.initialScrollTop, onScrollTop: props.onScrollTop };
    const reportScroll = react.useCallback((top) => {
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        var _a2, _b2;
        scrollTimerRef.current = null;
        (_b2 = (_a2 = propsRef.current).onScrollTop) == null ? void 0 : _b2.call(_a2, top);
      }, 400);
    }, []);
    react.useEffect(() => {
      if (phase.kind !== "html") return;
      const f = frameRef.current;
      if (!f) return;
      let cleanedUp = false;
      const applyInitial = () => {
        if (cleanedUp) return;
        const w = f.contentWindow;
        if (!w) return;
        const t2 = propsRef.current.initialScrollTop;
        if (typeof t2 === "number" && t2 > 0) {
          try {
            if (htmlRaw) {
              w.postMessage({ type: "preview-restore", scrollY: t2 }, "*");
            } else {
              w.scrollTo(0, t2);
            }
          } catch {
          }
        }
      };
      f.addEventListener("load", applyInitial);
      return () => {
        var _a2, _b2;
        cleanedUp = true;
        f.removeEventListener("load", applyInitial);
        const pending = scrollTimerRef.current;
        if (pending !== null) {
          window.clearTimeout(pending);
          const w = f.contentWindow;
          if (w) {
            try {
              if (htmlRaw) {
                w.postMessage({ type: "preview-flush" }, "*");
              } else {
                const t2 = w.scrollY ?? 0;
                (_b2 = (_a2 = propsRef.current).onScrollTop) == null ? void 0 : _b2.call(_a2, t2);
              }
            } catch {
            }
          }
        }
        scrollTimerRef.current = null;
      };
    }, [phase.kind, htmlRaw, reportScroll]);
    const [htmlWithTracker, setHtmlWithTracker] = react.useState(null);
    const phaseContent = phase.kind === "html" || phase.kind === "text" ? phase.content : "";
    react.useEffect(() => {
      if (phase.kind !== "html" || !htmlRaw) {
        setHtmlWithTracker(null);
        return;
      }
      const script = `<script>(function(){var t=null;function flush(){parent.postMessage({type:'preview-scroll',scrollY:window.scrollY},'*')}window.addEventListener('scroll',function(){if(t)clearTimeout(t);t=setTimeout(function(){t=null;flush()},400)},{passive:true});window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='preview-restore'&&typeof d.scrollY==='number'){window.scrollTo(0,d.scrollY)}else if(d&&d.type==='preview-flush'){flush()}});parent.postMessage({type:'preview-ready'},'*')})();<\/script>`;
      setHtmlWithTracker(phaseContent + script);
    }, [phase.kind, htmlRaw, phaseContent]);
    react.useEffect(() => {
      if (!htmlRaw) return;
      const onMsg = (e) => {
        const f = frameRef.current;
        if (!f || e.source !== f.contentWindow) return;
        const d = e.data;
        if ((d == null ? void 0 : d.type) === "preview-scroll" && typeof d.scrollY === "number") {
          reportScroll(d.scrollY);
        }
      };
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, [htmlRaw, reportScroll]);
    const onPreScroll = react.useCallback(() => {
      const el = preRef.current;
      if (el) reportScroll(el.scrollTop);
    }, [reportScroll]);
    react.useEffect(() => {
      if (phase.kind !== "text") return;
      const el = preRef.current;
      if (!el) return;
      const t2 = propsRef.current.initialScrollTop;
      if (typeof t2 === "number" && t2 > 0) {
        try {
          el.scrollTop = t2;
        } catch {
        }
      }
    }, [phase.kind]);
    react.useEffect(() => () => {
      var _a2, _b2;
      const pending = scrollTimerRef.current;
      if (pending !== null) {
        window.clearTimeout(pending);
        scrollTimerRef.current = null;
      }
      const el = preRef.current;
      if (el) {
        try {
          (_b2 = (_a2 = propsRef.current).onScrollTop) == null ? void 0 : _b2.call(_a2, el.scrollTop);
        } catch {
        }
      }
    }, []);
    return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { position: "absolute", inset: 0 }, children: phase.kind === "loading" ? null : phase.kind === "html" ? /* @__PURE__ */ jsxRuntime.jsx(
      "iframe",
      {
        ref: frameRef,
        className: "extpreview-frame",
        sandbox: htmlRaw ? "allow-scripts allow-forms allow-modals" : "allow-same-origin",
        title: name,
        srcDoc: htmlRaw ? htmlWithTracker ?? phase.content : mdSrcdoc(phase.content, dark),
        onLoad: () => {
          const f = frameRef.current;
          const w = f == null ? void 0 : f.contentWindow;
          if (w && !htmlRaw) {
            w.addEventListener("scroll", () => {
              reportScroll(w.scrollY ?? 0);
            });
          }
        }
      }
    ) : phase.kind === "text" ? /* @__PURE__ */ jsxRuntime.jsx("pre", { ref: preRef, className: "extpreview-text", onScroll: onPreScroll, children: phase.content }) : /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: name }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: props.fallbackTitle ?? "外部预览不可用" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: props.fallbackBody ?? "未安装提供该格式预览的插件（设置 → 扩展 → 允许代码插件）" }) }),
        props.onEditText && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", style: { marginTop: 10 }, onClick: props.onEditText, children: props.editLabel ?? "编辑源文件" })
      ] })
    ] }) });
  }
  function nativeSepOf(workDir) {
    return workDir.replace(/[\\/]+$/, "").includes("\\") ? "\\" : "/";
  }
  function absPathOf(workDir, rel) {
    const base = workDir.replace(/[\\/]+$/, "");
    const sep = nativeSepOf(workDir);
    const tail = rel.replace(/\\/g, "/").replace(/^[/\\]+/, "");
    return base + sep + tail.split("/").join(sep);
  }
  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
  function imgMime(path) {
    var _a2;
    const ext = ((_a2 = path.split(".").pop()) == null ? void 0 : _a2.toLowerCase()) ?? "png";
    if (ext === "jpg") return "jpeg";
    if (ext === "svg") return "svg+xml";
    if (ext === "ico") return "x-icon";
    return ext || "png";
  }
  const MAX_TEXT_BYTES = 2e6;
  const TURNS_TAB = "turns";
  function riskColor(level) {
    return level === "high" ? "var(--c-red)" : level === "medium" ? "var(--c-amber)" : "var(--c-fg3)";
  }
  function reviewLabel(status) {
    return status === "approved" ? { text: "已通过", color: "var(--c-green)" } : status === "rejected" ? { text: "已退回", color: "var(--c-red)" } : { text: "待审查", color: "var(--c-amber)" };
  }
  function letterColor(letter) {
    return letter === "A" ? "var(--c-green)" : letter === "D" ? "var(--c-red)" : "var(--c-amber)";
  }
  function baseName(p) {
    return p.split("/").pop() ?? p;
  }
  function tabId(path) {
    return `file:${path}`;
  }
  function TaskChangesPanel(props) {
    var _a2;
    const [tabs, setTabs] = react.useState([TURNS_TAB]);
    const [active, setActive] = react.useState(TURNS_TAB);
    const [turn, setTurn] = react.useState("latest");
    const [modes, setModes] = react.useState({});
    const [cps, setCps] = react.useState([]);
    const [letters, setLetters] = react.useState({});
    const [files, setFiles] = react.useState([]);
    const [diffs, setDiffs] = react.useState([]);
    const [view, setView] = react.useState({ kind: "empty" });
    const [err, setErr] = react.useState(null);
    const lastReq = react.useRef(0);
    const [base, setBase] = react.useState("task");
    const [risk, setRisk] = react.useState(null);
    const [review, setReview] = react.useState(null);
    const [reviewEditing, setReviewEditing] = react.useState(false);
    const [reviewComment, setReviewComment] = react.useState("");
    const uiV = useAgentUIVersion();
    const pluginPanels = react.useMemo(() => taskPanels(), [uiV]);
    const activePlugin = pluginPanels.find((p) => p.def.id === active) ?? null;
    function letterOf(path) {
      return letters[path] ?? "M";
    }
    const activePath = active === TURNS_TAB ? void 0 : active;
    const activeMode = activePath ? modes[activePath] ?? "preview" : "preview";
    (() => {
      const t2 = tabs.find((t22) => typeof t22 !== "string" && tabId(t22.path) === active);
      return t2 ? t2.origin : "latest";
    })();
    react.useEffect(() => {
      let cancelled = false;
      void call$1("agent.task.checkpoints", { taskId: props.taskId }).then((x) => {
        if (!cancelled) setCps(x.slice().reverse());
      }).catch(() => {
      });
      return () => {
        cancelled = true;
      };
    }, [props.taskId, props.tick]);
    react.useEffect(() => {
      if (active !== TURNS_TAB) return;
      let cancelled = false;
      if (turn === "latest") {
        if (base === "head") {
          void call$1("agent.task.diff", { taskId: props.taskId, base: "head" }).then((ds) => {
            if (cancelled) return;
            setFiles(ds.map((d) => ({ path: d.path, letter: d.isNew ? "A" : d.isDeleted ? "D" : "M", added: d.addedLines, deleted: d.deletedLines })));
            setLetters((lm) => {
              const nm = { ...lm };
              ds.forEach((d) => {
                nm[d.path] = d.isNew ? "A" : d.isDeleted ? "D" : "M";
              });
              return nm;
            });
          }).catch(() => {
            if (!cancelled) setFiles([]);
          });
        } else {
          void call$1("agent.task.files", { taskId: props.taskId }).then((fs) => {
            if (cancelled) return;
            setFiles(fs.map((f) => ({ path: f.path, letter: f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : "M", added: f.added, deleted: f.deleted })));
            setLetters((lm) => {
              const nm = { ...lm };
              fs.forEach((f) => {
                nm[f.path] = f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : "M";
              });
              return nm;
            });
          }).catch(() => {
            if (!cancelled) setFiles([]);
          });
        }
      } else {
        void call$1("agent.task.diff", { taskId: props.taskId, since: `checkpoint:${turn}` }).then((ds) => {
          if (cancelled) return;
          setFiles(ds.map((d) => ({ path: d.path, letter: d.isNew ? "A" : d.isDeleted ? "D" : "M", added: d.addedLines, deleted: d.deletedLines })));
          setLetters((lm) => {
            const nm = { ...lm };
            ds.forEach((d) => {
              nm[d.path] = d.isNew ? "A" : d.isDeleted ? "D" : "M";
            });
            return nm;
          });
        }).catch(() => {
          if (!cancelled) setFiles([]);
        });
      }
      return () => {
        cancelled = true;
      };
    }, [active, turn, base, props.taskId, props.tick]);
    react.useEffect(() => {
      let cancelled = false;
      void call$1("agent.task.risk", { taskId: props.taskId }).then((r) => {
        if (!cancelled) setRisk(r);
      }).catch(() => {
      });
      void call$1("agent.tasks", {}).then((x) => {
        var _a3;
        if (!cancelled) setReview(((_a3 = x.tasks.find((t2) => t2.taskId === props.taskId)) == null ? void 0 : _a3.review) ?? null);
      }).catch(() => {
      });
      return () => {
        cancelled = true;
      };
    }, [props.taskId, props.tick]);
    const submitReview = react.useCallback((decision, comment) => {
      void call$1("agent.task.review.set", { taskId: props.taskId, status: decision === "approve" ? "approved" : "rejected", comment: comment || null }).then(() => {
        setReview(decision === "approve" ? { status: "approved", comment: null } : { status: "rejected", comment });
        setReviewEditing(false);
        setReviewComment("");
      }).catch((e) => setErr(e.message));
    }, [props.taskId]);
    react.useEffect(() => {
      const req = props.request;
      if (!req || req.ts === lastReq.current) return;
      lastReq.current = req.ts;
      openFileTab(req.path, "latest", req.mode);
    }, [(_a2 = props.request) == null ? void 0 : _a2.ts]);
    react.useEffect(() => {
      var _a3;
      if (activePath === void 0 || activeMode !== "diff") {
        setDiffs([]);
        return;
      }
      let cancelled = false;
      const origin = ((_a3 = tabs.find((t2) => typeof t2 !== "string" && t2.path === activePath)) == null ? void 0 : _a3.origin) ?? "latest";
      const since = origin === "latest" ? void 0 : `checkpoint:${origin}`;
      const rpcBase = origin === "latest" && turn === "latest" && base === "head" ? "head" : "baseline";
      void call$1("agent.task.diff", { taskId: props.taskId, path: activePath, since, base: rpcBase }).then((d) => {
        if (!cancelled) setDiffs(d);
      }).catch(() => {
        if (!cancelled) setDiffs([]);
      });
      return () => {
        cancelled = true;
      };
    }, [activePath, activeMode, props.taskId, base, turn]);
    react.useEffect(() => {
      if (activePath === void 0 || activeMode !== "preview") return;
      let cancelled = false;
      setErr(null);
      if (IMG_RE.test(activePath)) {
        setView({ kind: "loading" });
        void call$1("file.readBinary", { path: activePath }).then((r) => {
          if (cancelled) return;
          setView({ kind: "image", url: `data:image/${imgMime(activePath)};base64,${(r == null ? void 0 : r.base64) ?? ""}` });
        }).catch((e) => {
          if (!cancelled) setView({ kind: "error", message: e.message });
        });
        return () => {
          cancelled = true;
        };
      }
      if (isExternalPreviewPath(activePath)) {
        setView({ kind: "external" });
        return () => {
          cancelled = true;
        };
      }
      setView({ kind: "loading" });
      (async () => {
        try {
          const r = await call$1("file.content", { path: activePath, revision: "worktree", maxBytes: MAX_TEXT_BYTES });
          if (cancelled) return;
          if (!r || r.binary) {
            setView({ kind: "binary" });
            return;
          }
          if (r.truncated) {
            setView({ kind: "toolarge" });
            return;
          }
          const hl = await call$1("highlight.file", { path: activePath, text: r.content }).catch(() => null);
          if (cancelled) return;
          setView({ kind: "text", lines: (hl == null ? void 0 : hl.lines) ?? [], plain: r.content.split("\n"), syntaxColors: (hl == null ? void 0 : hl.syntaxColors) ?? {} });
        } catch (e) {
          if (!cancelled) setView({ kind: "error", message: e.message });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [activePath, activeMode, props.taskId]);
    const activate = (id) => setActive(id);
    function openFileTab(path, origin, mode) {
      setTabs((cur) => {
        const ids = cur.map((t2) => typeof t2 === "string" ? t2 : t2.path);
        if (ids.includes(path)) return cur;
        return [...cur, { path, origin }];
      });
      setActive(path);
      if (mode) setModes((m) => ({ ...m, [path]: mode }));
    }
    const closeTab = react.useCallback((id) => {
      setTabs((cur) => cur.filter((t2) => (typeof t2 === "string" ? t2 : t2.path) !== id));
      setActive((cur) => cur === id ? TURNS_TAB : cur);
    }, []);
    const openExternal = react.useCallback((useExternalEditor) => {
      if (!activePath) return;
      const full = absPathOf(props.worktreePath, activePath);
      void call$1("shell.openPath", { path: full, editor: useExternalEditor || void 0 }).catch((e) => setErr(e.message));
    }, [activePath, props.worktreePath]);
    const fileTabNodes = tabs.filter((t2) => typeof t2 !== "string");
    const hintText = turn !== "latest" ? `该轮快照（${turn.slice(0, 8)}^..${turn.slice(0, 8)}）· 只读回看` : base === "head" ? "基线 = 当前分支头（工作区+暂存 vs HEAD）· 不含未跟踪文件" : "基线 = 任务起点（squash 视角，含全部 checkpoint）";
    const riskByPath = react.useMemo(() => {
      const m = /* @__PURE__ */ new Map();
      for (const f of (risk == null ? void 0 : risk.files) ?? []) m.set(f.path, f);
      return m;
    }, [risk]);
    const riskCounts = (risk == null ? void 0 : risk.counts) ?? null;
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-panel", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-review", children: [
        review ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "lc-review-chip", style: { color: reviewLabel(review.status).color }, title: review.comment ?? "", children: [
          "● 审查：",
          reviewLabel(review.status).text,
          review.comment ? ` · ${review.comment.slice(0, 60)}` : ""
        ] }) : /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-review-chip", style: { color: "var(--c-fg3)" }, children: "● 审查：未评审" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
        reviewEditing === false ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn icon",
              title: "通过本轮改动（结论注入 agent 下一轮）",
              "aria-label": "通过",
              onClick: () => submitReview("approve", ""),
              children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "check", size: 13, color: "var(--c-green)" })
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn icon",
              title: "退回并附审查意见（自动直投修复轮）",
              "aria-label": "退回",
              onClick: () => {
                setReviewEditing("reject");
                setReviewComment("");
              },
              children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "x", size: 13, color: "var(--c-red)" })
            }
          )
        ] }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "lc-review-input",
              placeholder: reviewEditing === "reject" ? "审查意见（退回原因，进入 agent 下一轮）" : "补充说明（可空）",
              value: reviewComment,
              autoFocus: true,
              onChange: (e) => setReviewComment(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter" && (reviewEditing === "approve" || reviewComment.trim())) submitReview(reviewEditing, reviewComment);
                if (e.key === "Escape") setReviewEditing(false);
              }
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: reviewEditing === "reject" && !reviewComment.trim(), onClick: () => submitReview(reviewEditing, reviewComment), children: "确认" }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setReviewEditing(false), children: "取消" })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-tabs", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "lc-tab turns" + (active === TURNS_TAB ? " on" : ""), title: "按轮查看变更（固定，不可关闭）", onClick: () => activate(TURNS_TAB), children: [
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "commit", size: 12 }),
          "按轮"
        ] }),
        pluginPanels.map(({ def }) => /* @__PURE__ */ jsxRuntime.jsx("button", { className: "lc-tab" + (active === def.id ? " on" : ""), title: def.title, onClick: () => setActive(def.id), children: def.title }, def.id)),
        fileTabNodes.map((t2) => /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "lc-tab file" + (active === t2.path ? " on" : ""), title: t2.path, onClick: () => setActive(t2.path), children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-file-letter", style: { color: letterColor(letterOf(t2.path)) }, children: letterOf(t2.path) }),
          baseName(t2.path),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-x", title: "关闭", onClick: (e) => {
            e.stopPropagation();
            closeTab(t2.path);
          }, children: "✕" })
        ] }, t2.path)),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", title: "收起面板，回到纯对话", "aria-label": "收起面板", onClick: props.onCollapse, children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "splitpane", size: 13 }) })
      ] }),
      activePlugin ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-body", style: { display: "flex" }, children: activePlugin.def.render({ taskId: props.taskId }) }) : active === TURNS_TAB ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-turnspage", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-turns", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-hint", children: "按轮查看变更 · 点击轮次载入该轮文件列表" }),
          /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "lc-turn" + (turn === "latest" ? " sel" : ""), onClick: () => setTurn("latest"), children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-turn-dot", style: { background: "var(--c-green)" } }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-turn-sum", children: "最新改动" }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "lc-seg lc-base-seg", onClick: (e) => e.stopPropagation(), children: [
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: base === "task" ? "on" : "", title: "自任务开始以来（工作区 + checkpoint 提交的净 diff，squash 视角）", onClick: () => setBase("task"), children: "任务起点" }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: base === "head" ? "on" : "", title: "工作区 + 暂存 vs 当前分支头（不含未跟踪）", onClick: () => setBase("head"), children: "vs HEAD" })
            ] })
          ] }),
          cps.map((c) => /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "lc-turn" + (turn === c.sha ? " sel" : ""), title: `${c.summary}
${c.date.slice(5, 16).replace("T", " ")}`, onClick: () => setTurn(c.sha), children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-turn-dot" }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "lc-turn-sum", children: [
              "cp ",
              c.sha.slice(0, 8),
              " · ",
              c.summary.replace(/^checkpoint:\s*/, "")
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-turn-time", children: c.date.slice(5, 16).replace("T", " ") })
          ] }, c.sha))
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-fileswrap", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-hint", children: [
            hintText,
            riskCounts && riskCounts.high + riskCounts.medium + riskCounts.low > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "lc-risk-sum", title: "纯规则风险信号（零 AI 依赖）", children: [
              " · 风险：",
              riskCounts.high > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-red)" }, children: [
                riskCounts.high,
                " 高 "
              ] }),
              riskCounts.medium > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-amber)" }, children: [
                riskCounts.medium,
                " 中 "
              ] }),
              riskCounts.low > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-fg3)" }, children: [
                riskCounts.low,
                " 低"
              ] })
            ] }) : null
          ] }),
          files.map((f) => {
            const rf = riskByPath.get(f.path);
            const top = rf == null ? void 0 : rf.signals[0];
            return /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "lc-file", title: `${f.path} · 预览 / 差异${top ? `
⚠ ${rf.signals.map((s) => s.message).join("\n⚠ ")}` : ""}`, onClick: () => openFileTab(f.path, turn), children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-file-letter", style: { color: letterColor(f.letter) }, children: f.letter }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-file-path", children: f.path }),
              top ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-risk-dot", style: { background: riskColor(top.level) }, title: rf.signals.map((s) => `[${s.level}] ${s.message}`).join("\n") }) : null,
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-file-stats", children: f.added != null ? `+${f.added} −${f.deleted ?? 0}` : "" })
            ] }, f.path);
          }),
          files.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-hint", children: turn !== "latest" ? "该轮无改动" : base === "head" ? "工作区相对 HEAD 无差异（未跟踪文件请切「任务起点」基线查看）" : "暂无改动" })
        ] })
      ] }) : /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-filepage", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-viewbar", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-file-letter", style: { color: letterColor(letterOf(activePath ?? "")) }, children: letterOf(activePath ?? "") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-viewbar-path", children: activePath ?? "—" }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-seg", children: [
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: activeMode === "preview" ? "on" : "", onClick: () => activePath && setModes((m) => ({ ...m, [activePath]: "preview" })), children: "预览" }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: activeMode === "diff" ? "on" : "", onClick: () => activePath && setModes((m) => ({ ...m, [activePath]: "diff" })), children: "差异" })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "splitbtn", children: [
            /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "lc-split-main", disabled: !activePath, title: "跳到内置编辑器（文件页）编辑", onClick: () => activePath && props.onEditInFilesPage(activePath), children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "pencil", size: 12 }),
              "内置编辑器"
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "lc-split-chev", disabled: !activePath, title: "用其他应用打开", onClick: (e) => {
              var _a3;
              e.stopPropagation();
              (_a3 = document.getElementById("lcAppMenu")) == null ? void 0 : _a3.classList.toggle("on");
            }, children: "▾" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-split-menu", id: "lcAppMenu", children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-split-head", children: "用外部应用打开当前文件" }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "lc-split-item", onClick: () => {
                var _a3;
                openExternal(true);
                (_a3 = document.getElementById("lcAppMenu")) == null ? void 0 : _a3.classList.remove("on");
              }, children: "VS Code（settings.externalEditor）" }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "lc-split-item", onClick: () => {
                var _a3;
                openExternal(false);
                (_a3 = document.getElementById("lcAppMenu")) == null ? void 0 : _a3.classList.remove("on");
              }, children: "系统默认应用" })
            ] })
          ] })
        ] }),
        err && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-err", children: err }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-body", children: activeMode === "diff" ? diffs.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-loading", children: "（无差异）" }) : diffs.filter((d) => d.path === activePath || d.oldPath === activePath).map((d) => /* @__PURE__ */ jsxRuntime.jsx(DiffView, { diff: d }, d.path)) : view.kind === "loading" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-loading", children: "加载中…" }) : view.kind === "image" ? /* @__PURE__ */ jsxRuntime.jsx("img", { className: "lc-img", src: view.url, alt: activePath ?? "" }) : view.kind === "external" ? /* @__PURE__ */ jsxRuntime.jsx(
          ExternalFilePreview,
          {
            path: activePath ?? "",
            fallbackBody: "未安装提供该格式预览的插件（Markdown/HTML 预览），或未在 设置 → 扩展 打开「允许代码插件」",
            onEditText: () => activePath && props.onEditInFilesPage(activePath)
          }
        ) : view.kind === "text" ? /* @__PURE__ */ jsxRuntime.jsx("pre", { className: "lc-code", children: view.lines.length > 0 ? view.lines.map((runs, li) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-line", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-ln", children: li + 1 }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-code", children: runs.length === 0 ? view.plain[li] ?? "" : runs.map((r, ri) => {
            var _a3;
            return /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: r.color ?? view.syntaxColors[r.style] }, children: (_a3 = view.plain[li]) == null ? void 0 : _a3.slice(r.start, r.end) }, ri);
          }) })
        ] }, li)) : view.plain.map((t2, li) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-line", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-ln", children: li + 1 }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lc-code", children: t2 })
        ] }, li)) }) : view.kind === "binary" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-loading", children: "二进制文件——请用「外部应用」打开" }) : view.kind === "toolarge" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-loading", children: "文件过大——请用「外部应用」打开" }) : view.kind === "error" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "lc-loading", children: [
          "读取失败：",
          view.message
        ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lc-loading", children: "（选择文件）" }) })
      ] })
    ] });
  }
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
  const MAX_BLOCKS = 400;
  function pushCap(arr, b) {
    let next = [...arr, b];
    if (b.kind !== "thinking") {
      for (let i = next.length - 2; i >= 0; i--) {
        const x = next[i];
        if (x.kind !== "thinking") break;
        if (!x.closed) {
          next = [...next];
          next[i] = { ...x, closed: true };
        }
      }
    }
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
        if (ev.phase === "running-command") return blocks;
        return pushCap(blocks, { kind: "status", text: `${ev.phase ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}`, phase: ev.phase });
      case "output":
        if (ev.stream === "thinking") {
          const last = blocks[blocks.length - 1];
          if (last && last.kind === "thinking" && last.merge && !last.closed) {
            const next = [...blocks];
            next[next.length - 1] = { ...last, text: last.text + (ev.text ?? "") };
            return next;
          }
          return pushCap(blocks, { kind: "thinking", text: ev.text ?? "", merge: true });
        }
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
        if (ev.phase === "args") {
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.kind === "tool" && b.callId === ev.callId) {
              const next = [...blocks];
              const prev = b.args ?? {};
              const inc = ev.args ?? {};
              next[i] = { ...b, args: { ...prev, ...inc } };
              return next;
            }
          }
          return blocks;
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
        return pushCap(blocks.filter((b) => b.kind !== "todo"), { kind: "todo", todos: ev.todos ?? [] });
      case "checkpoint":
        return pushCap(blocks, { kind: "checkpoint", sha: ev.commitSha ?? "", summary: ev.summary ?? "" });
      case "file-change":
        return pushCap(blocks, { kind: "file", path: ev.path ?? "", changeKind: ev.kind ?? "modified", summary: ev.summary });
      case "subtask":
        return pushCap(blocks, { kind: "subtask", subtaskId: ev.subtaskId ?? "", name: ev.name ?? "", mode: ev.mode ?? "", state: ev.state ?? "running", final: ev.finalMessage, durationMs: ev.durationMs, children: [] });
      case "turn-completed":
        return pushCap(blocks, { kind: "turn", text: `turn #${blocks.filter((b) => b.kind === "turn").length + 1}`, usage: ev.usage });
      case "completed": {
        const outcomeLabel = ev.outcome === "failed" ? "失败" : ev.outcome === "stopped" ? "已停止" : ev.outcome === "interrupted" ? "已中断" : ev.outcome === "cancelled" ? "已中断" : ev.outcome ?? "";
        return pushCap(blocks, { kind: "status", text: `${outcomeLabel}${ev.summary ? ` — ${ev.summary}` : ""}`, phase: ev.outcome === "failed" ? "failed" : void 0 });
      }
      case "log":
        return pushCap(blocks, { kind: "log", level: ev.level ?? "info", text: ev.text ?? "" });
      default:
        return blocks;
    }
  }
  function permOptions(b, showFullAccess = false) {
    const sig = b.command ?? b.title;
    const prefix = sig ? sig.slice(0, 24) : null;
    const opts = [{ label: "1. 是，执行一次", reply: { ok: true } }];
    if (b.rememberable !== false) opts.push({ label: "2. 是，本会话不再询问", reply: { ok: true, remember: true } });
    if (prefix) opts.push({ label: `3. 是，总是允许前缀 “${prefix}”`, reply: { ok: true, remember: true, rulePrefix: prefix } });
    if (showFullAccess) opts.push({ label: `${opts.length + 1}. 完全访问：批准并切换（后续不再询问，仅不确定时提问）`, reply: { ok: true, remember: true, fullAccess: true } });
    opts.push({ label: `${opts.length + 1}. 否，告诉 agent 改用其他方式`, reply: { ok: false } });
    return opts;
  }
  function AgentImage(props) {
    const [src, setSrc] = react.useState(null);
    const [err, setErr] = react.useState(null);
    react.useEffect(() => {
      let cancelled = false;
      void call$1("agent.previewImage", { taskId: props.taskId, path: props.path }).then((r) => {
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
  const READOUT_MAX = 400;
  function buildReadout(tool, text) {
    const all = text.replace(/\u0000/g, "").split("\n");
    while (all.length > 0 && all[all.length - 1].trim() === "") all.pop();
    const total = all.length;
    const shown = all.slice(0, READOUT_MAX);
    if (tool === "repo_read_file") {
      return {
        lines: shown.map((tx, i) => ({ kind: "num", no: String(i + 1), tx })),
        total
      };
    }
    const diffish = shown.filter((l) => /^[+-]/.test(l)).length >= 2;
    if (diffish) {
      return {
        lines: shown.map((l) => {
          const mk = l[0] === "+" || l[0] === "-" ? l[0] : " ";
          const tone = mk === "+" ? "add" : mk === "-" ? "del" : "ctx";
          return { kind: "diff", mk, tone, tx: l.slice(1) };
        }),
        total
      };
    }
    return { lines: shown.map((tx) => ({ kind: "plain", tx })), total };
  }
  function ToolCard({ b, ctx }) {
    const [userOpen, setUserOpen] = react.useState(false);
    const open = !!(ctx == null ? void 0 : ctx.verbose) || userOpen;
    const live = b.state === "running";
    const aborted = b.state === "aborted";
    const label = TOOL_LABELS[b.name] ?? b.name;
    const shellId = (() => {
      if (b.name !== "terminal_run" && b.name !== "terminal_poll") return null;
      try {
        const a = b.args;
        return typeof (a == null ? void 0 : a.shellId) === "string" ? a.shellId : null;
      } catch {
        return null;
      }
    })();
    const filePath = (() => {
      if (b.name !== "file_write" && b.name !== "file_patch") return null;
      try {
        const a = b.args;
        return typeof (a == null ? void 0 : a.path) === "string" ? a.path : null;
      } catch {
        return null;
      }
    })();
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
    const readout = react.useMemo(
      () => buildReadout(b.name, live ? b.tail ?? "" : b.result ?? ""),
      [b.name, b.result, b.tail, live]
    );
    const hasBody = live ? !!b.tail : readout.lines.length > 0;
    if (b.name === "file_patch" || b.name === "file_write") {
      const paren = (b.result ?? "").match(/[（(]([^）)]+)[）)]/);
      const stats = paren ? ((paren[1] ?? "").split(/[;；]/).pop() ?? "").trim() : "";
      return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "v47-al", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-hd", children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          TlIcon,
          {
            name: toolIconName(b.name),
            size: 13,
            color: b.state === "error" ? "var(--c-red)" : live ? "var(--c-amber)" : void 0,
            className: live ? "v47-blink" : void 0
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-nm", children: label }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "span",
          {
            className: "v47-ar v47-fpath",
            title: "打开右侧预览修改",
            onClick: (e) => {
              var _a2;
              e.stopPropagation();
              if (filePath) (_a2 = ctx == null ? void 0 : ctx.previewFile) == null ? void 0 : _a2.call(ctx, filePath);
            },
            children: argSummary
          }
        ),
        stats ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-fsi", children: stats }) : null,
        (ctx == null ? void 0 : ctx.viewFile) && filePath ? /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "tool-btn v47-preview",
            title: "打开右侧差异面板",
            onClick: (e) => {
              var _a2;
              e.stopPropagation();
              (_a2 = ctx.viewFile) == null ? void 0 : _a2.call(ctx, filePath);
            },
            children: "差异"
          }
        ) : null,
        b.state === "error" ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-fail", children: "失败" }) : null,
        b.durationMs !== void 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "v47-du", children: [
          "· ",
          (b.durationMs / 1e3).toFixed(1),
          "s"
        ] }) : null
      ] }) });
    }
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-al" + (open ? " open" : "") + (live ? " live" : "") + (b.state === "error" ? " err" : "") + (aborted ? " aborted" : ""), children: [
      /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "v47-hd",
          onClick: () => setUserOpen((v) => !v),
          role: "button",
          tabIndex: 0,
          "aria-expanded": open,
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setUserOpen((v) => !v);
            }
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              TlIcon,
              {
                name: toolIconName(b.name),
                size: 13,
                color: b.state === "error" ? "var(--c-red)" : live ? "var(--c-amber)" : aborted ? "var(--c-text3)" : void 0,
                className: "v47-hic" + (live ? " v47-blink" : void 0)
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-nm" + (live ? " shimmer-text" : "") + (aborted ? " aborted" : ""), children: label }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-ar" + (live ? " shimmer-text" : "") + (aborted ? " aborted" : ""), children: argSummary }),
            filePath && (ctx == null ? void 0 : ctx.previewFile) ? /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn v47-preview", onClick: (e) => {
              var _a2;
              e.stopPropagation();
              (_a2 = ctx.previewFile) == null ? void 0 : _a2.call(ctx, filePath);
            }, children: "预览" }) : null,
            shellId && (ctx == null ? void 0 : ctx.openShell) ? /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn v47-preview",
                title: "在「后台」页签查看执行详情",
                onClick: (e) => {
                  var _a2;
                  e.stopPropagation();
                  (_a2 = ctx.openShell) == null ? void 0 : _a2.call(ctx, shellId);
                },
                children: "⤴ 后台"
              }
            ) : null,
            b.state === "error" ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-fail", children: "失败" }) : null,
            aborted ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-fail", style: { color: "var(--c-text3)", borderColor: "var(--c-border)" }, children: "已中断" }) : null,
            b.durationMs !== void 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "v47-du", children: [
              "· ",
              (b.durationMs / 1e3).toFixed(1),
              "s"
            ] }) : null
          ]
        }
      ),
      hasBody ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-res", children: [
        readout.lines.map(
          (r, i) => r.kind === "num" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-rl", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "no", children: r.no }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ar", children: "→" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tx", children: r.tx })
          ] }, i) : r.kind === "diff" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-rl", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mk " + r.tone, children: r.mk }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tx " + r.tone, children: r.tx })
          ] }, i) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "v47-rl", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tx", children: r.tx || " " }) }, i)
        ),
        readout.total > readout.lines.length ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-rl", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "no", children: "…" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ar", children: "→" }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tx", style: { color: "var(--c-text3)" }, children: [
            "共 ",
            readout.total,
            " 行"
          ] })
        ] }) : null
      ] }) : null
    ] });
  }
  function ThinkingCard({ b, ctx }) {
    const [userOpen, setUserOpen] = react.useState(false);
    const open = !!(ctx == null ? void 0 : ctx.verbose) || userOpen;
    const streaming = !b.closed;
    const text = b.text.trim() || "…";
    return /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: "v47-think" + (open ? " open" : "") + (streaming ? " live" : ""),
        onClick: () => setUserOpen((v) => !v),
        role: "button",
        tabIndex: 0,
        "aria-expanded": open,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setUserOpen((v) => !v);
          }
        },
        children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-th", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-spk", children: "✻" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-tlabel", children: streaming ? "思考中…" : "思考过程" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v47-mq", children: /* @__PURE__ */ jsxRuntime.jsx("span", { children: text }) })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "v47-tbody", children: text })
        ]
      }
    );
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
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { minWidth: 0, opacity: decided ? 0.65 : 1 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 650, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 13 }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
          "授权请求 · ",
          kindLabel[kind] ?? kind
        ] }),
        ((_b2 = b.payload) == null ? void 0 : _b2.source) ? /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 10, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", color: "var(--c-text3)" }, children: b.payload.source }) : null,
        ((_c = b.payload) == null ? void 0 : _c.risk) && /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: b.payload.risk === "high" ? "var(--c-red)" : "var(--c-text3)", marginLeft: "auto", fontWeight: 650 }, children: b.payload.risk === "high" ? "高危" : "注意" })
      ] }),
      b.command && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--c-text2)", margin: "4px 0 8px", whiteSpace: "pre-wrap", wordBreak: "break-all" }, children: b.command }),
      ((_d = b.payload) == null ? void 0 : _d.paths) && b.payload.paths.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11.5, color: "var(--c-text3)", margin: "4px 0", maxHeight: 64, overflowY: "auto" }, children: [
        b.payload.paths.slice(0, 20).map((p) => /* @__PURE__ */ jsxRuntime.jsx("div", { children: p }, p)),
        b.payload.paths.length > 20 ? /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
          "…共 ",
          b.payload.paths.length,
          " 个文件"
        ] }) : null
      ] }),
      decided ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11.5, color: "var(--c-text3)" }, children: decided === "ok" ? "✓ 已批准" : decided === "rule" ? "✓ 已批准并记住前缀" : "✕ 已拒绝" }) : /* @__PURE__ */ jsxRuntime.jsx(jsxRuntime.Fragment, { children: /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }, children: options.map((o, i) => /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          onClick: () => {
            props.onSel(b.requestId, i);
            if (o.reply.fullAccess) props.onFullAccess(b.requestId);
            else if (o.reply.rulePrefix !== void 0 && o.reply.rulePrefix !== null && o.reply.ok) props.onReply(b.requestId, true, true, o.reply.rulePrefix);
            else props.onReply(b.requestId, o.reply.ok, o.reply.remember);
          },
          style: { display: "flex", gap: 8, padding: "3px 8px", borderRadius: 6, cursor: "pointer", color: sel === i ? "var(--c-text)" : "var(--c-text2)", background: sel === i ? "var(--c-panel)" : "transparent" },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: sel === i ? "var(--c-text)" : "transparent", width: 12, flex: "none" }, children: sel === i ? "❯" : "" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { children: o.label })
          ]
        },
        o.label
      )) }) })
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
    const dotCls = "dot" + (b.state === "completed" ? " done" : "") + (b.state === "failed" || b.state === "timeout" ? " fail" : "");
    return /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: "sub-row" + (b.state === "running" ? " running" : ""),
        onClick: () => {
          var _a2;
          return (_a2 = ctx == null ? void 0 : ctx.openSubagent) == null ? void 0 : _a2.call(ctx, b.subtaskId);
        },
        role: "button",
        tabIndex: 0,
        onKeyDown: (e) => {
          var _a2;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            (_a2 = ctx == null ? void 0 : ctx.openSubagent) == null ? void 0 : _a2.call(ctx, b.subtaskId);
          }
        },
        children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "rail", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: dotCls, children: b.state === "running" ? "◐" : "·" }) }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "lbl", children: "子代理" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "desc", children: b.name || "子代理" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "du", children: b.durationMs != null ? Math.round(b.durationMs / 100) / 10 + "s" : "" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "cta", children: "← 查看详情" })
        ]
      }
    );
  }
  function groupTurns(blocks) {
    const groups = [];
    let cur = null;
    const newGroup = (human) => ({ anchor: null, human, process: [], conclusion: null, outcome: [], turn: null, active: false });
    const flush = () => {
      if (cur) groups.push(cur);
      cur = null;
    };
    for (const b of blocks) {
      if (b.kind === "human") {
        flush();
        cur = newGroup(b);
        continue;
      }
      if (!cur) cur = newGroup(null);
      if (b.kind === "turn") {
        cur.turn = b;
        flush();
        continue;
      }
      cur.process.push(b);
    }
    flush();
    for (const g of groups) {
      g.anchor = g.human ?? g.turn ?? g.process[0] ?? {};
      if (!g.turn) {
        g.active = true;
        continue;
      }
      for (let j = g.process.length - 1; j >= 0; j--) {
        const b = g.process[j];
        if (b.kind === "tool" || b.kind === "subtask") break;
        if (b.kind === "assistant") {
          g.conclusion = b;
          g.process.splice(j, 1);
          break;
        }
      }
      while (g.process.length > 0) {
        const last = g.process[g.process.length - 1];
        if (last.kind !== "status") break;
        g.outcome.unshift(last);
        g.process.pop();
      }
    }
    return groups;
  }
  function CopyMessageButton({ text, align }) {
    const [done, setDone] = react.useState(false);
    const timer = react.useRef(null);
    react.useEffect(() => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    }, []);
    return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", justifyContent: align === "right" ? "flex-end" : "flex-start", marginTop: 4 }, children: /* @__PURE__ */ jsxRuntime.jsx(
      "button",
      {
        type: "button",
        className: "icon-btn msg-copy",
        title: done ? "已复制" : "复制",
        "aria-label": done ? "已复制" : "复制",
        onClick: (e) => {
          var _a2;
          e.stopPropagation();
          void ((_a2 = navigator.clipboard) == null ? void 0 : _a2.writeText(text));
          setDone(true);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1400);
        },
        children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: done ? "check" : "copy", size: 13, color: done ? "var(--c-green)" : void 0 })
      }
    ) });
  }
  function FileGroup({ items, ctx }) {
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-ln", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "v47-g", children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "diff", size: 13, color: "var(--c-text2)" }) }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "v47-c", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-fgrp", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-fh", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fn", children: "本轮变更" }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "fc", children: [
            items.length,
            " 个文件"
          ] })
        ] }),
        items.map((b, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-frow", title: "打开右侧预览修改", onClick: () => {
          var _a2;
          return (_a2 = ctx == null ? void 0 : ctx.previewFile) == null ? void 0 : _a2.call(ctx, b.path);
        }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "st", children: b.changeKind === "deleted" ? "D" : b.changeKind === "added" ? "A" : "M" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "p", children: b.path }),
          b.summary ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "stats", children: b.summary }) : null
        ] }, i))
      ] }) })
    ] });
  }
  const BUILTIN_TIMELINE_RENDERERS = [
    {
      blockKind: "human",
      render: ({ block }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "msg-row", style: { display: "flex", justifyContent: "flex-end", padding: "12px 0 4px" }, children: /* @__PURE__ */ jsxRuntime.jsx("div", { style: { maxWidth: "78%", background: "var(--c-panel2, var(--c-panel))", border: "1px solid var(--c-border)", borderRadius: 14, padding: "10px 14px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 15, lineHeight: 1.65 }, children: b.text }) });
      }
    },
    {
      blockKind: "assistant",
      render: ({ block, ctx }) => {
        const b = block;
        if (!b.text.trim()) return null;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "msg-row", style: { padding: "8px 0" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "md-body", dangerouslySetInnerHTML: { __html: renderMarkdown(b.text) } }),
          (ctx == null ? void 0 : ctx.showCopy) ? /* @__PURE__ */ jsxRuntime.jsx(CopyMessageButton, { text: b.text, align: "left" }) : null
        ] });
      }
    },
    {
      blockKind: "thinking",
      render: ({ block, ctx }) => /* @__PURE__ */ jsxRuntime.jsx(ThinkingCard, { b: block, ctx })
    },
    {
      blockKind: "status",
      render: ({ block }) => {
        const b = block;
        const isOutcome = !b.phase || b.phase === "failed";
        if (isOutcome) {
          const failed = b.phase === "failed";
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-outcome", children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: failed ? "dot" : "check-circle", size: 14, color: failed ? "var(--c-red)" : "var(--c-green)", style: { flex: "none", marginTop: 3 } }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tx", children: b.text || (failed ? "任务失败" : "本轮已完成") })
          ] });
        }
        const icon = b.phase === "thinking" ? "sparkle" : b.phase === "editing" ? "pencil" : "dot";
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11.5, color: "var(--c-text3)", display: "flex", alignItems: "center", gap: 6 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: icon, size: 12, className: b.phase === "thinking" ? "tl-pulse" : void 0 }),
          b.text
        ] });
      }
    },
    {
      blockKind: "tool",
      render: ({ block, ctx }) => /* @__PURE__ */ jsxRuntime.jsx(ToolCard, { b: block, ctx })
    },
    {
      blockKind: "checkpoint",
      render: ({ block }) => {
        const b = block;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-meta", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            "· 检查点 ",
            b.sha.slice(0, 8)
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text2)", overflowWrap: "anywhere" }, children: b.summary }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { opacity: 0.8 }, children: "Esc×2 可回滚" })
        ] });
      }
    },
    {
      blockKind: "file",
      render: ({ block, ctx }) => {
        const b = block;
        if (b.changeKind === "read-image") return /* @__PURE__ */ jsxRuntime.jsx("div", { children: /* @__PURE__ */ jsxRuntime.jsx(AgentImage, { taskId: (ctx == null ? void 0 : ctx.taskId) ?? "", path: b.path }) });
        const letter = b.changeKind === "deleted" ? "D" : b.changeKind === "added" ? "A" : "M";
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-frow", title: "打开右侧预览修改", onClick: () => {
          var _a2;
          return (_a2 = ctx == null ? void 0 : ctx.previewFile) == null ? void 0 : _a2.call(ctx, b.path);
        }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "st", children: letter }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "p", children: b.path }),
          b.summary ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "stats", children: b.summary }) : null,
          (ctx == null ? void 0 : ctx.viewFile) ? /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn v47-preview", onClick: (e) => {
            var _a2;
            e.stopPropagation();
            (_a2 = ctx.viewFile) == null ? void 0 : _a2.call(ctx, b.path);
          }, children: "查看" }) : null,
          (ctx == null ? void 0 : ctx.previewFile) && b.changeKind !== "deleted" ? /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn v47-preview", onClick: (e) => {
            var _a2;
            e.stopPropagation();
            (_a2 = ctx.previewFile) == null ? void 0 : _a2.call(ctx, b.path);
          }, children: "预览" }) : null
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
        var _a2, _b2;
        const b = block;
        const total = ((((_a2 = b.usage) == null ? void 0 : _a2.input) ?? 0) + (((_b2 = b.usage) == null ? void 0 : _b2.output) ?? 0)) / 1e3;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-usage", children: [
          "· ",
          b.usage ? `${total.toFixed(1)}k tokens（${b.usage.input ?? "?"} in / ${b.usage.output ?? "?"} out）` : b.text,
          (ctx == null ? void 0 : ctx.contextPct) ? ` · context ${ctx.contextPct}` : ""
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
  const MODE_ORDER = ["plan", "default", "yolo"];
  const MODE_META = {
    plan: { label: "◇ 计划", color: "var(--c-chip-purple-fg, #b490ff)" },
    default: { label: "● 默认", color: "var(--c-text3)" },
    yolo: { label: "⚡ 完全访问", color: "var(--c-red)" }
  };
  const THINKING_META = {
    off: { label: "思考·关", hint: "跳过推理，响应最快" },
    low: { label: "思考·低", hint: "轻量推理，适合明确指令" },
    medium: { label: "思考·中", hint: "平衡推理与速度（默认）" },
    high: { label: "思考·高", hint: "深度推理，适合复杂设计" }
  };
  function CompPopover(props) {
    const ref = react.useRef(null);
    const [maxH, setMaxH] = react.useState(void 0);
    react.useLayoutEffect(() => {
      if (!props.open) return;
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
        const t2 = e.target;
        if (ref.current && !ref.current.contains(t2) && !(t2 == null ? void 0 : t2.closest(".comp-item, .comp-stats"))) props.onClose();
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
        className: "comp-pop" + (props.open ? " open" : "") + (props.wide ? " wide" : "") + (props.anchor === "right" ? " right" : ""),
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
          /* @__PURE__ */ jsxRuntime.jsxs(CompPopover, { open: open === "plus", wide: true, anchor: "left", onClose: () => setOpen(""), children: [
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
                sub: m === "plan" ? "只读调研，出计划待批准" : m === "yolo" ? "全部放行不再询问，仅不确定时提问" : "自动执行，仅高危命令需确认"
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
                /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "sparkle", size: 13, color: "var(--c-text2)" }),
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
                        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "sparkle", size: 13, color: "var(--c-text2)" }),
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
                    icon: "sparkle",
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
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "bulb", size: 13, color: "var(--c-text2)" }),
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
        (() => {
          const isStop = props.busy && !props.canSend;
          return /* @__PURE__ */ jsxRuntime.jsx("button", { className: "comp-send", title: props.sendTitle, disabled: !props.canSend && !props.busy, onClick: () => isStop ? props.onStop() : props.onSend(), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: isStop ? "stop" : "send", size: 13 }) });
        })()
      ] }),
      s && (s.estTokens > 0 || s.totalInput != null) && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "comp-stats-row", children: /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { position: "relative", display: "inline-flex" }, children: [
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
            s.cacheMissTotal != null && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "缓存未命中" }),
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                s.cacheMissTotal.toLocaleString(),
                " tok"
              ] })
            ] }),
            s.cacheBreaks != null && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "comp-ctx-row", title: "压缩 / 备用模型 / 重启续跑 / 模式切换发生的轮次——这些轮前缀已知断裂", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: "断点轮" }),
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                s.cacheBreaks,
                " 轮"
              ] })
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
      ] }) })
    ] });
  });
  const BUILTIN_COMPOSER_PROVIDERS = [
    {
      prefix: "@",
      label: "文件",
      source: async (query) => {
        const files = await call$1("repo.files", { query });
        return files.map((f) => ({ label: f, insert: f }));
      }
    }
  ];
  const { notifyRepoChanged: notifyRepoChanged$1 } = pageSdk;
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
      void call$1("agent.task.files", { taskId }).then(async (fs) => {
        var _a2;
        if (cancelled) return;
        setFiles(fs);
        props.onCount(fs.length);
        const target = sel && fs.some((f) => f.path === sel) ? sel : ((_a2 = fs[0]) == null ? void 0 : _a2.path) ?? null;
        setSel(target);
        if (target) {
          const [d, txt] = await Promise.all([
            call$1("agent.task.diff", { taskId, path: target, since }),
            call$1("agent.task.diffText", { taskId, path: target, since })
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
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call$1("app.newWindow", { path: worktreePath }), children: "在 Changes 中打开" }),
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
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tl-scroll", style: { overflowY: "auto", padding: "12px 16px", minWidth: 0 }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontFamily: "var(--mono, monospace)", fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: sel ?? "（选择文件）" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginLeft: "auto", display: "flex", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: !sel, onClick: async () => {
                var _a2;
                if (!sel || !window.confirm(`还原 ${sel} 到会话基线（${baselineSha.slice(0, 8)}）？该文件在本会话的改动将被丢弃。`)) return;
                try {
                  await call$1("agent.task.restore", { taskId, sha: baselineSha, path: sel });
                  await props.onReloadAgents();
                  notifyRepoChanged$1();
                  (_a2 = props.onMutate) == null ? void 0 : _a2.call(props);
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
      void call$1("agent.task.checkpoints", { taskId }).then((x) => {
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
      void call$1("agent.task.diff", { taskId, since: `checkpoint:${viewSha}` }).then((d) => {
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
            var _a2;
            if (!window.confirm(`回滚 worktree 到 ${cp.sha.slice(0, 8)}？该 checkpoint 之后的所有改动将被丢弃（reset --hard）。`)) return;
            try {
              await call$1("agent.task.restore", { taskId, sha: cp.sha });
              props.onViewDiff();
              notifyRepoChanged$1();
              (_a2 = props.onMutate) == null ? void 0 : _a2.call(props);
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
  function ShellsTab(props) {
    var _a2;
    const { taskId, live, tick } = props;
    const [shells, setShells] = react.useState([]);
    const [busyId, setBusyId] = react.useState(null);
    const [selectedId, setSelectedId] = react.useState(null);
    const [detail, setDetail] = react.useState(null);
    const [truncated, setTruncated] = react.useState(false);
    const detailShellRef = react.useRef(null);
    const detailEndRef = react.useRef(null);
    const reload = react.useCallback(() => {
      void call$1("agent.task.shells", { taskId }).then((x) => {
        setShells(x);
        props.onCount(x.filter((s) => s.running).length);
      }).catch(() => {
        setShells([]);
        props.onCount(0);
      });
    }, [taskId]);
    react.useEffect(() => {
      reload();
    }, [reload, tick]);
    react.useEffect(() => {
      const iv = setInterval(reload, 2e3);
      return () => clearInterval(iv);
    }, [reload]);
    react.useEffect(() => {
      var _a3;
      if (!props.focus) return;
      setSelectedId(props.focus.shellId);
      (_a3 = props.onFocused) == null ? void 0 : _a3.call(props);
    }, [(_a2 = props.focus) == null ? void 0 : _a2.ts]);
    react.useEffect(() => {
      if (!selectedId) {
        setDetail(null);
        setTruncated(false);
        detailShellRef.current = null;
        return;
      }
      detailShellRef.current = selectedId;
      let cancelled = false;
      void call$1(
        "agent.shell.output",
        { taskId, shellId: selectedId }
      ).then((r) => {
        if (cancelled) return;
        if (!r) {
          setDetail(null);
          setTruncated(false);
          return;
        }
        setDetail({ output: r.output ?? "", running: r.running ?? false, exitCode: r.exitCode ?? null });
        setTruncated(!!r.truncated);
        requestAnimationFrame(() => {
          var _a3;
          return (_a3 = detailEndRef.current) == null ? void 0 : _a3.scrollIntoView({ block: "end" });
        });
      }).catch(() => {
        if (!cancelled) setDetail(null);
      });
      return () => {
        cancelled = true;
        detailShellRef.current = null;
      };
    }, [selectedId, taskId]);
    react.useEffect(() => {
      return onEvent$1("agent.event", (p) => {
        const { taskId: tid, event } = p;
        if (tid !== taskId || event.type !== "shell-output") return;
        if (!selectedId || event.shellId !== selectedId) return;
        const chunk = event.chunk ?? "";
        if (chunk) {
          setDetail((d) => d ? { ...d, output: d.output + chunk } : { output: chunk, running: true, exitCode: null });
        }
        if (event.eof) {
          reload();
        }
        requestAnimationFrame(() => {
          var _a3;
          return (_a3 = detailEndRef.current) == null ? void 0 : _a3.scrollIntoView({ block: "end" });
        });
      });
    }, [taskId, selectedId, reload]);
    const kill = async (shellId) => {
      setBusyId(shellId);
      try {
        await call$1("agent.task.shellKill", { taskId, shellId });
        reload();
      } catch (e) {
        props.setError(e.message);
      } finally {
        setBusyId(null);
      }
    };
    const fmtDur = (s) => {
      if (!s.running) return `exit ${s.exitCode ?? "-"}`;
      return "运行中";
    };
    const sel = selectedId ? shells.find((s) => s.shellId === selectedId) ?? null : null;
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 14px", borderBottom: "1px solid var(--c-border)" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 12.5 }, children: "后台" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: "agent 命令执行记录（terminal_run 前/后台）· 仅 live 会话有数据" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: reload, children: "刷新" })
      ] }),
      sel ? (
        // ═══ 详情页：命令 + 完整输出 + 元信息 ═══
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setSelectedId(null), children: "← 列表" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-dot", style: { color: sel.running ? "var(--c-amber)" : (sel.exitCode ?? 0) === 0 ? "var(--c-green)" : "var(--c-red)", animation: sel.running ? "tk-pulse 1.2s infinite" : void 0 } }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-shell-cmd", title: sel.command, children: sel.command }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-shell-tm", children: fmtDur(sel) }),
            sel.running && /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn",
                style: { color: "var(--c-red)", borderColor: "color-mix(in srgb, var(--c-red) 38%, transparent)", flex: "none" },
                disabled: busyId === sel.id,
                onClick: () => void kill(sel.id),
                children: "终止"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tl-scroll", style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 14px" }, children: [
            detail === null ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 12 }, children: "加载中…" }) : /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontFamily: "var(--mono, monospace)", fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--c-text)" }, children: [
              detail.output || /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)" }, children: "（无输出）" }),
              /* @__PURE__ */ jsxRuntime.jsx("div", { ref: detailEndRef })
            ] }),
            truncated && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-amber)", fontSize: 11, marginTop: 6 }, children: "⚠ 输出超过 128KB 上限，仅显示尾部" })
          ] })
        ] })
      ) : (
        // ═══ 列表页：全部 shell 条目 ═══
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tl-scroll", style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px", maxWidth: 880, width: "100%", margin: "0 auto" }, children: [
          !live && shells.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 12, marginTop: 20, textAlign: "center" }, children: "重启后后台 shell 不保留（仅 live 会话内存）——时间线里 terminal_poll 的输出仍可回看" }),
          live && shells.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 12, marginTop: 20, textAlign: "center" }, children: "暂无命令执行记录" }),
          shells.map((s) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-shell", style: { cursor: "pointer" }, onClick: () => setSelectedId(s.shellId), children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-shell-h", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-dot", style: { color: s.running ? "var(--c-amber)" : (s.exitCode ?? 0) === 0 ? "var(--c-green)" : "var(--c-red)", animation: s.running ? "tk-pulse 1.2s infinite" : void 0 } }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-shell-cmd", title: s.command, children: s.command }),
              s.foreground ? /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 10, color: "var(--c-text3)", border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", flex: "none" }, children: "前台" }) : null,
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-shell-tm", children: fmtDur(s) }),
              s.running && /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "tool-btn",
                  style: { color: "var(--c-red)", borderColor: "color-mix(in srgb, var(--c-red) 38%, transparent)", flex: "none" },
                  disabled: busyId === s.id,
                  onClick: (e) => {
                    e.stopPropagation();
                    void kill(s.id);
                  },
                  children: "终止"
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { marginLeft: "auto", color: "var(--c-text3)", fontSize: 11, flex: "none" }, children: "详情 ›" })
            ] }),
            s.tail && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-shell-tail", style: { opacity: 0.75 }, children: s.tail })
          ] }, s.id))
        ] })
      )
    ] });
  }
  const SUB_STATE_RANK = (s) => s === "running" ? 0 : s === "failed" || s === "timeout" ? 1 : s === "cancelled" ? 2 : 3;
  const SUB_READONLY_MODES = /* @__PURE__ */ new Set(["review", "explore"]);
  function SubagentsTab(props) {
    var _a2;
    const { taskId, live, tick } = props;
    const [subs, setSubs] = react.useState([]);
    const [selectedId, setSelectedId] = react.useState(null);
    const [detailBlocks, setDetailBlocks] = react.useState([]);
    const [loading, setLoading] = react.useState(false);
    const detailScrollRef = react.useRef(null);
    const stickBottomRef = react.useRef(true);
    const [awayFromBottom, setAwayFromBottom] = react.useState(false);
    const reload = react.useCallback(() => {
      void call$1("agent.subtask.list", { taskId }).then((x) => {
        setSubs(x.subtasks);
        props.onCount(x.running);
      }).catch((e) => {
        props.setError(`子代理列表加载失败：${String(e)}`);
        setSubs([]);
        props.onCount(0);
      });
    }, [taskId]);
    react.useEffect(() => {
      reload();
    }, [reload, tick]);
    react.useEffect(() => {
      const iv = setInterval(reload, 2e3);
      return () => clearInterval(iv);
    }, [reload]);
    react.useEffect(() => {
      var _a3;
      if (!props.focus) return;
      setSelectedId(props.focus.subtaskId);
      (_a3 = props.onFocused) == null ? void 0 : _a3.call(props);
    }, [(_a2 = props.focus) == null ? void 0 : _a2.ts]);
    const stripSubtaskId = (ev) => {
      if (!ev.subtaskId) return ev;
      const { subtaskId: _drop, ...rest } = ev;
      return rest;
    };
    const pullTranscript = react.useCallback(() => {
      if (!selectedId) return;
      setLoading(true);
      void call$1("agent.subtask.transcript", { taskId, subtaskId: selectedId }).then((r) => {
        let blocks = [];
        for (const e of r.events) {
          if (e.kind === "event" && e.event) blocks = reduceBlocks(blocks, stripSubtaskId(e.event));
        }
        if (blocks.length > 0) setDetailBlocks((cur) => cur.length ? cur : blocks);
      }).catch((e) => {
        props.setError(`子代理详情加载失败：${String(e)}`);
      }).finally(() => setLoading(false));
    }, [selectedId, taskId]);
    const onDetailScroll = react.useCallback(() => {
      const el = detailScrollRef.current;
      if (!el) return;
      const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
      stickBottomRef.current = !away;
      setAwayFromBottom((v) => v === away ? v : away);
    }, []);
    const scrollDetailToBottom = react.useCallback((smooth) => {
      const doScroll = () => {
        const el = detailScrollRef.current;
        if (!el) return;
        if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        else el.scrollTop = el.scrollHeight;
        stickBottomRef.current = true;
        setAwayFromBottom(false);
      };
      doScroll();
      requestAnimationFrame(doScroll);
    }, []);
    react.useEffect(() => {
      stickBottomRef.current = true;
    }, [selectedId]);
    react.useEffect(() => {
      if (!stickBottomRef.current) return;
      scrollDetailToBottom();
    }, [detailBlocks, scrollDetailToBottom]);
    react.useEffect(() => {
      if (!selectedId) {
        setDetailBlocks([]);
        return;
      }
      setDetailBlocks([]);
      pullTranscript();
    }, [selectedId, taskId, pullTranscript]);
    react.useEffect(() => {
      if (!selectedId) return;
      return onEvent$1("agent.event", (p) => {
        const { taskId: tid, event } = p;
        if (tid !== taskId) return;
        if (event.subtaskId === selectedId) {
          setDetailBlocks((bs) => reduceBlocks(bs, stripSubtaskId(event)));
        } else if (event.type === "subtask") {
          reload();
        }
      });
    }, [selectedId, taskId]);
    const detailEmpty = detailBlocks.length === 0;
    react.useEffect(() => {
      if (!selectedId || !detailEmpty) return;
      const iv = setInterval(() => {
        pullTranscript();
      }, 1500);
      return () => clearInterval(iv);
    }, [selectedId, detailEmpty, pullTranscript]);
    const sel = subs.find((x) => x.subtaskId === selectedId) ?? null;
    const sorted = [...subs].sort((a, b) => SUB_STATE_RANK(a.state) - SUB_STATE_RANK(b.state) || (a.startedAt > b.startedAt ? 1 : -1));
    const runningCount = subs.filter((x) => x.state === "running").length;
    return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }, children: selectedId === null || !sel ? (
      /* ═══ 列表视图 ═══ */
      /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { padding: "8px 14px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--c-text3)" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text)" }, children: "子代理" }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            "· ",
            subs.length,
            " 个"
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            runningCount,
            " 运行中"
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-sub-list", style: { flex: 1, overflowY: "auto", padding: "8px 14px" }, children: [
          subs.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty", children: "· 尚无子代理 · 主代理发起 task 工具调用即自动创建" }),
          sorted.map((s) => /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              className: "tk-sub-item " + (s.state === "running" ? "running" : s.state === "failed" || s.state === "timeout" ? "fail" : "done"),
              onClick: () => setSelectedId(s.subtaskId),
              role: "button",
              tabIndex: 0,
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "rail", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dot", children: s.state === "running" ? "◐" : "·" }) }),
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "body", children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "title", children: s.name || "子代理" }),
                  /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "meta", children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mode", children: s.mode }),
                    /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                      s.toolCount,
                      " 个工具"
                    ] }),
                    s.fileCount > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                      s.fileCount,
                      " 个文件"
                    ] }),
                    s.permissionBubbles > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                      "冒泡 ",
                      s.permissionBubbles,
                      " 次授权"
                    ] }),
                    s.failureReason && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "fail", children: [
                      "失败：",
                      s.failureReason
                    ] })
                  ] })
                ] }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "du", children: s.durationMs != null ? Math.round(s.durationMs / 100) / 10 + "s" : "" }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "state-badge", children: s.state })
              ]
            },
            s.subtaskId
          ))
        ] })
      ] })
    ) : (
      /* ═══ 详情视图 ═══ */
      /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-sub-detail-head", style: { padding: "6px 14px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--c-text3)" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "back", onClick: () => setSelectedId(null), role: "button", tabIndex: 0, children: "← 返回列表" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 16, color: sel.state === "running" ? "var(--c-amber)" : "var(--c-text3)", animation: sel.state === "running" ? "v47-blink 1s ease-in-out infinite" : void 0 }, children: "◐" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text)", fontWeight: 600, fontSize: 14 }, children: sel.name || "子代理" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "meta", children: [
            sel.durationMs != null ? Math.round(sel.durationMs / 100) / 10 + "s" : "",
            " · ",
            sel.state
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, position: "relative" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tl-scroll", ref: detailScrollRef, onScroll: onDetailScroll, style: { height: "100%", overflowY: "auto", padding: "14px 20px 26px" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { maxWidth: 880, margin: "0 auto" }, children: [
            loading && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 11, textAlign: "center" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tl-pulse", children: "加载中…" }) }),
            !loading && detailBlocks.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty", children: "· 子代理对话为空" }),
            !loading && detailBlocks.length > 0 && (() => {
              const groups = groupTurns(detailBlocks);
              return groups.map((g, i) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
                g.human && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "msg-row human", style: { display: "flex", justifyContent: "flex-end", padding: "8px 0" }, children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "bubble", style: { maxWidth: "78%", background: "var(--c-panel2)", border: "1px solid var(--c-border)", borderRadius: "14px 14px 4px 14px", padding: "10px 14px", fontSize: 14.5, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: g.human.text }) }),
                g.process.map((b, j) => renderSubDetailBlock(b, j, { onJumpToChat: () => {
                  var _a3;
                  return (_a3 = props.onJumpToChat) == null ? void 0 : _a3.call(props);
                } })),
                g.conclusion && /* @__PURE__ */ jsxRuntime.jsx(
                  "div",
                  {
                    className: "assistant",
                    style: { fontSize: 14.5, lineHeight: 1.7, color: "var(--c-text)" },
                    dangerouslySetInnerHTML: { __html: renderMarkdown(g.conclusion.text) }
                  }
                )
              ] }, i));
            })()
          ] }) }),
          awayFromBottom && /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn icon",
              "data-tip": "返回底部",
              "aria-label": "返回底部",
              style: {
                position: "absolute",
                left: "50%",
                bottom: 8,
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
                boxShadow: "0 2px 8px rgba(0,0,0,.22)",
                zIndex: 10
              },
              onClick: () => scrollDetailToBottom(false),
              children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 14 })
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "sub-detail-footer", style: { padding: "8px 14px", fontSize: 11.5, color: "var(--c-text3)", borderTop: "1px solid var(--c-border)", display: "flex", justifyContent: "center", gap: 14, fontFamily: "var(--c-mono)" }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            sel.toolCount,
            " 个工具"
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: "·" }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            detailBlocks.filter((b) => b.kind === "thinking").length,
            " 个思考回合"
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: "·" }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            SUB_READONLY_MODES.has(sel.mode) ? "只读" : "可写",
            "工具面"
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: "·" }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            "冒泡 ",
            sel.permissionBubbles,
            " 次授权"
          ] })
        ] })
      ] })
    ) });
  }
  function renderSubDetailBlock(b, key, ctx) {
    if (b.kind === "subtask") return null;
    if (b.kind === "permission" || b.kind === "question") {
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "sub-row", style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--c-amber) 32%, transparent)", background: "color-mix(in srgb, var(--c-amber) 9%, transparent)" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-amber)" }, children: "⚡" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text)", fontWeight: 600 }, children: "授权" }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text2)", fontSize: 12.5 }, children: [
          "· ",
          b.kind === "permission" ? b.toolName : b.question.slice(0, 60)
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { onClick: ctx.onJumpToChat, role: "button", tabIndex: 0, style: { cursor: "pointer", color: "var(--c-amber)", fontSize: 11.5 }, children: "在主会话页回答 →" })
      ] }, key);
    }
    const def = BUILTIN_TIMELINE_RENDERERS.find((r) => r.blockKind === b.kind);
    if (!def) return null;
    return def.render({ block: b, taskId: "", ctx: { renderChildren: () => null } });
  }
  function TaskWrapupDialog(props) {
    const { task } = props;
    const [check, setCheck] = react.useState(null);
    const [checking, setChecking] = react.useState(true);
    const [strategy, setStrategy] = react.useState("squash");
    const [message, setMessage] = react.useState(task.title);
    const [cleanup, setCleanup] = react.useState(true);
    const [busy, setBusy] = react.useState(false);
    const runCheck = (silent = false) => {
      if (!silent) setChecking(true);
      void call$1("agent.task.mergeCheck", { taskId: task.taskId }).then((c) => setCheck(c)).catch((e) => props.setError(e.message)).finally(() => setChecking(false));
    };
    react.useEffect(() => {
      runCheck();
    }, [task.taskId]);
    const noWorktree = check && !check.ok && check.reason === "NO_WORKTREE";
    const conflicts = (check == null ? void 0 : check.conflicts) && check.conflicts.length > 0 ? check.conflicts : null;
    const canMerge = !!(check == null ? void 0 : check.ok) && check.ahead > 0 && !conflicts && !check.mainDirty && !busy;
    const doMerge = async () => {
      if (!canMerge) return;
      setBusy(true);
      try {
        const r = await call$1("agent.task.merge", { taskId: task.taskId, strategy, message: message.trim() || void 0, cleanup });
        if (r.ok) props.onMerged(r);
        else if (r.conflicts) {
          props.setError(`合并撞上冲突（${r.conflicts.length} 个文件），已恢复现场——可让 Agent 解决后重试`);
          runCheck(true);
        }
      } catch (e) {
        props.setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    const askAgentResolve = async () => {
      if (!check) return;
      try {
        await call$1("agent.task.resume", {
          taskId: task.taskId,
          prompt: [
            `基线分支 ${check.baseBranch} 已前进，与任务分支产生冲突（文件：${(conflicts ?? []).join("、")}）。`,
            "请在任务 worktree 内执行 git merge " + check.baseBranch + "，逐个解决冲突（以基线侧为准除非任务侧有意修改），完成后提交并简要汇报解决方式。"
          ].join("\n")
        });
        props.onClose();
      } catch (e) {
        props.setError(e.message);
      }
    };
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-mask", onMouseDown: (e) => {
      if (e.target === e.currentTarget) props.onClose();
    }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal", onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-head", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "t", children: "合并任务改动" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-monochip", children: task.branch }),
        conflicts && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-pill amber", style: { marginLeft: "auto" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-pill-dot" }),
          "有冲突"
        ] })
      ] }),
      checking && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-modal-sec", style: { color: "var(--c-text3)", fontSize: 12 }, children: "预检中…" }),
      noWorktree && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-modal-sec", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-mhint", children: [
        /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 12 }),
        "当前分支模式（主 worktree）没有独立分支可合并——改动已直接在工作区，请到变更页提交。"
      ] }) }),
      (check == null ? void 0 : check.ok) && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-sec", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lb", children: "合并到分支" }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-monochip", style: { color: "var(--c-text)" }, children: check.baseBranch }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text3)", fontSize: 11 }, children: [
              "任务领先 ",
              /* @__PURE__ */ jsxRuntime.jsx("b", { style: { color: "var(--c-text2)" }, children: check.ahead }),
              " 提交 · 基线领先 ",
              check.behind,
              " 提交",
              check.uncommitted > 0 ? ` · worktree 未提交 ${check.uncommitted} 个文件` : ""
            ] })
          ] }),
          check.mainBranch && check.mainBranch !== check.baseBranch && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-mhint", children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "branch", size: 12 }),
            "主 worktree 当前在 ",
            check.mainBranch,
            "，合并时会切回 ",
            check.baseBranch
          ] }),
          check.mainDirty && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-mhint", children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 12 }),
            "主 worktree 有未提交改动——请先在变更页处理再合并"
          ] }),
          !check.mainDirty && check.uncommitted > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-mhint ok", children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "check", size: 12 }),
            "任务 worktree 的未提交改动将在合并前自动创建「收尾提交」检查点"
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-sec", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lb", children: "合并策略" }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex" }, children: [["squash", "squash 单提交（默认）"], ["merge", "merge --no-ff"]].map(([v, label]) => /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tk-fchip" + (strategy === v ? " on" : ""),
              style: { borderRadius: v === "squash" ? "8px 0 0 8px" : "0 8px 8px 0", padding: "4px 10px", flex: 1, justifyContent: "center" },
              onClick: () => setStrategy(v),
              children: label
            },
            v
          )) }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-mdesc", children: strategy === "squash" ? "压成 1 个干净提交进入基线；消息带 Assisted-by / Gitter-Session trailer。" : "保留全部 checkpoint 提交 + merge 节点；之后可在 Log 页按 Gitter-Session 归组 squash。" })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-sec", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lb", children: "提交消息" }),
          /* @__PURE__ */ jsxRuntime.jsx("textarea", { className: "tk-minput", rows: 2, value: message, onChange: (e) => setMessage(e.target.value) }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-mtrailer", children: [
            "Assisted-by: gitter-agent",
            "\n",
            "Gitter-Session: ",
            task.taskId
          ] })
        ] }),
        check.diffStat && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-modal-sec", children: /* @__PURE__ */ jsxRuntime.jsxs("details", { className: "tk-mdetails", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("summary", { children: [
            "差异预览 · diff --stat（",
            check.ahead,
            " 个提交）"
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "dbody", children: check.diffStat })
        ] }) }),
        conflicts && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-modal-sec", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-conflict", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ct", children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 13 }),
            "预检发现 ",
            conflicts.length,
            " 个冲突文件（git merge-tree）"
          ] }),
          conflicts.map((f) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "cf", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis" }, children: f }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "b", children: "双方修改" })
          ] }, f)),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "cnote", children: [
            "两条出路：① 让 Agent 在任务 worktree 内合并 ",
            check.baseBranch,
            " 并解决冲突，完成后重开此对话框重检；② 放弃合并，任务保持原状。"
          ] })
        ] }) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-modal-sec", children: /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "tk-mcheck", children: [
          /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: cleanup, onChange: (e) => setCleanup(e.target.checked) }),
          "合并后清理 worktree 与 ",
          task.branch,
          " 分支，并归档任务"
        ] }) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-foot", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "left", children: "合并前会重跑预检（防竞态）；主 worktree 必须干净" }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: props.onClose, children: "取消" }),
          conflicts && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void askAgentResolve(), children: "让 Agent 解决冲突" }),
          /* @__PURE__ */ jsxRuntime.jsxs(
            "button",
            {
              className: "tool-btn",
              disabled: !canMerge,
              style: canMerge ? { background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 } : void 0,
              onClick: () => void doMerge(),
              children: [
                /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "branch", size: 12 }),
                "合并"
              ]
            }
          )
        ] })
      ] })
    ] }) });
  }
  function TaskFeedbackDialog(props) {
    const [text, setText] = react.useState("");
    const [busy, setBusy] = react.useState(false);
    const send = async () => {
      if (!text.trim() || busy) return;
      setBusy(true);
      try {
        await call$1("agent.task.feedback", { taskId: props.task.taskId, feedback: text.trim() });
        props.onSent();
        props.onClose();
      } catch (e) {
        props.setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-mask", onMouseDown: (e) => {
      if (e.target === e.currentTarget) props.onClose();
    }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal", style: { width: 480 }, onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-head", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "t", children: "验收反馈" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-monochip", style: { marginLeft: "auto" }, children: props.task.branch })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-sec", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lb", children: "对上一轮改动的验收意见（必填）" }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "textarea",
          {
            className: "tk-minput",
            rows: 4,
            autoFocus: true,
            value: text,
            onChange: (e) => setText(e.target.value),
            placeholder: "例：导出按钮 hover 态不对；build 过了但 e2e 里 files.spec 超时，请修复…"
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-mdesc", children: "反馈将作为新一轮启动（受限提示：Agent 只处理这些条目，不自由发挥）；任务会脱离归档并回到运行态，结果回到对话时间线。" })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-modal-foot", children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: props.onClose, children: "取消" }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "tool-btn",
            disabled: !text.trim() || busy,
            style: text.trim() && !busy ? { background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 } : void 0,
            onClick: () => void send(),
            children: "提交反馈"
          }
        )
      ] })
    ] }) });
  }
  const { call, on: onEvent, t, openSettings, notifyRepoChanged } = pageSdk;
  const LIVE_STATES = /* @__PURE__ */ new Set(["starting", "working", "awaiting-input", "awaiting-permission"]);
  const BUSY_STATES = /* @__PURE__ */ new Set(["starting", "working", "awaiting-permission"]);
  const BUILTIN_SLASH = [
    { name: "compact", hint: "立即压缩上下文" },
    { name: "clear", hint: "重置会话（保留 worktree/checkpoint）" },
    { name: "plan", hint: "切计划模式" },
    { name: "default", hint: "切默认模式" },
    { name: "yolo", hint: "切完全访问模式" },
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
  function stateChip(s, awaitKind) {
    if (s === "awaiting-input") {
      if (awaitKind === "question") return { label: "等你回答", color: "var(--c-amber)" };
      if (awaitKind === "plan") return { label: "待确认计划", color: "var(--c-chip-purple-fg, #b490ff)" };
      return { label: "已完成", color: "var(--c-text3)" };
    }
    switch (s) {
      case "starting":
        return { label: "启动中", color: "var(--c-text3)" };
      case "working":
        return { label: "执行中", color: "var(--c-green)" };
      case "awaiting-permission":
        return { label: "待确认", color: "var(--c-amber)" };
      case "completed":
        return { label: "已完成", color: "var(--c-accent)" };
      case "failed":
        return { label: "失败", color: "var(--c-red)" };
      case "interrupted":
        return { label: "已中断", color: "var(--c-amber)" };
      case "stopped":
        return { label: "已停止", color: "var(--c-text3)" };
    }
  }
  function taskCategory(t2) {
    if (t2.state === "starting" || t2.state === "working") return "run";
    if (t2.state === "awaiting-permission") return "ask";
    if (t2.state === "awaiting-input") return t2.awaitKind ? "ask" : "done";
    if (t2.state === "failed" || t2.state === "interrupted" || t2.state === "stopped") return "err";
    return "done";
  }
  function dateGroupOf(iso) {
    const ts = iso ? new Date(iso).getTime() : 0;
    if (!ts) return "older";
    const now = /* @__PURE__ */ new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return "today";
    if (ts >= startOfToday - 864e5) return "yesterday";
    if (ts >= startOfToday - 7 * 864e5) return "week";
    return "older";
  }
  const DATE_GROUPS = [
    { id: "today", label: "今天" },
    { id: "yesterday", label: "昨天" },
    { id: "week", label: "近 7 天" },
    { id: "older", label: "更早" }
  ];
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
  let builtinAgentUIDone = false;
  function registerBuiltinAgentUI() {
    if (builtinAgentUIDone || typeof window === "undefined" || !window.GITTER_UI) return;
    builtinAgentUIDone = true;
    registerAgentUI({ timelineRenderers: BUILTIN_TIMELINE_RENDERERS, composerProviders: BUILTIN_COMPOSER_PROVIDERS });
  }
  registerBuiltinAgentUI();
  function TasksPage() {
    var _a2, _b2, _c, _d, _e;
    const app = useAppState();
    const repo = app.repo;
    const [worktrees, setWorktrees] = react.useState(null);
    const [harnesses, setHarnesses] = react.useState(null);
    const [agentTasks, setAgentTasks] = react.useState(null);
    const [listQuery, setListQuery] = react.useState("");
    const [listFilter, setListFilter] = react.useState(() => {
      const v = localStorage.getItem("gitter.taskListFilter");
      return v === "run" || v === "ask" || v === "done" || v === "err" ? v : "all";
    });
    const [listSort, setListSort] = react.useState(() => {
      const v = localStorage.getItem("gitter.taskListSort");
      return v === "created" || v === "title" ? v : "active";
    });
    const [listPop, setListPop] = react.useState(null);
    const [selecting, setSelecting] = react.useState(false);
    const [picked, setPicked] = react.useState(/* @__PURE__ */ new Set());
    const [archOpen, setArchOpen] = react.useState(() => localStorage.getItem("gitter.taskArchOpen") === "1");
    const [renamingId, setRenamingId] = react.useState(null);
    const [delPopId, setDelPopId] = react.useState(null);
    const [shellRunning, setShellRunning] = react.useState(0);
    const [subagentCount, setSubagentCount] = react.useState(0);
    const [shellFocus, setShellFocus] = react.useState(null);
    const [subagentFocus, setSubagentFocus] = react.useState(null);
    const subtaskStartRef = react.useRef(/* @__PURE__ */ new Map());
    const subtaskStartAt = (b) => {
      const m = subtaskStartRef.current;
      if (!m.has(b.subtaskId)) m.set(b.subtaskId, Date.now());
      return m.get(b.subtaskId);
    };
    const [wrapupOpen, setWrapupOpen] = react.useState(false);
    const [feedbackOpen, setFeedbackOpen] = react.useState(false);
    const [taskTypes, setTaskTypes] = react.useState([]);
    const [modelProfiles, setModelProfiles] = react.useState([]);
    const [taskTypeId, setTaskTypeId] = react.useState("");
    const [modelId, setModelId] = react.useState("");
    const [mode, setMode] = react.useState("default");
    const [tab, setTab] = react.useState("chat");
    const [verboseTimeline, setVerboseTimeline] = react.useState(false);
    const [branchHintOpen, setBranchHintOpen] = react.useState(false);
    const composerDockRef = react.useRef(null);
    const streamInnerRef = react.useRef(null);
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
    const sendingRef = react.useRef(false);
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
    const [expandedTurns, setExpandedTurns] = react.useState(() => /* @__PURE__ */ new Set());
    const toggleTurn = (anchor) => {
      setExpandedTurns((s) => {
        const n = new Set(s);
        if (n.has(anchor)) n.delete(anchor);
        else n.add(anchor);
        return n;
      });
    };
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
    const [changesPanelOpen, setChangesPanelOpen] = react.useState(false);
    const [queuedHints, setQueuedHints] = react.useState({});
    const addQueuedHint = (taskId, text) => setQueuedHints((m) => {
      const cur = m[taskId] ?? [];
      const next = [text];
      next.splice(0, 1, ...cur.slice(-5));
      return { ...m, [taskId]: next };
    });
    const detailRef = react.useRef(null);
    const [pageVisible, setPageVisible] = react.useState(true);
    const [, setTitlebarTick] = react.useState(0);
    react.useEffect(() => {
      const el = detailRef.current;
      if (!el || typeof IntersectionObserver === "undefined") return;
      const io = new IntersectionObserver((entries) => {
        var _a3;
        return setPageVisible(((_a3 = entries[entries.length - 1]) == null ? void 0 : _a3.isIntersecting) ?? true);
      });
      io.observe(el);
      return () => io.disconnect();
    }, []);
    react.useEffect(() => {
      if (document.getElementById("tbPageActions")) {
        setTitlebarTick((x) => x + 1);
        return;
      }
      let tries = 0;
      const timer = window.setInterval(() => {
        if (document.getElementById("tbPageActions") || ++tries > 50) {
          window.clearInterval(timer);
          setTitlebarTick((x) => x + 1);
        }
      }, 100);
      return () => window.clearInterval(timer);
    }, []);
    const TASK_LIST_MIN_W = 210;
    const TASK_LIST_MAX_W = 520;
    const [listWidth, setListWidth] = react.useState(() => {
      const v = Number(localStorage.getItem("gitter.taskListWidth"));
      if (Number.isFinite(v) && v >= TASK_LIST_MIN_W && v <= TASK_LIST_MAX_W) return Math.round(v);
      const legacy = Number(localStorage.getItem("gitter.taskListRatio"));
      localStorage.removeItem("gitter.taskListRatio");
      if (Number.isFinite(legacy) && legacy >= 0.12 && legacy <= 0.5) {
        return Math.max(TASK_LIST_MIN_W, Math.min(TASK_LIST_MAX_W, Math.round(legacy * window.innerWidth)));
      }
      return 300;
    });
    const [splitRatio, setSplitRatio] = react.useState(() => {
      localStorage.removeItem("gitter.taskSplitChatW");
      const v = Number(localStorage.getItem("gitter.taskSplitRatio"));
      return Number.isFinite(v) && v >= 0.2 && v <= 0.85 ? v : 4 / 7;
    });
    const panelTemplate = (r) => {
      const rr = Number.isFinite(r) ? Math.min(0.85, Math.max(0.2, r)) : 4 / 7;
      return `minmax(280px, ${rr.toFixed(4)}fr) 6px minmax(280px, ${(1 - rr).toFixed(4)}fr)`;
    };
    const PANEL_TRANSFORM_TRANSITION = "transform 400ms var(--ease-std)";
    const panelWrapRef = react.useRef(null);
    const panelTimerRef = react.useRef(null);
    const closeWRef = react.useRef(0);
    const panelTargetRef = react.useRef(true);
    const [panelClosing, setPanelClosing] = react.useState(false);
    const panelClosingRef = react.useRef(false);
    const openRef = react.useRef(changesPanelOpen);
    panelClosingRef.current = panelClosing;
    openRef.current = changesPanelOpen;
    const clearPanelTimer = () => {
      if (panelTimerRef.current != null) {
        window.clearTimeout(panelTimerRef.current);
        panelTimerRef.current = null;
      }
    };
    const finishOpenCleanup = () => {
      const wrap = panelWrapRef.current;
      if (wrap) {
        wrap.style.transition = "";
        wrap.style.transform = "";
      }
      panelTimerRef.current = null;
    };
    const slideWrap = (offscreen) => {
      const wrap = panelWrapRef.current;
      if (!wrap) return;
      wrap.style.transition = PANEL_TRANSFORM_TRANSITION;
      wrap.style.transform = offscreen ? "translateX(100%)" : "translateX(0)";
    };
    const animatePanel = (open) => {
      panelTargetRef.current = open;
      clearPanelTimer();
      if (open) {
        if (panelClosingRef.current) {
          setPanelClosing(false);
          return;
        }
        if (openRef.current) return;
        setChangesPanelOpen(true);
      } else {
        if (!openRef.current) return;
        if (panelClosingRef.current) return;
        const wrap = panelWrapRef.current;
        if (!wrap) {
          setChangesPanelOpen(false);
          return;
        }
        closeWRef.current = wrap.offsetWidth;
        setPanelClosing(true);
      }
    };
    const closePanel = () => animatePanel(false);
    const togglePanel = () => animatePanel(!panelTargetRef.current);
    const prevOpenRef = react.useRef(changesPanelOpen);
    react.useLayoutEffect(() => {
      const wasOpen = prevOpenRef.current;
      prevOpenRef.current = changesPanelOpen;
      if (!changesPanelOpen || wasOpen) return;
      const wrap = panelWrapRef.current;
      if (!wrap) return;
      wrap.style.transition = "none";
      wrap.style.transform = "translateX(100%)";
      void wrap.offsetWidth;
      slideWrap(false);
      panelTimerRef.current = window.setTimeout(finishOpenCleanup, 420);
    }, [changesPanelOpen]);
    const prevClosingRef = react.useRef(panelClosing);
    react.useLayoutEffect(() => {
      const was = prevClosingRef.current;
      prevClosingRef.current = panelClosing;
      if (panelClosing && !was) {
        const wrap = panelWrapRef.current;
        if (!wrap) {
          setChangesPanelOpen(false);
          setPanelClosing(false);
          return;
        }
        void wrap.offsetWidth;
        slideWrap(true);
        panelTimerRef.current = window.setTimeout(() => {
          panelTimerRef.current = null;
          setChangesPanelOpen(false);
          setPanelClosing(false);
        }, 420);
      } else if (!panelClosing && was && openRef.current) {
        slideWrap(false);
        panelTimerRef.current = window.setTimeout(finishOpenCleanup, 420);
      }
    }, [panelClosing]);
    const startListDrag = (e) => {
      e.preventDefault();
      const grip = e.currentTarget;
      const main = grip.parentElement;
      if (!main) return;
      grip.classList.add("drag");
      let px = listWidth;
      const move = (ev) => {
        const rect = main.getBoundingClientRect();
        px = Math.round(Math.max(TASK_LIST_MIN_W, Math.min(TASK_LIST_MAX_W, ev.clientX - rect.left, rect.width - 346)));
        main.style.gridTemplateColumns = `${px}px 6px minmax(0, 1fr)`;
      };
      const up = () => {
        grip.classList.remove("drag");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setListWidth(px);
        localStorage.setItem("gitter.taskListWidth", String(px));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    const startSplitDrag = (e) => {
      e.preventDefault();
      const grip = e.currentTarget;
      const split = grip.parentElement;
      if (!split) return;
      grip.classList.add("drag");
      const move = (ev) => {
        const rect = split.getBoundingClientRect();
        const r = Math.max(0.2, Math.min(0.8, (ev.clientX - rect.left - 3) / rect.width));
        split.style.gridTemplateColumns = `minmax(340px, ${r.toFixed(4)}fr) 6px minmax(280px, ${(1 - r).toFixed(4)}fr)`;
      };
      const up = () => {
        grip.classList.remove("drag");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const m = split.style.gridTemplateColumns.match(/([0-9.]+)fr/);
        if (m) {
          const r = Number(m[1]);
          setSplitRatio(r);
          localStorage.setItem("gitter.taskSplitRatio", String(r));
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    const [panelReq, setPanelReq] = react.useState(null);
    const previewFile = react.useCallback((path) => {
      setPanelReq({ path, mode: "preview", ts: Date.now() });
      setTab("chat");
      animatePanel(true);
    }, []);
    const [cpCount, setCpCount] = react.useState(0);
    const [diffCount, setDiffCount] = react.useState(0);
    const [awayFromBottom, setAwayFromBottom] = react.useState(false);
    const stickBottomRef = react.useRef(true);
    const timelineRef = react.useRef(null);
    const lastChatScrollRef = react.useRef(null);
    const loadOlderRef = react.useRef(null);
    const onTimelineScroll = react.useCallback(() => {
      var _a3;
      const el = timelineRef.current;
      if (!el) return;
      const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
      stickBottomRef.current = !away;
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
        stickBottomRef.current = true;
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
        setAgentTasks(await call("agent.tasks", { includeArchived: true }));
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
        if (s == null ? void 0 : s.agentsBusySend) setBusySend(s.agentsBusySend);
      }).catch(() => {
      });
    }, []);
    const [busySend, setBusySend] = react.useState("queue");
    react.useEffect(
      () => onEvent("agent.event", (p) => {
        const { taskId, event } = p;
        setEvMap((m) => ({ ...m, [taskId]: reduceBlocks(m[taskId] ?? [], event) }));
        if (event.type === "queued-drained" && (event.queuedDrained ?? 0) > 0) {
          setQueuedHints((m) => {
            const n = Math.min(event.queuedDrained ?? 0, (m[taskId] ?? []).length);
            if (n === 0) return m;
            const left = (m[taskId] ?? []).slice(n);
            const out = {};
            for (const [k, v] of Object.entries(m)) if (v.length) out[k] = v;
            out[taskId] = left;
            if (!left.length) delete out[taskId];
            return out;
          });
        }
        if (event.type === "turn-completed" || event.type === "completed") {
          void reloadAgents();
          setChangesTick((n) => n + 1);
        }
        if (event.type === "file-change" || event.type === "checkpoint") setChangesTick((n) => n + 1);
      }),
      [reloadAgents]
    );
    react.useEffect(
      () => onEvent("agent.tasks.changed", () => void reloadAgents()),
      [reloadAgents]
    );
    react.useEffect(() => {
      if (!selectedTask) {
        setDiffCount(0);
        setCpCount(0);
        return;
      }
      let cancelled = false;
      void call("agent.task.files", { taskId: selectedTask }).then((fs) => {
        if (!cancelled) setDiffCount(fs.length);
      }).catch(() => {
      });
      void call("agent.task.checkpoints", { taskId: selectedTask }).then((x) => {
        if (!cancelled) setCpCount(x.length);
      }).catch(() => {
      });
      return () => {
        cancelled = true;
      };
    }, [selectedTask, changesTick]);
    const selected = (agentTasks == null ? void 0 : agentTasks.find((x) => x.taskId === selectedTask)) ?? null;
    (agentTasks ?? []).filter((x) => LIVE_STATES.has(x.state)).length;
    const listQ = listQuery.trim().toLowerCase();
    const listHit = (t2) => !listQ || t2.title.toLowerCase().includes(listQ) || (t2.lastMessage ?? "").toLowerCase().includes(listQ) || t2.taskId.slice(0, 8).includes(listQ);
    const visibleTasks = (agentTasks ?? []).filter((t2) => {
      if (t2.archived) return archOpen && listFilter === "all" && listHit(t2);
      if (listFilter !== "all" && taskCategory(t2) !== listFilter) return false;
      return listHit(t2);
    });
    const listCounts = {
      all: (agentTasks ?? []).filter((t2) => !t2.archived).length,
      run: (agentTasks ?? []).filter((t2) => !t2.archived && taskCategory(t2) === "run").length,
      ask: (agentTasks ?? []).filter((t2) => !t2.archived && taskCategory(t2) === "ask").length,
      done: (agentTasks ?? []).filter((t2) => !t2.archived && taskCategory(t2) === "done").length,
      err: (agentTasks ?? []).filter((t2) => !t2.archived && taskCategory(t2) === "err").length,
      arch: (agentTasks ?? []).filter((t2) => t2.archived).length
    };
    const sortRows = (rows) => {
      if (listSort === "title") return [...rows].sort((a, b) => a.title.localeCompare(b.title, "zh"));
      if (listSort === "created") return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return rows;
    };
    const groupedTasks = DATE_GROUPS.map((g) => ({ ...g, tasks: sortRows(visibleTasks.filter((t2) => dateGroupOf(t2.lastActiveAt ?? t2.createdAt) === g.id)) })).filter((g) => g.tasks.length > 0);
    react.useEffect(() => {
      if (!listPop) return;
      const close = (e) => {
        var _a3, _b3;
        if ((_b3 = (_a3 = e.target) == null ? void 0 : _a3.closest) == null ? void 0 : _b3.call(_a3, ".tk-pop, .tk-tbtn")) return;
        setListPop(null);
      };
      window.addEventListener("mousedown", close);
      return () => window.removeEventListener("mousedown", close);
    }, [listPop]);
    const enterSelect = () => {
      setListPop(null);
      setPicked(/* @__PURE__ */ new Set());
      setSelecting(true);
    };
    const exitSelect = () => {
      setSelecting(false);
      setPicked(/* @__PURE__ */ new Set());
    };
    const togglePick = (taskId) => setPicked((s) => {
      const n = new Set(s);
      if (n.has(taskId)) n.delete(taskId);
      else n.add(taskId);
      return n;
    });
    const pickAllVisible = () => setPicked(new Set(visibleTasks.filter((t2) => !t2.archived).map((t2) => t2.taskId)));
    const archivePicked = async () => {
      const ids = [...picked];
      if (ids.length === 0) return;
      try {
        for (const id of ids) await call("agent.task.archive", { taskId: id, archived: true });
        exitSelect();
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      }
    };
    const runningTool = (() => {
      if (!selectedTask) return null;
      if (!selected || !LIVE_STATES.has(selected.state)) return null;
      const blocks = evMap[selectedTask] ?? [];
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b.kind === "tool" && b.state === "running") return b;
      }
      return null;
    })();
    const runningSubs = selectedTask && selected && taskCategory(selected) === "run" ? (evMap[selectedTask] ?? []).filter((b) => b.kind === "subtask" && b.state === "running").length : 0;
    react.useEffect(() => {
      setStats(null);
    }, [selectedTask]);
    react.useEffect(() => {
      setExpandedTurns(/* @__PURE__ */ new Set());
    }, [selectedTask]);
    react.useEffect(() => {
      if (!selectedTask) {
        setShellRunning(0);
        return;
      }
      let cancelled = false;
      const pull = () => {
        void call("agent.context.stats", { taskId: selectedTask }).then((s) => {
          if (!cancelled) setStats(s);
        }).catch(() => {
        });
        void call("agent.task.shells", { taskId: selectedTask }).then((x) => {
          if (!cancelled) setShellRunning(x.filter((s) => s.running).length);
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
      if (!delPopId) return;
      const close = (e) => {
        var _a3, _b3;
        if ((_b3 = (_a3 = e.target) == null ? void 0 : _a3.closest) == null ? void 0 : _b3.call(_a3, ".tk-delpop")) return;
        setDelPopId(null);
      };
      const esc = (e) => {
        if (e.key === "Escape") setDelPopId(null);
      };
      window.addEventListener("mousedown", close);
      window.addEventListener("keydown", esc);
      return () => {
        window.removeEventListener("mousedown", close);
        window.removeEventListener("keydown", esc);
      };
    }, [delPopId]);
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
      stickBottomRef.current = true;
    }, [selectedTask]);
    react.useEffect(() => {
      if (skippingAutoScroll.current) {
        skippingAutoScroll.current = false;
        return;
      }
      if (!stickBottomRef.current) return;
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
    react.useEffect(() => {
      const h = (e) => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "o" || e.key === "O")) {
          e.preventDefault();
          setVerboseTimeline((v) => !v);
        }
      };
      window.addEventListener("keydown", h);
      return () => window.removeEventListener("keydown", h);
    }, []);
    react.useEffect(() => {
      const dock = composerDockRef.current, inner = streamInnerRef.current;
      if (!dock || !inner || typeof ResizeObserver === "undefined") return;
      const fit = () => {
        inner.style.paddingBottom = `${dock.offsetHeight + 56}px`;
      };
      const ro = new ResizeObserver(fit);
      ro.observe(dock);
      fit();
      return () => ro.disconnect();
    }, [selected]);
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
      if (!selected || !inputText.trim() || sendingRef.current) return;
      sendingRef.current = true;
      try {
        await sendInputInner();
      } finally {
        sendingRef.current = false;
      }
    };
    const sendInputInner = async () => {
      var _a3;
      if (!selected || !inputText.trim()) return;
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
              if (BUSY_STATES.has(selected.state)) {
                await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded });
                addQueuedHint(selected.taskId, expanded);
              } else await call("agent.task.resume", { taskId: selected.taskId, prompt: expanded, thinking, mode });
              setInputText("");
              return;
            }
            if (name === "compact") await call("agent.task.compact", { taskId: selected.taskId });
            else if (name === "clear") await call("agent.task.clear", { taskId: selected.taskId });
            else if (name === "cp") {
              await call("agent.task.checkpoint", { taskId: selected.taskId, summary: arg || "手动检查点（/cp）" });
              notifyRepoChanged();
            } else if (name === "diff") {
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
              if (BUSY_STATES.has(selected.state)) {
                await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded });
                addQueuedHint(selected.taskId, expanded);
              } else await call("agent.task.resume", { taskId: selected.taskId, prompt: expanded, thinking, mode });
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
      const busy2 = BUSY_STATES.has(selected.state);
      if (busy2 && busySend === "block") {
        setError("agent 正在运行，发送已被禁止——可在 设置 → Agent 运行时 →「运行中发送」改为排队/插话，或先停止本轮");
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
      try {
        if (busy2) {
          if (attachments.length > 0) setError("任务运行中：图片将不随排队消息注入，请等本轮结束再发送");
          await call("agent.task.queue", { taskId: selected.taskId, prompt: text, ...busySend === "interrupt" ? { interrupt: true } : {} });
          if (busySend !== "interrupt") addQueuedHint(selected.taskId, text);
        } else {
          try {
            await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking, mode, ...attachments.length > 0 ? { attachments } : {} });
          } catch (e) {
            const msg = e.message ?? "";
            if (!/排队/.test(msg)) throw e;
            setError("agent 正在等待你对上方卡片的回答：输入已排队，回合结束后自动注入");
            await call("agent.task.queue", { taskId: selected.taskId, prompt: text });
            addQueuedHint(selected.taskId, text);
          }
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
      if (!composeText.trim() || sendingRef.current) return;
      sendingRef.current = true;
      if (composeText.trim().startsWith("/")) {
        const cmd = composeText.trim().split(/\s+/)[0].slice(1);
        if (cmd === "attach") {
          (_a3 = imageInputRef.current) == null ? void 0 : _a3.click();
          setComposeText("");
          sendingRef.current = false;
          return;
        }
        setError(`命令 /${cmd} 需在具体任务的对话中使用（新任务页仅支持 /attach）`);
        sendingRef.current = false;
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
        sendingRef.current = false;
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
    const archiveTask = async (taskId, archived) => {
      try {
        await call("agent.task.archive", { taskId, archived });
        if (archived && selectedTask === taskId) setSelectedTask(null);
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      }
    };
    const renameTask = async (taskId, title) => {
      try {
        await call("agent.task.rename", { taskId, title });
        await reloadAgents();
      } catch (e) {
        setError(e.message);
      }
    };
    const deleteTaskRow = async (taskId, cleanup) => {
      try {
        const r = await call("agent.task.delete", { taskId, cleanup });
        setDelPopId(null);
        if (selectedTask === taskId) setSelectedTask(null);
        await reloadAgents();
        if (cleanup && r.cleanup && !r.cleanup.worktreeRemoved) {
          setError("记录已删除；worktree/分支清理失败（可能被占用），可到 Worktree 页手动移除");
        }
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
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (navKeyDown(e, inputText, setInputText)) return;
      if (e.key === "Enter" && !e.repeat && !e.shiftKey) {
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
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (navKeyDown(e, composeText, setComposeText)) return;
      if (e.key === "Enter" && !e.repeat && !e.shiftKey) {
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
    const copyBlocks = (() => {
      const out = /* @__PURE__ */ new Set();
      for (let i = 0; i < timeline.length; i++) {
        const b = timeline[i];
        if (b.kind !== "assistant") continue;
        let conclusion = true;
        for (let j = i + 1; j < timeline.length; j++) {
          const k = timeline[j].kind;
          if (k === "assistant" || k === "tool" || k === "subtask" || k === "thinking" || k === "plan") {
            conclusion = false;
            break;
          }
          if (k === "turn" || k === "checkpoint" || k === "human") break;
        }
        if (conclusion) out.add(b);
      }
      return out;
    })();
    const renderBlock = (b, key, process = false) => {
      const live = selected ? LIVE_STATES.has(selected.state) : true;
      const block = !live && b.kind === "tool" && b.state === "running" ? { ...b, state: "aborted", durationMs: b.durationMs ?? Date.now() - b.startTs } : b;
      switch (block.kind) {
        case "permission":
          return null;
        case "question":
          return /* @__PURE__ */ jsxRuntime.jsx(QuestionCard, { b: block, decided: decided[block.requestId], onAnswer: replyAnswer }, key);
        case "plan":
          return /* @__PURE__ */ jsxRuntime.jsx(PlanCard, { b: block, decided: decided[block.requestId], onPlan: replyPlan }, key);
        case "todo":
          return null;
      }
      const renderer = resolveTimelineRenderer(block.kind === "tool" ? block.name : void 0, block.kind);
      if (!renderer) return null;
      const ctx = {
        taskId: selectedTask ?? "",
        viewFile: (path) => {
          setPendingFile(path);
          setPanelReq({ path, mode: "diff", ts: Date.now() });
          setTab("chat");
          animatePanel(true);
        },
        previewFile,
        openShell: (shellId) => {
          setShellFocus({ shellId, ts: Date.now() });
          setTab("shells");
        },
        openSubagent: (subtaskId) => {
          setSubagentFocus({ subtaskId, ts: Date.now() });
          setTab("subagents");
        },
        contextPct: stats ? `${Math.round(stats.ratio * 100)}%` : void 0,
        showCopy: !process && copyBlocks.has(block),
        verbose: verboseTimeline,
        renderChildren: (children) => /* @__PURE__ */ jsxRuntime.jsx(react.Fragment, { children: children.map((c, i) => renderBlock(c, `${key}-${i}`, true)) })
      };
      return /* @__PURE__ */ jsxRuntime.jsx(react.Fragment, { children: renderer.render({ block, taskId: ctx.taskId ?? "", ctx }) }, key);
    };
    const renderProcess = (prefix, list) => {
      const entries = [];
      let fileRun = [];
      const flushFiles = () => {
        if (fileRun.length === 0) return;
        if (fileRun.length > 1) entries.push({ k: "files", items: fileRun });
        else entries.push({ k: "one", b: fileRun[0] });
        fileRun = [];
      };
      const editedPaths = /* @__PURE__ */ new Set();
      for (const b of list) {
        if (b.kind === "tool" && (b.name === "file_patch" || b.name === "file_write")) {
          try {
            const a = b.args;
            if (typeof (a == null ? void 0 : a.path) === "string") editedPaths.add(a.path);
          } catch {
          }
        }
      }
      const list2 = list.filter((b) => !(b.kind === "assistant" && !b.text.trim()));
      for (const b of list2) {
        if (b.kind === "file" && b.changeKind !== "read-image") {
          if (editedPaths.has(b.path)) continue;
          fileRun.push(b);
          continue;
        }
        flushFiles();
        entries.push({ k: "one", b });
      }
      flushFiles();
      const fgCtx = { taskId: selectedTask ?? "", viewFile: (path) => {
        setPendingFile(path);
        setPanelReq({ path, mode: "diff", ts: Date.now() });
        setTab("chat");
        animatePanel(true);
      }, previewFile };
      const TIGHT = /* @__PURE__ */ new Set(["tool", "thinking", "checkpoint"]);
      const groups = [];
      let runBuf = null;
      const flushRun = () => {
        if (runBuf && runBuf.length) groups.push({ k: "run", items: runBuf });
        runBuf = null;
      };
      for (const en of entries) {
        if (en.k === "one" && TIGHT.has(en.b.kind)) {
          (runBuf ?? (runBuf = [])).push(en.b);
          continue;
        }
        flushRun();
        groups.push(en);
      }
      flushRun();
      return groups.map((en, li) => {
        const key = `${prefix}${li}`;
        if (en.k === "run") {
          return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "v47-run", children: en.items.map((b, j) => renderBlock(b, `${key}-${j}`, true)) }, key);
        }
        if (en.k === "files") return /* @__PURE__ */ jsxRuntime.jsx(FileGroup, { items: en.items, ctx: fgCtx }, key);
        if (en.k === "logs") {
          return /* @__PURE__ */ jsxRuntime.jsxs("details", { style: { fontSize: 11 }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("summary", { style: { cursor: "pointer", color: "var(--c-text3)" }, children: [
              "▸ 显示 ",
              en.items.length,
              " 条日志"
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }, children: en.items.map((b, j) => renderBlock(b, `${key}-${j}`)) })
          ] }, key);
        }
        return renderBlock(en.b, key);
      });
    };
    const agentCard = (task) => {
      const live = LIVE_STATES.has(task.state);
      const selectedNow = selectedTask === task.taskId;
      const chip = stateChip(task.state, task.awaitKind);
      const dotColor = task.state === "failed" ? "var(--c-red)" : task.state === "interrupted" ? "var(--c-amber)" : task.state === "awaiting-input" ? task.awaitKind === "question" ? "var(--c-amber)" : task.awaitKind === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-text3)" : task.state === "stopped" || task.state === "completed" ? "var(--c-text3)" : task.permissionMode === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-green)";
      const working = task.state === "working" || task.state === "starting";
      const pickable = selecting && !task.archived;
      return /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "tk-row" + (selectedNow ? " sel" : "") + (task.archived ? " arch" : "") + (picked.has(task.taskId) ? " picked" : ""),
          onClick: () => {
            if (pickable) {
              togglePick(task.taskId);
              return;
            }
            if (selecting) return;
            setSelectedTask(selectedNow ? null : task.taskId);
            setTab("chat");
            setThinking(task.thinking ?? "medium");
            setMode(task.permissionMode ?? "default");
          },
          title: `${task.title}
${chip.label} · ${task.branch}${task.wrapup ? ` · 已合并 ${task.wrapup.mergeSha.slice(0, 8)}` : ""}${task.archived ? " · 已归档" : ""}`,
          children: [
            pickable && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-selbox", onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: picked.has(task.taskId), onChange: () => togglePick(task.taskId) }) }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-dot" + (working ? " run" : ""), style: { color: dotColor } }),
            renamingId === task.taskId ? /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                className: "tk-ren",
                autoFocus: true,
                defaultValue: task.title,
                onClick: (e) => e.stopPropagation(),
                onKeyDown: (e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    const v = e.target.value.trim();
                    setRenamingId(null);
                    if (v && v !== task.title) void renameTask(task.taskId, v);
                  } else if (e.key === "Escape") setRenamingId(null);
                },
                onBlur: (e) => {
                  const v = e.target.value.trim();
                  setRenamingId(null);
                  if (v && v !== task.title) void renameTask(task.taskId, v);
                }
              },
              `ren-${task.taskId}`
            ) : /* @__PURE__ */ jsxRuntime.jsx(
              "span",
              {
                className: "tk-row-title",
                title: selecting ? void 0 : "双击重命名",
                onDoubleClick: selecting ? void 0 : (e) => {
                  e.stopPropagation();
                  setRenamingId(task.taskId);
                },
                children: task.title
              }
            ),
            task.wrapup ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-mtag", children: "已合并" }) : null,
            !selecting && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-quick", children: [
              task.archived ? /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "icon-btn",
                  title: "恢复到列表（取消归档）",
                  onClick: (e) => {
                    e.stopPropagation();
                    void archiveTask(task.taskId, false);
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 13 })
                }
              ) : /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "icon-btn",
                  title: live ? "运行中不可分叉，请先停止" : "分叉任务（复制对话历史到新分支）",
                  disabled: live,
                  onClick: (e) => {
                    e.stopPropagation();
                    void forkTask(task.taskId);
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "fork", size: 13 })
                }
              ),
              !task.archived && /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "icon-btn",
                  title: live ? "运行中不可归档，请先停止" : "归档任务（从列表隐藏，可恢复）",
                  disabled: live,
                  onClick: (e) => {
                    e.stopPropagation();
                    void archiveTask(task.taskId, true);
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "archive", size: 13 })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "icon-btn",
                  title: "删除任务（会话记录与 journal；可选清理 worktree/分支）",
                  onClick: (e) => {
                    e.stopPropagation();
                    setDelPopId(delPopId === task.taskId ? null : task.taskId);
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "trash", size: 13 })
                }
              )
            ] }),
            delPopId === task.taskId && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-delpop", onClick: (e) => e.stopPropagation(), children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "t", children: "删除任务？" }),
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "d", children: "会话记录、journal 与附件将一并删除，不可恢复。" }),
              /* @__PURE__ */ jsxRuntime.jsxs("label", { children: [
                /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", id: `delclean-${task.taskId}`, defaultChecked: true }),
                "同时清理 worktree 与 task/* 分支"
              ] }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "b", children: [
                /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setDelPopId(null), children: "取消" }),
                /* @__PURE__ */ jsxRuntime.jsx(
                  "button",
                  {
                    className: "tool-btn",
                    style: { color: "var(--c-red)", borderColor: "color-mix(in srgb, var(--c-red) 38%, transparent)" },
                    onClick: () => {
                      const el = document.getElementById(`delclean-${task.taskId}`);
                      void deleteTaskRow(task.taskId, (el == null ? void 0 : el.checked) ?? true);
                    },
                    children: "删除"
                  }
                )
              ] })
            ] })
          ]
        },
        task.taskId
      );
    };
    const busy = selected ? BUSY_STATES.has(selected.state) : false;
    const idle = selected ? !LIVE_STATES.has(selected.state) : false;
    const isWorktreeTask = !!((_b2 = selected == null ? void 0 : selected.branch) == null ? void 0 : _b2.startsWith("task/"));
    const showWrapbar = !!selected && idle && isWorktreeTask && (diffCount > 0 || !!selected.wrapup);
    const showCommitHint = !!selected && idle && !isWorktreeTask && diffCount > 0;
    const busyHint = (() => {
      if (runningTool) {
        const label = TOOL_LABELS[runningTool.name] ?? runningTool.name;
        return `${label}… ${((Date.now() - runningTool.startTs) / 1e3).toFixed(1)}s`;
      }
      if ((selected == null ? void 0 : selected.state) === "starting") return "正在启动…";
      if (runningSubs > 0) return `子代理执行中 ${runningSubs}/${maxSubagents}…`;
      return "正在思考与执行…";
    })();
    function OutcomeFold(props) {
      const [open, setOpen] = react.useState(false);
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "v47-outcome", children: [
        /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            className: "v47-oline",
            onClick: () => setOpen((v) => !v),
            role: "button",
            tabIndex: 0,
            "aria-expanded": open,
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((v) => !v);
              }
            },
            children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: props.icon, size: 13, color: props.color, style: { flex: "none" } }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: "none" }, children: props.summary }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-right", size: 10, className: "tl-chev" + (open ? " open" : "") })
            ]
          }
        ),
        open && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "v47-obody", children: props.children })
      ] });
    }
    const failBar = (() => {
      if (!selected) return null;
      if (selected.state === "failed") {
        return {
          kind: "failed",
          color: "var(--c-red)",
          icon: "dot",
          summary: "任务失败 · 点击查看原因",
          reason: selected.lastMessage ?? "原因未知（可查看时间线错误日志）"
        };
      }
      if (selected.state === "interrupted") {
        return {
          kind: "interrupted",
          color: "var(--c-amber)",
          icon: "dot",
          summary: "会话已中断 · 发送消息可继续",
          reason: selected.lastMessage ?? ""
        };
      }
      if (selected.state === "stopped") {
        return {
          kind: "stopped",
          color: "var(--c-text3)",
          icon: "dot",
          summary: "已手动停止本轮",
          reason: ""
        };
      }
      return null;
    })();
    const activeProfile = resolveRefProfile(selected == null ? void 0 : selected.modelRef) ?? modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
    const visionOk = resolveRefVision((selected == null ? void 0 : selected.modelRef) ?? (activeProfile == null ? void 0 : activeProfile.id));
    const attachmentsPayload = pendingImages.map((img) => ({ name: img.name, dataBase64: img.dataUrl }));
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-root", style: { display: "grid", gridTemplateColumns: `${Math.max(TASK_LIST_MIN_W, Math.min(TASK_LIST_MAX_W, listWidth))}px 6px minmax(0, 1fr)`, flex: 1, minHeight: 0, height: "100%" }, children: [
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
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "new-task-btn", style: { margin: "10px 10px 6px", width: "calc(100% - 20px)" }, onClick: startNewTask, children: "＋ 新任务（描述目标，Ctrl+N）" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-search" + (listQuery ? " has" : ""), children: [
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "search", size: 12 }),
          /* @__PURE__ */ jsxRuntime.jsx("input", { value: listQuery, placeholder: "搜索标题 / 摘要 / id", onChange: (e) => setListQuery(e.target.value) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tk-search-clr", title: "清空", onClick: () => setListQuery(""), children: "✕" })
        ] }),
        selecting ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-selbar", children: [
          "已选 ",
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "n", children: picked.size }),
          " 项",
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sp" }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: pickAllVisible, children: "全选" }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn",
              disabled: picked.size === 0,
              style: picked.size > 0 ? { background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 } : void 0,
              onClick: () => void archivePicked(),
              children: "归档"
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: exitSelect, children: "取消" })
        ] }) : /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-tbar", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-tpop-anchor", children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tk-tbtn" + (listPop === "sort" ? " on" : ""),
                title: "排序",
                onClick: () => setListPop(listPop === "sort" ? null : "sort"),
                children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "sort", size: 14 })
              }
            ),
            listPop === "sort" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-pop on", children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ph", children: "排序" }),
              [["active", "最近活动", "默认"], ["created", "创建时间", null], ["title", "标题 A→Z", null]].map(([id, label, tag]) => /* @__PURE__ */ jsxRuntime.jsxs(
                "div",
                {
                  className: "pi" + (listSort === id ? " on" : ""),
                  onClick: () => {
                    setListSort(id);
                    localStorage.setItem("gitter.taskListSort", id);
                    setListPop(null);
                  },
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ck", children: "✓" }),
                    label,
                    tag ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "n", children: tag }) : null
                  ]
                },
                id
              ))
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-tpop-anchor", children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tk-tbtn" + (listPop === "filter" ? " on" : ""),
                title: "按状态筛选",
                onClick: () => setListPop(listPop === "filter" ? null : "filter"),
                children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "filter", size: 14 })
              }
            ),
            listPop === "filter" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-pop on", children: [
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ph", children: "按状态筛选" }),
              [["all", "全部", ""], ["run", "进行中", "var(--c-green)"], ["ask", "待处理", "var(--c-amber)"], ["done", "已完成", ""], ["err", "失败·中断", ""]].map(([id, label, dot]) => /* @__PURE__ */ jsxRuntime.jsxs(
                "div",
                {
                  className: "pi" + (listFilter === id ? " on" : ""),
                  onClick: () => {
                    setListFilter(id);
                    localStorage.setItem("gitter.taskListFilter", id);
                    setListPop(null);
                  },
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ck", children: "✓" }),
                    dot ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dot", style: { background: dot } }) : null,
                    label,
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "n", children: listCounts[id] })
                  ]
                },
                id
              ))
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tk-tbtn", title: "批量归档（勾选多条任务）", onClick: enterSelect, children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "archive", size: 14 }) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 4px", display: "flex", flexDirection: "column", gap: 2 }, children: [
          groupedTasks.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 12, color: "var(--c-text3)", padding: "6px 2px" }, children: listQ || listFilter !== "all" ? "无匹配任务" : t("Agents_EmptyHint") }),
          groupedTasks.map((g) => /* @__PURE__ */ jsxRuntime.jsxs(react.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-ghead", children: g.label }),
            g.tasks.map(agentCard)
          ] }, g.id))
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "tk-arch-toggle", onClick: () => {
          const n = !archOpen;
          setArchOpen(n);
          localStorage.setItem("gitter.taskArchOpen", n ? "1" : "0");
        }, children: [
          archOpen ? "▾" : "▸",
          " ",
          archOpen ? "已归档" : "显示已归档",
          " (",
          listCounts.arch,
          ")"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-vdiv", title: "拖拽调整任务列表宽度", onPointerDown: startListDrag, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-vdiv-grip" }) }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { ref: detailRef, className: "tk-detail", style: { display: "grid", position: "relative", flex: 1, minHeight: 0, minWidth: 0, gridTemplateRows: "auto minmax(0, 1fr)", gridTemplateColumns: selected && changesPanelOpen && !panelClosing ? panelTemplate(splitRatio) : "minmax(0, 1fr)" }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-tabs", style: { gridColumn: "1", gridRow: "1" }, children: [
          [["chat", "对话", 0], ["diff", "改动", diffCount], ["cp", "检查点", cpCount], ["subagents", "子代理", runningSubs], ["shells", "后台", shellRunning]].map(([id, label, n]) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-tab" + (tab === id ? " on" : ""), onClick: () => setTab(id), children: [
            label,
            n > 0 ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-tab-n", children: n }) : null
          ] }, id)),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn icon" + (verboseTimeline ? " on" : ""),
              title: "详细模式（Ctrl+O）：结果/思考默认全展开",
              "aria-label": "详细模式",
              style: verboseTimeline ? { background: "var(--c-selected)", color: "var(--c-text)" } : void 0,
              onClick: () => setVerboseTimeline((v) => !v),
              children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "list", size: 13 })
            }
          ),
          showCommitHint && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "comp-anchor", children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn icon" + (branchHintOpen ? " on" : ""),
                title: "分支模式与提交提示",
                "aria-label": "分支模式与提交提示",
                onClick: (e) => {
                  e.stopPropagation();
                  setBranchHintOpen((v) => !v);
                },
                children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "branch", size: 13 })
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "hint-pop" + (branchHintOpen ? " on" : ""), onClick: (e) => e.stopPropagation(), children: [
              /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "hint-pop-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "branch", size: 13, color: "var(--c-text3)", style: { flex: "none", marginTop: 3 } }),
                /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                  "当前分支模式：",
                  /* @__PURE__ */ jsxRuntime.jsx("b", { children: "改动已直接在工作区" }),
                  "（",
                  diffCount,
                  " 个文件），无独立分支可合并"
                ] })
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "hint-pop-row", children: /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => {
                pageSdk.navigate("changes");
                setBranchHintOpen(false);
              }, children: "去变更页提交" }) })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { gridColumn: "1", gridRow: "2", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }, children: [
          selected && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: tab === "chat" ? "grid" : "none", flexDirection: "column", gridTemplateRows: "auto auto auto minmax(0, 1fr)", overflow: "hidden" }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-pagehead", style: { gridColumn: "1", gridRow: "1" }, children: [
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-pill", style: { color: stateChip(selected.state, selected.awaitKind).color, borderColor: `color-mix(in srgb, ${stateChip(selected.state, selected.awaitKind).color} 32%, transparent)`, background: `color-mix(in srgb, ${stateChip(selected.state, selected.awaitKind).color} 9%, transparent)` }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-pill-dot" }),
                stateChip(selected.state, selected.awaitKind).label,
                busy && selected.lastActiveAt ? " · " + Math.max(0, Math.round((Date.now() - new Date(selected.lastActiveAt).getTime()) / 1e3)) + "s" : ""
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-monochip", children: selected.branch }),
              runningTool ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-pill amber", children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-pill-dot", style: { animation: "tk-pulse 1.2s infinite" } }),
                TOOL_LABELS[runningTool.name] ?? runningTool.name,
                " ",
                ((Date.now() - runningTool.startTs) / 1e3).toFixed(1),
                "s"
              ] }) : null,
              (((_c = selected.queued) == null ? void 0 : _c.length) ?? 0) > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-pill amber", children: [
                /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "clock", size: 11 }),
                "排队 ",
                selected.queued.length
              ] }) : null,
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "tk-pill dim", children: [
                "子代理 ",
                runningSubs,
                "/",
                maxSubagents
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
              idle && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", title: "对上一轮改动提交验收意见（受限提示开新轮）", onClick: () => setFeedbackOpen(true), children: "验收反馈" })
            ] }),
            showWrapbar && !selected.wrapup && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-wrapbar", style: { gridColumn: "1", gridRow: "2" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "branch", size: 13, color: "var(--c-green)" }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "meta", children: [
                "任务已完成 · ",
                diffCount,
                " 个文件变更 · 可合并回 ",
                /* @__PURE__ */ jsxRuntime.jsx("b", { style: { color: "var(--c-text2)" }, children: selected.baseBranch || "基线分支" })
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sp" }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setTab("diff"), children: "查看改动" }),
              /* @__PURE__ */ jsxRuntime.jsxs(
                "button",
                {
                  className: "tool-btn",
                  style: { background: "var(--c-selected)", borderColor: "var(--c-selected)", color: "var(--c-text)", fontWeight: 600 },
                  onClick: () => setWrapupOpen(true),
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "branch", size: 12 }),
                    "合并到 ",
                    selected.baseBranch || "基线分支"
                  ]
                }
              )
            ] }),
            showWrapbar && selected.wrapup && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-wrapbar", style: { gridColumn: "1", gridRow: "2" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "check-circle", size: 13, color: "var(--c-green)" }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "meta", style: { color: "var(--c-green)" }, children: [
                "已合并 ",
                (selected.wrapup.mergeSha || "").slice(0, 8) || "?",
                " · ",
                selected.wrapup.strategy === "merge" ? "merge --no-ff" : "squash",
                " → ",
                selected.baseBranch || "基线分支"
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "meta", children: "worktree 与分支已清理 · 任务已归档" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sp" }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => pageSdk.navigate("log"), children: "查看 Log" })
            ] }),
            runningSubs > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tk-subrun", style: { gridColumn: "1", gridRow: "3" }, children: [
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "lead", children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "icon", children: "◐" }),
                "子代理 ",
                runningSubs,
                "/",
                maxSubagents
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep" }),
              (selectedTask ? evMap[selectedTask] ?? [] : []).filter(
                (b) => b.kind === "subtask" && b.state === "running"
              ).map((b) => /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "item", onClick: () => {
                setSubagentFocus({ subtaskId: b.subtaskId, ts: Date.now() });
                setTab("subagents");
              }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dt" }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", children: b.name || "子代理" }),
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "du", children: [
                  ((Date.now() - subtaskStartAt(b)) / 1e3).toFixed(1),
                  "s"
                ] }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "arrow", children: "←" })
              ] }, b.subtaskId)),
              runningSubs < maxSubagents && ((_d = selected == null ? void 0 : selected.queued) == null ? void 0 : _d.length) ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "queue-badge", children: [
                "+",
                selected.queued.length,
                " 排队"
              ] }) : null
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, minWidth: 0, position: "relative", gridColumn: "1", gridRow: "4" }, children: [
              error && /* @__PURE__ */ jsxRuntime.jsx(ErrorFloat, { text: error, maxWidth: "calc(100% - 292px)", go: errorGo, onGo: (s) => {
                openSettings(s);
                setError(null);
              }, onClose: () => setError(null) }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "div",
                {
                  ref: timelineRef,
                  className: "tl-scroll",
                  style: { height: "100%", overflowY: "auto", overflowX: "hidden" },
                  onScroll: onTimelineScroll,
                  onDoubleClick: (e) => {
                    var _a3;
                    const pre = e.target.closest("pre");
                    if (pre) void ((_a3 = navigator.clipboard) == null ? void 0 : _a3.writeText(pre.textContent ?? ""));
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsxs("div", { ref: streamInnerRef, className: "tl-conv", style: { maxWidth: 880, margin: "0 auto", padding: "14px 20px 26px", display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }, children: [
                    loadingOlder && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { textAlign: "center", color: "var(--c-text3)", fontSize: 11 }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tl-pulse", children: "加载中…" }) }),
                    hasMoreHistory && !loadingOlder && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { textAlign: "center", color: "var(--c-text3)", fontSize: 11, opacity: 0.6 }, children: "↑ 上滚加载更早" }),
                    timeline.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Agents_TimelineEmpty") }),
                    (() => {
                      const groups = groupTurns(timeline);
                      const gapOf = (i) => {
                        var _a3, _b3;
                        if (i === 0) return "";
                        const a = groups[i - 1];
                        const prev = ((_a3 = a.conclusion) == null ? void 0 : _a3.kind) ?? (a.active ? ((_b3 = a.process[a.process.length - 1]) == null ? void 0 : _b3.kind) ?? "" : a.turn ? "" : "");
                        const cur = groups[i].human ? "human" : groups[i].active && groups[i].process.length > 0 ? groups[i].process[0].kind : "";
                        if (prev !== "assistant") return cur === "assistant" ? "conv" : "soft";
                        if (cur === "human") return "soft";
                        if (cur === "assistant") return "soft";
                        return "conv";
                      };
                      return groups.map((g, gi) => {
                        const gap = gapOf(gi);
                        const ended = !!g.turn;
                        const expanded = !ended || expandedTurns.has(g.anchor);
                        const tools = g.process.filter((b) => b.kind === "tool").length;
                        const subs = g.process.filter((b) => b.kind === "subtask").length;
                        return /* @__PURE__ */ jsxRuntime.jsxs(react.Fragment, { children: [
                          gap === "conv" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tl-gap-conv" }) : null,
                          gap === "soft" ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tl-gap-soft" }) : null,
                          g.human ? renderBlock(g.human, `g${gi}-h`) : null,
                          ended && g.process.length > 0 ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                            /* @__PURE__ */ jsxRuntime.jsxs(
                              "div",
                              {
                                className: "tl-turn",
                                onClick: () => toggleTurn(g.anchor),
                                role: "button",
                                tabIndex: 0,
                                "aria-expanded": expanded,
                                onKeyDown: (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleTurn(g.anchor);
                                  }
                                },
                                children: [
                                  /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-right", size: 11, className: "tl-chev" + (expanded ? " open" : "") }),
                                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontWeight: 600 }, children: "执行过程" }),
                                  tools > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                                    "工具 ",
                                    tools
                                  ] }) : null,
                                  subs > 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                                    "子代理 ",
                                    subs
                                  ] }) : null,
                                  tools === 0 && subs === 0 ? /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                                    g.process.length,
                                    " 条"
                                  ] }) : null
                                ]
                              }
                            ),
                            expanded && renderProcess(`g${gi}-p`, g.process)
                          ] }) : renderProcess(`g${gi}-p`, g.process),
                          g.conclusion ? renderBlock(g.conclusion, `g${gi}-c`) : null,
                          g.outcome.length > 0 ? g.outcome.some((b) => b.kind === "status" && b.text.includes("中断")) ? /* @__PURE__ */ jsxRuntime.jsx(OutcomeFold, { icon: "dot", color: "var(--c-amber)", summary: "会话已中断 · 发送消息可继续", children: g.outcome.map((b, oi) => renderBlock(b, `g${gi}-o${oi}`, true)) }) : g.outcome.map((b, oi) => renderBlock(b, `g${gi}-o${oi}`)) : null,
                          g.turn ? renderBlock(g.turn, `g${gi}-t`) : null,
                          gi === groups.length - 1 && failBar && !(timeline.length > 0 && timeline[timeline.length - 1].kind === "status") && /* @__PURE__ */ jsxRuntime.jsx(OutcomeFold, { icon: failBar.icon, color: failBar.color, summary: failBar.summary, children: /* @__PURE__ */ jsxRuntime.jsx("span", { style: { overflowWrap: "anywhere", userSelect: "text" }, children: failBar.reason || failBar.summary }) })
                        ] }, gi);
                      });
                    })(),
                    (queuedHints[(selected == null ? void 0 : selected.taskId) ?? ""] ?? []).length > 0 ? (queuedHints[selected.taskId] ?? []).map((q, qi) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tl-queued-hint", children: [
                      /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "clock", size: 11, style: { flex: "none", marginTop: 3 } }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { whiteSpace: "nowrap", fontWeight: 600 }, children: "排队 · 本轮结束后自动注入" }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, minWidth: 0, textAlign: "left", color: "var(--c-text2)", fontSize: 12.5, lineHeight: 1.6, overflowWrap: "anywhere", userSelect: "text" }, children: q.length > 120 ? q.slice(0, 120) + "…" : q })
                    ] }, `queued-${qi}`)) : null
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
                    bottom: 132,
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
              ),
              /* @__PURE__ */ jsxRuntime.jsx("div", { className: "chat-dock", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { ref: composerDockRef, style: { maxWidth: 880, margin: "0 auto", position: "relative" }, children: [
                pendingPerm && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "perm-dock", children: [
                  /* @__PURE__ */ jsxRuntime.jsx(
                    PermissionCard,
                    {
                      b: pendingPerm,
                      decided: void 0,
                      sel: permSel[pendingPerm.requestId] ?? 0,
                      showFullAccess,
                      onSel: (id, i) => setPermSel((m) => ({ ...m, [id]: i })),
                      onReply: replyPerm,
                      onFullAccess: (id) => void replyFullAccess(id)
                    }
                  ),
                  /* @__PURE__ */ jsxRuntime.jsx("div", { className: "perm-dock-foot", children: "↑↓ 选择 · Enter 确认 · 数字直选 · 选择结果会回给 agent 继续工作" })
                ] }),
                busy && !pendingPerm && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 7, padding: "0 2px 7px", fontSize: 12 }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "sparkle", size: 12, color: "var(--c-amber)", className: "tl-pulse" }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "shimmer-text", children: busyHint })
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
                    placeholder: busy ? busySend === "block" ? "agent 正在工作——运行中发送已禁用（设置 → Agent 运行时 可改），可先停止本轮" : busySend === "interrupt" ? "agent 正在工作——Enter 插话发送：中断当前轮，你的输入立即生效" : "agent 正在工作——Enter 排队发送，本轮结束后自动注入（双击 Esc 打开检查点）" : "继续对话…输入 / 唤起命令、@ 唤起文件、Shift+Tab 切模式",
                    busy,
                    sending,
                    canSend: !!inputText.trim(),
                    sendTitle: busy ? inputText.trim() ? busySend === "interrupt" ? "插话发送（中断当前轮，立即生效）" : "排队发送（本轮结束后自动注入）" : "停止本轮" : "发送（Enter）",
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
            ] })
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
支持 @文件 提及；调研类任务先切「◇ 计划」模式（Shift+Tab）`,
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
                  model: modelId || (((_e = modelProfiles.find((m) => m.isDefault)) == null ? void 0 : _e.id) ?? ""),
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
                " · 计划模式：先调研出计划，批准后自动执行"
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
              setError,
              onMutate: () => setChangesTick((n) => n + 1)
            }
          ),
          tab === "cp" && selected && /* @__PURE__ */ jsxRuntime.jsx(CheckpointsTab, { taskId: selected.taskId, branch: selected.branch, tick: changesTick, setError, onCount: setCpCount, onViewDiff: () => setTab("diff"), onMutate: () => setChangesTick((n) => n + 1) }),
          tab === "subagents" && selected && /* @__PURE__ */ jsxRuntime.jsx(
            SubagentsTab,
            {
              taskId: selected.taskId,
              live: LIVE_STATES.has(selected.state),
              tick: changesTick,
              setError,
              onCount: setSubagentCount,
              focus: subagentFocus,
              onFocused: () => setSubagentFocus(null)
            }
          ),
          tab === "shells" && selected && /* @__PURE__ */ jsxRuntime.jsx(
            ShellsTab,
            {
              taskId: selected.taskId,
              live: LIVE_STATES.has(selected.state),
              tick: changesTick,
              setError,
              onCount: setShellRunning,
              focus: shellFocus,
              onFocused: () => setShellFocus(null)
            }
          )
        ] }),
        selected && changesPanelOpen && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tk-vdiv", style: { gridColumn: "2", gridRow: "1 / 3", display: panelClosing ? "none" : void 0 }, title: "拖拽调整分栏比例", onPointerDown: startSplitDrag, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tk-vdiv-grip" }) }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { ref: panelWrapRef, style: panelClosing ? { position: "absolute", right: 0, top: 0, bottom: 0, width: closeWRef.current + "px", zIndex: 5, display: "flex", overflow: "hidden" } : { gridColumn: "3", gridRow: "1 / 3", minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden" }, children: /* @__PURE__ */ jsxRuntime.jsx(
            TaskChangesPanel,
            {
              taskId: selected.taskId,
              worktreePath: selected.worktreePath,
              tick: changesTick,
              request: panelReq,
              onCollapse: closePanel,
              onEditInFilesPage: (path) => {
                pageSdk.requestFileFocus(path);
                pageSdk.navigate("files");
              }
            }
          ) })
        ] }),
        (() => {
          const slot = document.getElementById("tbPageActions");
          if (!slot || !pageVisible || !selected) return null;
          return reactDom.createPortal(
            /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tb-pact" + (changesPanelOpen ? " on" : ""), title: changesPanelOpen ? "关闭右侧变更分栏" : "打开右侧变更分栏", onClick: togglePanel, children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "splitpane", size: 15 }) }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tb-pact", title: "在新窗口打开当前任务", onClick: () => void call("app.newWindow", { path: selected.worktreePath }), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "external", size: 13 }) })
            ] }),
            slot
          );
        })(),
        wrapupOpen && selected && /* @__PURE__ */ jsxRuntime.jsx(
          TaskWrapupDialog,
          {
            task: selected,
            onClose: () => setWrapupOpen(false),
            setError,
            onMerged: () => {
              setWrapupOpen(false);
              void reloadAgents();
              setChangesTick((n) => n + 1);
              notifyRepoChanged();
            }
          }
        ),
        feedbackOpen && selected && /* @__PURE__ */ jsxRuntime.jsx(
          TaskFeedbackDialog,
          {
            task: selected,
            onClose: () => setFeedbackOpen(false),
            setError,
            onSent: () => {
              void reloadAgents();
            }
          }
        )
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
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React, window.GITTER_KIT.ReactDOM);
