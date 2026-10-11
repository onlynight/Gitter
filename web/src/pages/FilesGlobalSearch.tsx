/**
 * 仓库内全局搜索（Ctrl+Shift+F，files 页）：git grep 后端（repo.search RPC：
 * -F 定长/正则两档、-i 大小写开关、-I 跳二进制、--untracked 含未跟踪）+ 前端面板。
 * 结果行 = 文件:行 + 行内容（命中段高亮），点击 → 打开文件并定位到行。
 * 全部替换：按文件逐个读→替换→写（保留原 EOL/编码/BOM），替换前确认总数；
 * 主进程不感知替换语义，纯前端编排既有读写 RPC。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { pageSdk } from "../pageSdk";
import { CloseIcon } from "./filesIcons";

/** repo.search 行命中（与 treex.SearchHit 同形） */
interface SearchHit {
  file: string;
  line: number;
  text: string;
}

/** 定长查询转正则源（全元字符转义） */
function plainSource(q: string): string {
  return q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 构造匹配正则（全局；非法正则返回 null） */
function buildRegex(q: string, regexMode: boolean, caseSensitive: boolean): RegExp | null {
  try {
    return new RegExp(regexMode ? q : plainSource(q), caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/** 行内容高亮渲染（首个匹配起循环标记；零宽/空匹配防死循环：步进 1） */
function highlightLine(text: string, re: RegExp): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark key={key++}>{m[0].length > 0 ? m[0] : text[m.index] ?? ""}</mark>);
    last = m.index + Math.max(m[0].length, 1);
    if (!rx.global) break;
    if (m[0].length === 0) rx.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function GlobalSearch(props: {
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
  /** 全部替换完成后回调（FilesPage 刷树） */
  onReplaced?: () => void;
}) {
  const t = pageSdk.t;
  const [query, setQuery] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceWith, setReplaceWith] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  // 点击面板外部关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) props.onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [props]);

  const q = query.trim();
  const rx = q ? buildRegex(q, regexMode, caseSensitive) : null;

  const runSearch = useCallback(async () => {
    const queryNow = query.trim();
    const seq = ++seqRef.current;
    if (!queryNow) { setHits([]); setTruncated(false); setError(null); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await pageSdk.call<{ matches: SearchHit[]; truncated: boolean; error?: string } | null>(
        "repo.search", { query: queryNow, regex: regexMode, caseSensitive, max: 300 });
      if (seq !== seqRef.current) return; // 过期响应丢弃
      if (!r || !Array.isArray(r.matches)) throw new Error(r?.error || t("Files_SearchFailed"));
      setHits(r.matches);
      setTruncated(!!r.truncated);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError((e as Error).message);
      setHits([]);
      setTruncated(false);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, regexMode, caseSensitive, t]);

  // 输入防抖自动搜 + Enter 立即搜
  useEffect(() => {
    if (!q) { setHits([]); setTruncated(false); return; }
    const timer = window.setTimeout(() => void runSearch(), 400);
    return () => window.clearTimeout(timer);
  }, [q, caseSensitive, regexMode, runSearch]);

  /** 全部替换：按命中文件逐个 读→替换→写（保留 EOL/编码/BOM） */
  const replaceAll = useCallback(async () => {
    if (!q || !rx || replacing) return;
    const files = [...new Set(hits.map((h) => h.file))];
    const total = hits.length;
    if (files.length === 0) return;
    if (!window.confirm(t("Files_ReplaceConfirm", files.length, total))) return;
    setReplacing(true);
    let doneFiles = 0;
    let doneCount = 0;
    const apply = new RegExp(rx.source, "g");
    for (const f of files) {
      try {
        const r = await pageSdk.call<{
          content: string; eol: "crlf" | "lf"; encoding: "utf8" | "gbk"; bom: boolean;
        } | null>("file.content", { path: f, encoding: undefined });
        if (!r || !r.content) continue;
        let count = 0;
        const next = r.content.replace(apply, () => { count++; return replaceWith; });
        if (count === 0) continue;
        const w = await pageSdk.call<{ ok: boolean }>("file.write", {
          path: f, content: next, eol: r.eol, encoding: r.encoding, bom: r.bom,
        });
        if (w?.ok) { doneFiles++; doneCount += count; }
      } catch { /* 单文件失败跳过，最后汇总提示 */ }
    }
    setReplacing(false);
    pageSdk.toast(t("Files_ReplaceAll"), t("Files_Replaced", doneCount, doneFiles));
    props.onReplaced?.();
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, rx, hits, replaceWith, replacing, runSearch, props, t]);

  // 汇总文件列表（文件去重序）
  const fileCount = new Set(hits.map((h) => h.file)).size;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.28)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 42 }}>
      <div
        ref={rootRef}
        style={{
          width: 640, maxWidth: "92%", maxHeight: "70%", display: "flex", flexDirection: "column",
          borderRadius: 8, border: "1px solid var(--c-border)", background: "var(--c-panel, var(--c-base))",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)", overflow: "hidden",
        }}
      >
        {/* 输入行 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 4px" }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t("Files_SearchContent")}
            spellCheck={false}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "inherit", fontSize: 13 }}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void runSearch(); }
              else if (e.key === "Escape") { e.stopPropagation(); props.onClose(); }
              else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
                e.preventDefault();
                setReplaceOpen(true);
              }
            }}
          />
          <button
            className={"files-ibtn" + (caseSensitive ? " on" : "")}
            title={t("Files_SearchCaseSensitive")}
            style={{ width: 24, height: 24, fontSize: 12, fontWeight: 700 }}
            onClick={() => setCaseSensitive((v) => !v)}
          >Aa</button>
          <button
            className={"files-ibtn" + (regexMode ? " on" : "")}
            title={t("Files_SearchRegex")}
            style={{ width: 24, height: 24, fontSize: 12, fontWeight: 700 }}
            onClick={() => setRegexMode((v) => !v)}
          >.*</button>
          <button className="files-ibtn" title={t("Files_SearchReplace")} style={{ width: 24, height: 24 }}
            onClick={() => setReplaceOpen((v) => !v)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3.5h7M3 6.5h4M12 9.5l2 2-2 2M6 12.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button className="files-ibtn" title={t("Common_Close")} style={{ width: 24, height: 24 }} onClick={props.onClose}><CloseIcon /></button>
        </div>
        {/* 替换行 */}
        {replaceOpen && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px 6px" }}>
            <input
              type="text"
              value={replaceWith}
              placeholder={t("Files_SearchReplace")}
              spellCheck={false}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "inherit", fontSize: 13 }}
              onChange={(e) => setReplaceWith(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void replaceAll(); } }}
            />
            <button className="tool-btn" disabled={replacing || hits.length === 0} onClick={() => void replaceAll()}>
              {replacing ? t("Editor_Saving") : t("Files_ReplaceAll")}
            </button>
          </div>
        )}
        {/* 状态行 */}
        <div style={{ display: "flex", gap: 8, padding: "2px 12px 6px", fontSize: 11.5, opacity: 0.65 }}>
          {error ? <span style={{ color: "var(--c-red, #e5534b)" }}>{error}</span> : (
            <>
              {q && <span>{busy ? t("Files_Searching") : t("Files_FilterMatches", hits.length)}{fileCount > 1 ? ` · ${fileCount} ${t("Files_SearchFiles")}` : ""}</span>}
              {truncated && <span>{t("Files_SearchTruncated", 300)}</span>}
            </>
          )}
        </div>
        {/* 结果列表 */}
        <div style={{ flex: 1, overflow: "auto", borderTop: "1px solid var(--c-border)", paddingBottom: 6 }}>
          {hits.map((h, i) => (
            <div
              key={`${h.file}:${h.line}:${i}`}
              className="qrow"
              style={{ position: "static", display: "flex", gap: 8, padding: "2px 12px", cursor: "pointer", fontSize: 12.5 }}
              title={`${h.file}:${h.line}`}
              onClick={() => props.onOpen(h.file, h.line)}
            >
              <span style={{ flex: "none", opacity: 0.65, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.file}
              </span>
              <span style={{ flex: "none", opacity: 0.5, fontVariantNumeric: "tabular-nums" }}>{h.line}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {rx ? highlightLine(h.text, rx) : h.text}
              </span>
            </div>
          ))}
          {q && !busy && hits.length === 0 && !error && (
            <div style={{ padding: "10px 12px", opacity: 0.6, fontSize: 12.5 }}>{t("Files_NoMatch")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
