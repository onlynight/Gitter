/**
 * GITTER_KIT——内核组件库（ui-full-pluginization-plan.md D2/R2 架构裁决）：
 * DiffView / wordDiff / SplitPane / Dialogs / SyncBar / markdown / PageErrorBoundary /
 * NavIcon 的单一源码。不单独出 IIFE 制品——宿主 bundle 即制品，kitGlobal.ts 启动时
 * 把本目录与宿主 React（单一活实例、活 store）组装到 window.GITTER_KIT 供外部页消费；
 * 页面构建（build-pages.mjs）把 react 系声明为 GITTER_KIT.* globals external。
 * 边界：KIT 是可复用组件不是可替换引擎——DiffView/虚拟滚动的实现不开放替换（C 类红线）。
 */
export { DiffView, diffStatusLetter } from "./DiffView";
export { renderSegments, wordDiff } from "./wordDiff";
export { SplitPane } from "./SplitPane";
export { Banner, Modal, useContextMenu, type CtxMenuItem } from "./Dialogs";
export { SyncBar, useSyncProgress, type SyncProgressState } from "./SyncBar";
export { registerMarkdownPlugin, renderMarkdown } from "./markdown";
export { PageErrorBoundary } from "./PageErrorBoundary";
export { NavIcon } from "./NavIcon";
