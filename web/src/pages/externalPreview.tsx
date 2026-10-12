/**
 * 外部预览查看器（file.preview previewProviders 接缝的渲染端适配）：
 * L2 插件经 ctx.registerPreviewProvider 注册的扩展名，file.preview 返回
 * {kind:"html"|"text", content}（插件优先；无插件时内置通道对文本扩展名返回 null）。
 * html 分两档：markdown-it 产物 → sandbox="" 无脚本 iframe + 阅读排版包装；
 * HTML 文件原文 → allow-scripts 沙箱 iframe（无 allow-same-origin，源为 opaque，
 * 读不到宿主/文件系统），不包装不改写。无 provider → 回退卡（提示装插件 +
 * 可选「编辑源文件」）。
 * 文件页画布（filesViewers seam）与任务面板预览共用——本模块不依赖 monaco/pageSdk
 * （页面私有依赖边界），RPC 走 bridge/client。
 */
import { useEffect, useState } from "react";
import { call } from "../bridge/client";
import { useAppState } from "../pageSdk";

/** Markdown 扩展名（外部预览插件 com.gitter.markdown-preview 的注册面） */
export const MD_EXTS = [".md", ".markdown"];

/** HTML 扩展名（外部预览插件 com.gitter.html-preview 的注册面） */
export const HTML_EXTS = [".html", ".htm"];

export function isMdPath(p: string): boolean {
  const i = p.lastIndexOf(".");
  return i >= 0 && MD_EXTS.includes(p.slice(i).toLowerCase());
}

export function isHtmlPath(p: string): boolean {
  const i = p.lastIndexOf(".");
  return i >= 0 && HTML_EXTS.includes(p.slice(i).toLowerCase());
}

/** 外部预览插件接管的路径（md + html）——面包屑「编辑源文件/预览」切换按钮的判定面 */
export function isExternalPreviewPath(p: string): boolean {
  return isMdPath(p) || isHtmlPath(p);
}

/** file.preview 双形态：provider 结果（kind/content）与内置通道（mime/base64） */
type FilePreviewResult =
  | { kind: "html" | "text"; content: string }
  | { mime: string; base64: string; fromIndex: boolean; tooLarge?: boolean }
  | null;

function isProviderResult(r: FilePreviewResult): r is { kind: "html" | "text"; content: string } {
  return !!r && typeof (r as { kind?: unknown }).kind === "string" && typeof (r as { content?: unknown }).content === "string";
}

