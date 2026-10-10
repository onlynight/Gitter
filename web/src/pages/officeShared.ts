/**
 * Office 页共享工具（office-integration-plan.md §10 预览-only）：
 * 扩展名白名单 + 扩展名徽标。文件字节不落任何中间存储——RPC base64 进、iframe 预览出，
 * 页内不回写（编辑一律交给外部应用）。
 */

export type OfficeKind = "pptx" | "docx" | "xlsx" | null;

const PPTX_EXTS = new Set([".pptx", ".pptm", ".ppsx"]);
const DOCX_EXTS = new Set([".docx", ".docm", ".dotx"]);
const XLSX_EXTS = new Set([".xlsx", ".xlsm", ".xltx"]);

export function officeKindOf(p: string): OfficeKind {
  const i = p.lastIndexOf(".");
  if (i < 0) return null;
  const ext = p.slice(i).toLowerCase();
  if (PPTX_EXTS.has(ext)) return "pptx";
  if (DOCX_EXTS.has(ext)) return "docx";
  if (XLSX_EXTS.has(ext)) return "xlsx";
  return null;
}

export function officeExtLabel(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i + 1).toUpperCase() : "";
}
