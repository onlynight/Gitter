/**
 * Markdown 预览（外部 L2 插件 · extension-system-v2.md §16.6 C 阶段契约）：
 * manifest 声明 entry:"main.js"（本文件经 esbuild 打包为单文件 CJS，markdown-it
 * 一并内联——宿主零新增依赖）。activate 经 ctx.registerPreviewProvider 接管
 * .md/.markdown 的 file.preview（插件优先）：仓库相对路径 + opts.repo 拼绝对路径
 * （越界拒绝），fs 读取上限后 markdown-it 渲染只读 HTML。
 * 安全：html:false 禁内联 HTML（渲染产物无脚本）、linkify 自动链接；信任门
 * settings.allowCodePlugins 关闭时宿主不装载本 entry，渲染端自动回退文本模式。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import MarkdownIt from "markdown-it";

// html:false = 不透传内联 HTML 标签（<script> 等原样转义显示）；渲染产物进渲染层
// sandbox="" iframe（无脚本权限），双重防线
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

interface PreviewOpts {
  maxBytes?: number;
  repo?: string | null;
}

interface ProviderResult {
  kind: "text" | "html";
  content: string;
}

interface PreviewCtx {
  registerPreviewProvider(
    exts: string[],
    fn: (filePath: string, opts: PreviewOpts) => ProviderResult | null,
  ): void;
}

function activate(ctx: PreviewCtx): void {
  ctx.registerPreviewProvider([".md", ".markdown"], (filePath, opts): ProviderResult | null => {
    const repo = opts?.repo;
    if (!repo) return null;
    // 路径锁：resolve 后必须仍在仓库根内（防 ../ 越界读）
    const abs = path.resolve(repo, filePath);
    const rel = path.relative(repo, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return null; // 文件不存在/不可读 → 渲染端回退
    }
    if (!stat.isFile()) return null;

    const cap = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
    if (stat.size > cap) {
      return { kind: "text", content: `文件超过 Markdown 预览上限（${Math.round(cap / 1024 / 1024)}MB）` };
    }

    // BOM 剥离 + 渲染（产物为静态 HTML 片段，由渲染端包装沙箱文档）
    const src = fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return { kind: "html", content: md.render(src) };
  });
}
export = activate;
