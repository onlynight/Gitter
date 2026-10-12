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
    navigate: (page) => U().navigate(page),
    openSettings: (section) => U().openSettings(section),
    notifyRepoChanged: () => U().notifyRepoChanged(),
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
  K().Select;
  K().ReflogDialog;
  const ScrollArea = K().ScrollArea;
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
  const { call, t, navigate, notifyRepoChanged, openSettings, setContext: setSharedContext } = pageSdk;
  const useApp = useAppState;
  const PREFIX_ITEMS = [
    { pfx: "feat:", descKey: "Changes_PrefixFeat" },
    { pfx: "fix:", descKey: "Changes_PrefixFix" },
    { pfx: "docs:", descKey: "Changes_PrefixDocs" },
    { pfx: "test:", descKey: "Changes_PrefixTest" },
    { pfx: "build:", descKey: "Changes_PrefixBuild" },
    { pfx: "chore:", descKey: "Changes_PrefixChore" }
  ];
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
    const [excludedStaged, setExcludedStaged] = react.useState(/* @__PURE__ */ new Set());
    const [filter, setFilter] = react.useState("");
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
    const [prefixOpen, setPrefixOpen] = react.useState(false);
    const [prefixHi, setPrefixHi] = react.useState(-1);
    const prefixRef = react.useRef(null);
    const commitInputRef = react.useRef(null);
    react.useEffect(() => {
      if (!prefixOpen) return;
      const close = (e) => {
        var _a3;
        if (!((_a3 = prefixRef.current) == null ? void 0 : _a3.contains(e.target))) setPrefixOpen(false);
      };
      document.addEventListener("mousedown", close);
      return () => document.removeEventListener("mousedown", close);
    }, [prefixOpen]);
    const insertPrefix = (pfx) => {
      var _a3;
      setMessage((m) => m.trim() ? m : pfx + " ");
      setPrefixOpen(false);
      setPrefixHi(-1);
      (_a3 = commitInputRef.current) == null ? void 0 : _a3.focus();
    };
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
    }, [repo, app.refreshTick, app.repoChangedTick]);
    react.useEffect(() => {
      if (!repo) return;
      setSelected(null);
      setDiff(null);
      setMessage("");
      setChecked(/* @__PURE__ */ new Set());
      setExcludedStaged(/* @__PURE__ */ new Set());
      setFilter("");
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
        notifyRepoChanged();
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
    const runRef = react.useRef(run);
    runRef.current = run;
    const toggleHunk = react.useCallback((i) => {
      setSelectedHunks((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
    }, []);
    const hunkActionLabel = react.useCallback(
      (_i) => (selected == null ? void 0 : selected.staged) ? t("Changes_UnstageHunk") : t("Changes_StageHunk"),
      [selected]
    );
    const hunkAction = react.useCallback(
      (i) => {
        const sel = selected;
        if (!sel) return;
        if (sel.staged) {
          void runRef.current(async () => {
            await call("changes.unstageHunks", { path: sel.path, indices: [i] });
            return t("Changes_UnstagedHunks");
          });
        } else if (!sel.isNew) {
          void runRef.current(async () => {
            await call("changes.stageHunks", { path: sel.path, indices: [i] });
            return t("Changes_StagedHunks");
          });
        }
      },
      [selected]
    );
    const select = (f, stagedView) => {
      const sel = { path: f.path, staged: stagedView, isNew: f.category === "unversioned", isConflict: f.isConflict };
      setSelected(sel);
      void loadDiff(sel);
    };
    const allFiles = react.useMemo(
      () => state ? [...state.staged, ...state.changes, ...state.unversioned, ...state.conflicts] : [],
      [state]
    );
    const stagedPaths = react.useMemo(
      () => allFiles.filter((f) => checked.has(f.path) && f.category !== "staged" && f.category !== "conflicts").map((f) => f.path),
      [allFiles, checked]
    );
    const commitStat = react.useMemo(() => {
      if (!state) return { n: 0, added: 0, deleted: 0 };
      const files = [
        ...state.staged.filter((f) => !excludedStaged.has(f.path)),
        ...allFiles.filter((f) => checked.has(f.path) && f.category !== "staged" && f.category !== "conflicts")
      ];
      let added = 0;
      let deleted = 0;
      for (const f of files) {
        added += f.added ?? 0;
        deleted += f.deleted ?? 0;
      }
      return { n: files.length, added, deleted };
    }, [state, allFiles, checked, excludedStaged]);
    const canCommit = !!state && (state.staged.some((f) => !excludedStaged.has(f.path)) || stagedPaths.length > 0) && message.trim().length > 0 && !busy;
    const doCommit = async (push) => {
      if (!canCommit) return;
      setBusy(true);
      try {
        const r = await call("changes.commit", {
          message: message.trim(),
          push,
          toStage: stagedPaths,
          toUnstage: [...excludedStaged]
        });
        setMessage("");
        setChecked(/* @__PURE__ */ new Set());
        if (r.pushError) {
          setError(t("Changes_PushFailed", r.pushError));
          setErrorDetail(null);
        } else {
          showTransient(push ? t("Changes_CommittedAndPushed") : t("Changes_Committed"));
        }
        notifyRepoChanged();
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
          notifyRepoChanged();
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
          notifyRepoChanged();
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
    const q = filter.trim().toLowerCase();
    const renderRow = (f, stagedView, checkable) => {
      const letter = letterOf(f);
      const { dir, base } = splitPath(f.path);
      const isConflict = f.isConflict;
      const include = f.category === "staged" ? !excludedStaged.has(f.path) : checked.has(f.path);
      const toggleInclude = () => {
        const setter = f.category === "staged" ? setExcludedStaged : setChecked;
        setter((prev) => {
          const next = new Set(prev);
          if (next.has(f.path)) next.delete(f.path);
          else next.add(f.path);
          return next;
        });
      };
      const stageOne = () => void run(async () => {
        await call("changes.stage", { paths: [f.path] });
        return t("Changes_Staged");
      });
      const unstageOne = () => void run(async () => {
        await call("changes.unstage", { paths: [f.path] });
        return t("Changes_Unstaged");
      });
      return /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "chg-row" + ((selected == null ? void 0 : selected.path) === f.path && (selected == null ? void 0 : selected.staged) === stagedView ? " selected" : "") + (isConflict ? " conflict" : ""),
          onClick: () => select(f, stagedView),
          onContextMenu: (e) => {
            void (async () => {
              const local = [
                stagedView ? { label: t("Changes_UnstageFile"), action: unstageOne } : { label: t("Changes_StageFile"), action: stageOne },
                ...isConflict ? [{ label: t("Changes_MarkResolved"), action: stageOne }] : [],
                { sep: true, label: "", action: () => {
                } }
              ];
              showMenu(e, [...local, ...await seamMenuItems("changesFile", f.path)]);
            })();
          },
          children: [
            checkable && !isConflict && /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                type: "checkbox",
                checked: include,
                onChange: toggleInclude,
                onClick: (e) => e.stopPropagation(),
                "data-tip": t("Changes_IncludeCommit")
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "status-letter " + (letter === "?" ? "st-U" : "st-" + letter), children: letter }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-path", title: f.path, children: [
              dir && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dir", children: dir }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep", children: "/" })
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "base", children: base })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-tail", children: [
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-stats", children: [
                f.added !== null && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-add", children: [
                  "+",
                  f.added
                ] }),
                f.deleted !== null && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-del", children: [
                  "−",
                  f.deleted
                ] })
              ] }),
              !isConflict && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chg-act", children: stagedView ? /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "icon-btn",
                  "data-tip": t("Changes_UnstageFile"),
                  disabled: busy,
                  onClick: (e) => {
                    e.stopPropagation();
                    unstageOne();
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "down", size: 12 })
                }
              ) : /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "icon-btn",
                  "data-tip": t("Changes_StageFile"),
                  disabled: busy,
                  onClick: (e) => {
                    e.stopPropagation();
                    stageOne();
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 12 })
                }
              ) })
            ] })
          ]
        },
        f.category + f.path
      );
    };
    const group = (gkey, title, files, stagedView, opts) => {
      const visible = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
      if (visible.length === 0) return null;
      const collapsed = collapsedGroups.has(gkey);
      const eligible = files.filter((f) => !f.isConflict);
      const includeOf = (f) => f.category === "staged" ? !excludedStaged.has(f.path) : checked.has(f.path);
      const allOn = eligible.length > 0 && eligible.every(includeOf);
      const someOn = eligible.some(includeOf);
      const toggleAllInclude = () => {
        const targetOn = !allOn;
        const setter = stagedView ? setExcludedStaged : setChecked;
        setter((prev) => {
          const next = new Set(prev);
          for (const f of eligible) {
            if (stagedView) {
              if (targetOn) next.delete(f.path);
              else next.add(f.path);
            } else {
              if (targetOn) next.add(f.path);
              else next.delete(f.path);
            }
          }
          return next;
        });
      };
      const actAll = () => {
        const paths = visible.map((f) => f.path);
        if (opts.act === "stage") {
          void run(async () => {
            await call("changes.stage", { paths });
            return t("Changes_Staged");
          });
        } else {
          void run(async () => {
            await call("changes.unstage", { paths });
            return t("Changes_Unstaged");
          });
        }
      };
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "chg-group-h" + (gkey === "conflicts" ? " warn" : ""), onClick: () => toggleGroup(gkey), children: [
          opts.checkable && eligible.length > 0 && /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              type: "checkbox",
              checked: allOn,
              ref: (el) => {
                if (el) el.indeterminate = someOn && !allOn;
              },
              onChange: toggleAllInclude,
              onClick: (e) => e.stopPropagation(),
              "data-tip": t("Changes_IncludeCommit")
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 11, className: collapsed ? "cv-closed" : void 0 }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: title }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chg-cnt", children: visible.length }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          opts.act && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chg-gacts", onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "icon-btn",
              "data-tip": opts.act === "stage" ? t("Changes_StageGroup") : t("Changes_UnstageGroup"),
              disabled: busy,
              onClick: actAll,
              children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: opts.act === "stage" ? "plus" : "down", size: 12 })
            }
          ) })
        ] }),
        !collapsed && visible.map((f) => renderRow(f, stagedView, opts.checkable))
      ] }, gkey);
    };
    const hasSelectedHunks = selectedHunks.size > 0 && diff && !diff.isBinary;
    const selectedFile = react.useMemo(() => {
      if (!selected || !state) return null;
      const list = selected.staged ? state.staged : selected.isConflict ? state.conflicts : selected.isNew ? state.unversioned : state.changes;
      return list.find((f) => f.path === selected.path) ?? null;
    }, [selected, state]);
    const selLetter = selectedFile ? letterOf(selectedFile) : "";
    const selSplit = selected ? splitPath(selected.path) : { dir: "", base: "" };
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
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
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "b-ico " + (f.severity === "blocked" ? "err" : "warn"), children: f.severity === "blocked" ? "✕" : "!" }),
              /* @__PURE__ */ jsxRuntime.jsxs(
                "span",
                {
                  className: "finding-link",
                  style: { fontFamily: "var(--mono)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, color: "var(--c-link)" },
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
                  className: "tool-btn icon sm",
                  "data-tip": t("Changes_MarkResolved"),
                  style: { width: 22, height: 18 },
                  onClick: () => dismissFinding(f),
                  children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", style: { fontSize: 10 }, children: "" })
                }
              )
            ] }, findingKey(f) + i)),
            !showAllFindings && activeFindings.length > 6 && /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn icon sm",
                "data-tip": t("Changes_MoreFindings", activeFindings.length - 6),
                style: { width: 22, height: 22, color: "var(--c-link)" },
                onClick: () => setShowAllFindings(true),
                children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", style: { fontSize: 10 }, children: "" })
              }
            ),
            showAllFindings && activeFindings.length > 6 && /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "tool-btn icon sm",
                "data-tip": t("Common_Collapse"),
                style: { width: 22, height: 22 },
                onClick: () => setShowAllFindings(false),
                children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", style: { fontSize: 10, transform: "rotate(180deg)" }, children: "" })
              }
            )
          ]
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "10px 12px 12px" }, children: /* @__PURE__ */ jsxRuntime.jsx(SplitPane, { settingKey: "changesSplitterFraction", initial: 0.38, a: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "split-pane chg-left", style: { display: "flex", flexDirection: "column" }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "chg-head", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "chg-branch", "data-tip": t("Changes_BranchSwitch"), onClick: () => navigate("branches"), children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "branch", size: 12 }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: (state == null ? void 0 : state.branch) ?? "—" })
          ] }),
          state && !!state.ahead && !!state.behind && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-sync", "data-tip": t("Changes_AheadBehind", state.ahead, state.behind), children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 10, className: "up" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "up", children: state.ahead }),
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "down", size: 10, className: "dn" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dn", children: state.behind })
          ] }),
          state && !!state.ahead && !state.behind && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-sync", "data-tip": t("Changes_Ahead", state.ahead), children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 10, className: "up" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "up", children: state.ahead })
          ] }),
          state && !state.ahead && !!state.behind && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-sync", "data-tip": t("Changes_AheadBehind", 0, state.behind), children: [
            /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "down", size: 10, className: "dn" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dn", children: state.behind })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": t("Changes_Fetch"), disabled: busy, onClick: () => void run(async () => {
            await call("changes.fetch", {});
            return t("Changes_Fetched");
          }), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "sync", size: 13 }) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": t("Changes_Pull"), disabled: busy, onClick: () => void run(async () => {
            await call("changes.pull", { rebase: false });
            return t("Changes_Pulled");
          }), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "download", size: 13 }) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": t("Changes_PullRebase"), disabled: busy, onClick: () => void run(async () => {
            await call("changes.pull", { rebase: true });
            return t("Changes_PulledRebase");
          }), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "down", size: 13 }) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": t("Changes_Push"), disabled: busy, onClick: () => void doPush(), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 13 }) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": t("Branches_CreateTitle"), onClick: () => setCreateBranch(""), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "plus", size: 13 }) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "chg-filter" + (filter ? " has" : ""), children: [
          /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "search", size: 12 }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              value: filter,
              placeholder: t("Changes_FilterPlaceholder"),
              spellCheck: false,
              onChange: (e) => setFilter(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Escape") setFilter("");
              }
            }
          ),
          filter && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "chg-clr", onClick: () => setFilter(""), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "x", size: 11 }) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx(ScrollArea, { className: "file-scroll", style: { flex: 1 }, children: state && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          group("conflicts", t("Changes_Conflicts"), state.conflicts, false, { checkable: false, act: null }),
          group("staged", t("Changes_StagedGroup"), state.staged, true, { checkable: true, act: "unstage" }),
          group("changes", t("Changes_ChangesGroup"), state.changes, false, { checkable: true, act: "stage" }),
          group("unversioned", t("Changes_UnversionedGroup"), state.unversioned, false, { checkable: true, act: "stage" }),
          allFiles.length === 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
            t("Changes_WorktreeClean"),
            /* @__PURE__ */ jsxRuntime.jsx(EmptyHints, { slot: "changes.empty" })
          ] }),
          allFiles.length > 0 && q && !allFiles.some((f) => f.path.toLowerCase().includes(q)) && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "chg-noresult", children: t("Changes_NoMatch") })
        ] }) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "commit-box", children: [
          /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              className: "prefix-row",
              ref: prefixRef,
              onKeyDown: (e) => {
                if (!prefixOpen) return;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  setPrefixHi((h) => (h + d + PREFIX_ITEMS.length) % PREFIX_ITEMS.length);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (prefixHi >= 0) insertPrefix(PREFIX_ITEMS[prefixHi].pfx);
                } else if (e.key === "Escape") {
                  setPrefixOpen(false);
                }
              },
              children: [
                /* @__PURE__ */ jsxRuntime.jsxs(
                  "button",
                  {
                    className: "icon-btn",
                    "data-tip": t("Changes_PrefixMenu"),
                    "aria-haspopup": "menu",
                    "aria-expanded": prefixOpen,
                    onClick: () => {
                      setPrefixOpen((v) => !v);
                      setPrefixHi(-1);
                    },
                    children: [
                      /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "commit", size: 13 }),
                      /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chevron-down", size: 9, className: "prefix-chev" })
                    ]
                  }
                ),
                prefixOpen && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "prefix-pop", role: "menu", "aria-label": t("Changes_PrefixMenu"), children: [
                  PREFIX_ITEMS.map((it, i) => /* @__PURE__ */ jsxRuntime.jsxs(
                    "button",
                    {
                      type: "button",
                      role: "menuitem",
                      className: "pitem" + (i === prefixHi ? " hi" : ""),
                      onMouseEnter: () => setPrefixHi(i),
                      onClick: () => insertPrefix(it.pfx),
                      children: [
                        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "pfx", children: it.pfx }),
                        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "desc", children: t(it.descKey) })
                      ]
                    },
                    it.pfx
                  )),
                  /* @__PURE__ */ jsxRuntime.jsx("div", { className: "pop-hint", children: t("Changes_PrefixMenuHint") })
                ] }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow", style: { flex: 1 } }),
                /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": aiBusy ? t("Common_Loading") : t("Changes_AiGenerate"), disabled: aiBusy || ((state == null ? void 0 : state.staged.length) ?? 0) === 0, onClick: () => void generateMessage(), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "sparkle", size: 13 }) })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx(CommitBlocks, { fileCount: (state == null ? void 0 : state.staged.length) ?? 0 }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "textarea",
            {
              ref: commitInputRef,
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
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "commit-actions", style: { alignItems: "center", justifyContent: "flex-start" }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-sum", children: [
              t("Changes_CommitStat", commitStat.n),
              (commitStat.added > 0 || commitStat.deleted > 0) && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
                " · ",
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-add", children: [
                  "+",
                  commitStat.added
                ] }),
                " ",
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-del", children: [
                  "−",
                  commitStat.deleted
                ] })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
            /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "tool-btn solid", "data-tip": t("Changes_Commit"), disabled: !canCommit, onClick: () => void doCommit(false), children: [
              /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "check", size: 12 }),
              t("Changes_Commit")
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Changes_CommitAndPush"), disabled: !canCommit, onClick: () => void doCommit(true), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 13 }) })
          ] })
        ] })
      ] }), b: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "split-pane", style: { display: "flex", flexDirection: "column" }, children: [
        selected && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "chg-filehead", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "status-letter " + (selLetter === "?" ? "st-U" : "st-" + selLetter), children: selLetter }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-path", title: selected.path, children: [
            selSplit.dir && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dir", children: selSplit.dir }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep", children: "/" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "base", children: selSplit.base })
          ] }),
          (selectedFile == null ? void 0 : selectedFile.added) != null && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "chg-stats", children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-add", children: [
              "+",
              selectedFile.added
            ] }),
            " ",
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-del", children: [
              "−",
              selectedFile.deleted
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": t("Changes_AiExplain"), disabled: aiBusy || ((state == null ? void 0 : state.staged.length) ?? 0) === 0, onClick: () => void explain("explain"), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "chat", size: 13 }) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "icon-btn", "data-tip": t("Changes_AiReview"), disabled: aiBusy || ((state == null ? void 0 : state.staged.length) ?? 0) === 0, onClick: () => void explain("review"), children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "shield", size: 13 }) }),
          selected.staged ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsxs(
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
                children: [
                  /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "down", size: 12 }),
                  t("Changes_UnstageFile")
                ]
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
                className: "tool-btn icon",
                "data-tip": t("Changes_StageFile"),
                disabled: busy,
                onClick: () => void run(async () => {
                  await call("changes.stage", { paths: [selected.path] });
                  setSelected(null);
                  setDiff(null);
                  return t("Changes_Staged");
                }),
                children: /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 13 })
              }
            ),
            hasSelectedHunks && /* @__PURE__ */ jsxRuntime.jsxs(
              "button",
              {
                className: "tool-btn icon",
                "data-tip": t("Changes_StageHunkSelected", selectedHunks.size),
                disabled: busy,
                onClick: () => void run(async () => {
                  await call("changes.stageHunks", { path: selected.path, indices: [...selectedHunks] });
                  return t("Changes_StagedHunks");
                }),
                children: [
                  /* @__PURE__ */ jsxRuntime.jsx(TlIcon, { name: "up", size: 13 }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontSize: 11 }, children: selectedHunks.size })
                ]
              }
            )
          ] })
        ] }),
        (selected == null ? void 0 : selected.isConflict) && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "banner", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: t("Changes_ConflictCompareHint") }) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, overflow: "auto", minHeight: 0 }, children: selected && preview ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "diff-file-header", children: /* @__PURE__ */ jsxRuntime.jsx("span", { style: { marginLeft: "auto", color: "var(--c-text3)", fontSize: 11 }, children: preview.fromIndex ? t("Changes_PreviewStaged") : t("Changes_PreviewWorktree") }) }),
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
            hideHeader: true,
            focusLine,
            inline: ((_a2 = app.settings) == null ? void 0 : _a2.diffMode) === "inline",
            selectedHunks: selected.staged || selected.isNew ? void 0 : selectedHunks,
            onToggleHunk: selected.staged || selected.isNew ? void 0 : toggleHunk,
            hunkActionLabel,
            onHunkAction: selected.staged ? hunkAction : selected.isNew ? void 0 : hunkAction
          }
        ) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", children: t("Changes_SelectFileHint") }) })
      ] }) }) }),
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
  function letterOf(f) {
    if (f.isConflict) return "U";
    if (f.code) return f.code[0];
    if (f.category === "unversioned") return "?";
    if (f.category === "staged") return "A";
    return "M";
  }
  function splitPath(p) {
    const i = p.lastIndexOf("/");
    return i < 0 ? { dir: "", base: p } : { dir: p.slice(0, i), base: p.slice(i + 1) };
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
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "changes",
        children: React.createElement(ChangesPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
