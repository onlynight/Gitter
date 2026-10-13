/**
 * 编辑区画布查看器扩展点（inline-editor-plan.md 画布 seam）：
 * Monaco 文本流之外的文件查看器在此注册——handles 命中的路径由查看器接管
 * EditorPane 画布，标签条/面包屑/页脚仍走既有布局（Monaco 本体零改动，
 * 与 office-integration-plan.md §10「预览-only」同一通道：只读渲染不回写）。
 * 内置查看器：Office 文档预览（二进制白名单族；csv/tsv 留在 Monaco 可编辑）、
 * 图片预览（file.readBinary 只读通道，png/jpg/svg 等常见位图与矢量族）。
 * 外部查看器：Markdown/HTML 预览走 file.preview previewProviders 接缝——渲染端只认
 * 扩展名，实际渲染由外部 L2 插件提供（无插件时查看器内出回退卡，可切回文本）。
 */
import type { ReactNode } from "react";
import { officeKindOf, type OfficeKind } from "./officeShared";
import { OfficeDocViewer } from "./officeDocPreview";
import { IMAGE_EXTS, ImageFileViewer } from "./filesImageViewer";
import { ExternalFilePreview, HTML_EXTS, MD_EXTS } from "./externalPreview";

/** 查看器统一入参：path + 可选「编辑源文件」请求（回退卡/预览 HUD 用） */
export interface FileViewerProps {
  path: string;
  /** 请求切回 Monaco 文本模式（EditorPane 据此覆盖查看器接管） */
  onEditText?: (path: string) => void;
  /** 首开预览滚动位置（会话恢复；iframe/pre 挂载后应用一次） */
  initialScrollTop?: number;
  /** 预览态滚动位置回报（滚动停止时；EditorPane 据此持久化下次重开时恢复） */
  onScrollTop?: (top: number) => void;
}

export type FileViewerComponent = (props: FileViewerProps) => ReactNode;

interface FileViewerReg {
  matches: (path: string) => boolean;
  render: FileViewerComponent;
}

const viewers: FileViewerReg[] = [];

/** 按 OfficeKind 注册（office 二进制白名单族） */
export function registerFileViewer(kinds: OfficeKind[], render: FileViewerComponent): void {
  viewers.push({
    matches: (p) => { const k = officeKindOf(p); return k !== null && kinds.includes(k); },
    render,
  });
}

/** 按扩展名注册（非 Office 的画布查看器）——exts 须全小写含点 */
export function registerFileExtViewer(exts: string[], render: FileViewerComponent): void {
  const set = new Set(exts);
  viewers.push({
    matches: (p) => { const i = p.lastIndexOf("."); return i >= 0 && set.has(p.slice(i).toLowerCase()); },
    render,
  });
}

/** 命中查看器则返回其组件（编辑区画布据此接管），否则 null = 走 Monaco 文本流 */
export function viewerForPath(path: string): FileViewerComponent | null {
  for (const v of viewers) {
    if (v.matches(path)) return v.render;
  }
  return null;
}

// 内置查看器注册：
// - 二进制 Office 族（pdf/pptx/docx/xlsx/ods 及其子型）。legacy（.doc/.xls 等无前端
//   渲染器）与 csv/tsv（纯文本）不接管——前者维持「二进制不可编辑」提示，后者保持
//   Monaco 文本编辑能力。
// - 图片族：适配既有图片预览通道（file.readBinary → data URL），只读不回写。
// - Markdown 族 / HTML 族：file.preview 接缝（外部 L2 插件优先，无插件回退卡）。
registerFileViewer(["pdf", "pptx", "docx", "xlsx", "ods"], (p) => <OfficeDocViewer {...p} />);
registerFileExtViewer(IMAGE_EXTS, (p) => <ImageFileViewer {...p} />);
registerFileExtViewer(MD_EXTS, (p) => (
  <ExternalFilePreview {...p} onEditText={p.onEditText ? () => p.onEditText!(p.path) : undefined} />
));
registerFileExtViewer(HTML_EXTS, (p) => (
  <ExternalFilePreview {...p} onEditText={p.onEditText ? () => p.onEditText!(p.path) : undefined} />
));
