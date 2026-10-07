import * as fs from "fs";
import * as path from "path";
import { tryGit } from "./gitexec";

// 非代码文件的直接预览（变更页）：图片类二进制不走 git diff，直接出内容。
// 可预览类型 = Chromium <img> 原生支持的格式；SVG 经 <img> 渲染不执行脚本（安全）。
// 视频/PDF 需专用组件且 data URL 行为不稳，v1 不做（对等账本）。

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/** 该路径是否可直接预览；是则返回 MIME，否则 null。 */
export function previewMime(filePath: string): string | null {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? null;
}

export interface PreviewResult {
  mime: string;
  base64: string;
  /** true = 内容来自 git index（暂存视图），false = 工作区文件 */
  fromIndex: boolean;
  tooLarge?: boolean;
}

/**
 * 读取文件内容为 base64（渲染层拼 data URL）。
 * staged=true 读 git index（`git show :<path>`，无 index 条目时回退工作区）；
 * 大小超上限返回 tooLarge（不传内容）。
 */
export async function readPreview(
  workDir: string,
  filePath: string,
  staged: boolean,
  maxBytes = 8 * 1024 * 1024,
): Promise<PreviewResult | null> {
  const mime = previewMime(filePath);
  if (!mime) return null;

  let buf: Buffer | null = null;
  let fromIndex = false;
  if (staged) {
    const stat = await tryGit(workDir, ["cat-file", "-s", `:${filePath}`]);
    if (stat.code === 0 && parseInt(stat.stdout.trim(), 10) <= maxBytes) {
      const show = await tryGit(workDir, ["show", `:${filePath}`]);
      if (show.code === 0) {
        buf = Buffer.from(show.stdout, "binary");
        fromIndex = true;
      }
    }
  }
  if (buf === null) {
    const full = path.join(workDir, filePath);
    if (!fs.existsSync(full)) return null;
    if (fs.statSync(full).size > maxBytes) {
      return { mime, base64: "", fromIndex: false, tooLarge: true };
    }
    buf = fs.readFileSync(full);
  }
  if (buf.length > maxBytes) {
    return { mime, base64: "", fromIndex, tooLarge: true };
  }
  return { mime, base64: buf.toString("base64"), fromIndex };
}
