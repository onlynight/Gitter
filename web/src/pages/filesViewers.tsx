/**
 * 编辑区画布查看器扩展点（inline-editor-plan.md 画布 seam）：
 * Monaco 文本流之外的文件查看器在此注册——handles 命中的路径由查看器接管
 * EditorPane 画布，标签条/面包屑/页脚仍走既有布局（Monaco 本体零改动，
 * 与 office-integration-plan.md §10「预览-only」同一通道：只读渲染不回写）。
 * 内置查看器：Office 文档预览（二进制白名单族；csv/tsv 留在 Monaco 可编辑）。
 */
import type { ReactNode } from "react";
import { officeKindOf, type OfficeKind } from "./officeShared";
import { OfficeDocViewer } from "./officeDocPreview";

export type FileViewerComponent = (props: { path: string }) => ReactNode;

interface FileViewerReg {
  /** 接管的 OfficeKind 集合（null kind 的路径不参与判定） */
  kinds: Set<OfficeKind>;
  render: FileViewerComponent;
}

const viewers: FileViewerReg[] = [];

export function registerFileViewer(kinds: OfficeKind[], render: FileViewerComponent): void {
  viewers.push({ kinds: new Set(kinds), render });
}

/** 命中查看器则返回其组件（编辑区画布据此接管），否则 null = 走 Monaco 文本流 */
export function viewerForPath(path: string): FileViewerComponent | null {
  const k = officeKindOf(path);
  if (k === null) return null;
  for (const v of viewers) {
    if (v.kinds.has(k)) return v.render;
  }
  return null;
}

// 内置查看器注册：二进制 Office 族（pdf/pptx/docx/xlsx/ods 及其子型）。
// legacy（.doc/.xls 等无前端渲染器）与 csv/tsv（纯文本）不接管——前者维持
// 「二进制不可编辑」提示，后者保持 Monaco 文本编辑能力。
registerFileViewer(["pdf", "pptx", "docx", "xlsx", "ods"], (p) => <OfficeDocViewer {...p} />);
