/**
 * Office 页共享工具（office-integration-plan.md §10 预览-only）：
 * 扩展名白名单 + 扩展名徽标 + 渲染器分派。文件字节不落任何中间存储——
 * RPC base64/文本进、iframe 预览出，页内不回写（编辑一律交给外部应用）。
 */

/** legacy = 无成熟纯前端渲染器的旧格式（§10.4：不预览，仅列表展示 + 外部打开） */
export type OfficeKind =
  | "pdf" | "pptx" | "docx" | "xlsx" | "ods" | "csv" | "tsv" | "legacy";

const KIND_EXTS: Record<OfficeKind, Set<string>> = {
  pdf: new Set([".pdf"]),
  pptx: new Set([".pptx", ".pptm", ".ppsx", ".potx"]),
  docx: new Set([".docx", ".docm", ".dotx"]),
  xlsx: new Set([".xlsx", ".xlsm", ".xltx"]),
  ods: new Set([".ods"]),
  csv: new Set([".csv"]),
  tsv: new Set([".tsv"]),
  legacy: new Set([".doc", ".xls", ".ppt", ".odt", ".odp", ".rtf", ".pages", ".key", ".numbers"]),
};

export function officeKindOf(p: string): OfficeKind | null {
  const i = p.lastIndexOf(".");
  if (i < 0) return null;
  const ext = p.slice(i).toLowerCase();
  for (const kind of Object.keys(KIND_EXTS) as OfficeKind[]) {
    if (KIND_EXTS[kind].has(ext)) return kind;
  }
  return null;
}

/** iframe 预览渲染器分派（officePreview/runtime.ts 的 kind 参数）；legacy 无页内预览 */
export function previewerOf(kind: OfficeKind): "pdf" | "docx" | "sheet" | "pptx" | null {
  switch (kind) {
    case "pdf": return "pdf";
    case "pptx": return "pptx";
    case "docx": return "docx";
    case "xlsx": case "ods": case "csv": case "tsv": return "sheet";
    default: return null;
  }
}

/** csv/tsv 走既有文本通道（file.content），其余预览格式走 file.readBinary */
export function isTextChannelKind(kind: OfficeKind): boolean {
  return kind === "csv" || kind === "tsv";
}

export function officeExtLabel(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i + 1).toUpperCase() : "";
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