/** highlight.snippet 的 TokenRun（与 highlight.file 同形；行内偏移 [start,end)） */
interface TokenRun { start: number; end: number; style: string; color?: string }

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 单行 TokenRun → 带色 span 序列（间隙 plain 原样；style 无色表命中时整段原样） */
function runsToHtml(line: string, runs: TokenRun[], colors: Record<string, string>): string {
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

/**
 * 代码块高亮注入（方案：渲染端增强——插件保持零宿主依赖，只输出
 * <pre><code class="language-x">；本函数把每个代码块交给 highlight.snippet
 * （宿主三层降级链 TextMate → 声明式 → plain），替换为带色 span 再回拼 HTML。
 * 主题切换时调用方重拉 file.preview → 颜色随主题即时更新。失败块保留原样降级。
 */
async function injectCodeHighlight(html: string): Promise<string> {
  if (!html.includes("<code")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const codes = [...doc.querySelectorAll("pre > code")];
  if (codes.length === 0) return html;
  const results = await Promise.all(codes.map(async (el): Promise<{ el: Element; html: string } | null> => {
    const lang = /language-([\w+#.-]+)/.exec(el.className)?.[1] ?? null;
    if (!lang) return null; // 无语言标注的围栏块不浪费 RPC
    const code = el.textContent ?? "";
    if (!code.trim()) return null;
    try {
      const r = await call<{ lines: TokenRun[][]; syntaxColors: Record<string, string> } | null>(
        "highlight.snippet", { code, lang });
      if (!r || r.lines.length === 0) return null;
      const htmlLines = code.split("\n").map((line, i) => runsToHtml(line, r.lines[i] ?? [], r.syntaxColors));
      return { el, html: htmlLines.join("\n") };
    } catch {
      return null; // 单块失败不拖垮整页（保留无色原文）
    }
  }));
  let changed = false;
  for (const res of results) {
    if (!res) continue;
    res.el.innerHTML = res.html; // 仅写入本函数生成的 escape 过 span，不引入插件侧标记
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

/** markdown 阅读排版（沙箱 iframe 内联文档；亮暗两档随宿主 data-base） */
export function mdSrcdoc(html: string, dark: boolean): string {
  const c = dark
    ? { bg: "#14161B", fg: "#D4D4D4", fg2: "#A8B0BC", fg3: "#78828E", border: "#FFFFFF21", thumb: "#FFFFFF40", thumbHover: "#FFFFFF59", codeBg: "#FFFFFF12", link: "#6BABF5" }
    : { bg: "#FFFFFF", fg: "#1B1B1B", fg2: "#5C5C5C", fg3: "#8F8F8F", border: "#E5E5E5", thumb: "#C9C9CE", thumbHover: "#AFAFB5", codeBg: "#F2F2F3", link: "#0B6BCB" };
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

/**
 * 外部预览画布：填满定位父级（absolute inset 0）。file.preview 命中 provider 出
 * 沙箱 iframe/纯文本；未命中（返回 null 或内置图片形态）出回退卡，可选「编辑源文件」。
 * key=path 重挂即换文件——竞态用 stale 标记丢弃迟到响应。
 */
export function ExternalFilePreview(props: {
  path: string;
  dark?: boolean;
  /** 回退卡动作（文件页 = 切 Monaco 文本模式；任务面板 = 跳内置编辑器）；缺省不显按钮 */
  onEditText?: () => void;
  fallbackTitle?: string;
  fallbackBody?: string;
  editLabel?: string;
}) {
  // 主题（亮暗）来自页面状态：变化即重拉 file.preview——代码块高亮色随主题即时更新
  const theme = useAppState().theme;
  const dark = props.dark ?? (theme?.base ?? "dark") !== "light";
  // HTML 文件（原文透传）：不走 markdown 排版包装，也不做代码块高亮注入
  // （DOMParser 重拼会剥掉 doctype/head）——沙箱档位也由它决定
  const htmlRaw = isHtmlPath(props.path);
  const [phase, setPhase] = useState<
    | { kind: "loading" }
    | { kind: "html"; content: string }
    | { kind: "text"; content: string }
    | { kind: "fallback" }
  >({ kind: "loading" });

  useEffect(() => {
    let stale = false;
    setPhase({ kind: "loading" });
    call<FilePreviewResult>("file.preview", { path: props.path })
      .then(async (r) => {
        if (stale) return;
        if (isProviderResult(r)) {
          // html 形态先注入代码块高亮（失败整页降级原文，不阻塞预览）；HTML 原文除外
          const content = r.kind === "html" && !isHtmlPath(props.path)
            ? await injectCodeHighlight(r.content).catch(() => r.content)
            : r.content;
          if (!stale) setPhase({ kind: r.kind, content });
        } else setPhase({ kind: "fallback" });
      })
      .catch(() => { if (!stale) setPhase({ kind: "fallback" }); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.path, dark]);

  const name = props.path.split("/").pop() ?? props.path;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {phase.kind === "loading" ? null : phase.kind === "html" ? (
        <iframe
          className="extpreview-frame"
          sandbox={htmlRaw ? "allow-scripts allow-forms allow-modals" : ""}
          title={name}
          srcDoc={htmlRaw ? phase.content : mdSrcdoc(phase.content, dark)}
        />
      ) : phase.kind === "text" ? (
        <pre className="extpreview-text">{phase.content}</pre>
      ) : (
        <div className="office-welcome">
          <div className="edwm">{name}</div>
          <div className="list" style={{ alignItems: "flex-start" }}>
            <div className="h">{props.fallbackTitle ?? "外部预览不可用"}</div>
            <div className="wrow" style={{ height: "auto", whiteSpace: "normal" }}>
              <span className="nm2">{props.fallbackBody ?? "未安装提供该格式预览的插件（设置 → 扩展 → 允许代码插件）"}</span>
            </div>
            {props.onEditText && (
              <button className="tool-btn primary" style={{ marginTop: 10 }} onClick={props.onEditText}>
                {props.editLabel ?? "编辑源文件"}
              </button>
            )}
          </div>
        </div>
      )}
      {/* 编辑入口在宿主侧（文件页 = 面包屑右钮；任务面板 = viewbar 内置编辑器）——
          预览态不重复放悬浮按钮；回退卡场景的「编辑源文件」保留在卡内 */}
    </div>
  );
}
