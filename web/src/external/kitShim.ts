/**
 * kit 全局面适配（ui-full-pluginization-plan.md R2b）：
 * 页面源码 import "../kit" → 页面构建期映射到本模块（window.GITTER_KIT 活实例——
 * 宿主 bundle 的 React 单实例与活 store 内核组件，见 kitGlobal.ts）。
 * 类型经 typeof import 取自真实 kit 源（编译期），运行时全部来自 window。
 */
const K = (): NonNullable<Window["GITTER_KIT"]> => {
  const k = window.GITTER_KIT;
  if (!k) throw new Error("GITTER_KIT 未注入（外部页必须经宿主 pageLoader 装载）");
  return k;
};

export const React = K().React as typeof import("react");
export const ReactDOM = K().ReactDOM as typeof import("react-dom");
export const ReactDOMClient = K().ReactDOMClient as typeof import("react-dom/client");

export const DiffView = K().DiffView as typeof import("../kit")["DiffView"];
export const diffStatusLetter = K().diffStatusLetter as typeof import("../kit")["diffStatusLetter"];
export const renderSegments = K().renderSegments as typeof import("../kit")["renderSegments"];
export const wordDiff = K().wordDiff as typeof import("../kit")["wordDiff"];
export const SplitPane = K().SplitPane as typeof import("../kit")["SplitPane"];
export const Banner = K().Banner as typeof import("../kit")["Banner"];
export const Modal = K().Modal as typeof import("../kit")["Modal"];
export const useContextMenu = K().useContextMenu as typeof import("../kit")["useContextMenu"];
export const SyncBar = K().SyncBar as typeof import("../kit")["SyncBar"];
export const useSyncProgress = K().useSyncProgress as typeof import("../kit")["useSyncProgress"];
export const renderMarkdown = K().renderMarkdown as typeof import("../kit")["renderMarkdown"];
export const registerMarkdownPlugin = K().registerMarkdownPlugin as typeof import("../kit")["registerMarkdownPlugin"];
export const PageErrorBoundary = K().PageErrorBoundary as typeof import("../kit")["PageErrorBoundary"];
export const NavIcon = K().NavIcon as typeof import("../kit")["NavIcon"];

export type { CtxMenuItem, SyncProgressState } from "../kit";
