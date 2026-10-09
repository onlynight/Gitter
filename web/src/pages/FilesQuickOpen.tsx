/**
 * 快速打开（Ctrl+P，files-editor-redesign-mockup.html §三）：
 * 全仓库文件路径的子序列模糊匹配 + ↑↓ 选择 + Enter 打开（预览标签）+ Esc 关闭。
 * 纯前端过滤（repo.tree 已全量在内存），零 RPC。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { pageSdk } from "../pageSdk";
import { FileIcon } from "./filesIcons";

/** 子序列匹配：q 的字符按序出现在 s 中即命中（大小写不敏感）。 */
function fuzzy(q: string, s: string): boolean {
  let i = 0;
  for (const ch of s) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

export function QuickOpen(props: {
  files: string[];
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const t = pageSdk.t;
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();

  const items = useMemo(() => {
    const hits = props.files.filter((f) => fuzzy(q, f));
    const base = (p: string) => p.split("/").pop() ?? p;
    return hits.slice().sort((a, b) => {
      if (!q) return a.localeCompare(b);
      const ab = base(a).toLowerCase();
      const bb = base(b).toLowerCase();
      const sa = ab.startsWith(q) ? 0 : ab.includes(q) ? 1 : 2;
      const sb = bb.startsWith(q) ? 0 : bb.includes(q) ? 1 : 2;
      return sa !== sb ? sa - sb : a.localeCompare(b);
    });
  }, [props.files, q]);

  useEffect(() => setSel(0), [query]);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    listRef.current?.querySelector(".qrow.sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // 点击面板外部关闭（mousedown 先于外部元素的 click，避免误触底层）
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCloseRef.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (path: string | undefined) => {
    if (!path) return;
    props.onOpen(path);
    props.onClose();
  };

  return (
    <div className="qo" ref={rootRef} role="dialog" aria-label={t("Files_QuickOpen")}>
      <input
        ref={inputRef}
        type="text"
        placeholder={t("Files_QuickOpen")}
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((v) => Math.min(v + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((v) => Math.max(v - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(items[sel]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            props.onClose();
          }
        }}
      />
      <div className="qlist" ref={listRef}>
        {items.length === 0 ? (
          <div className="qempty">{t("Files_NoMatch")}</div>
        ) : (
          items.slice(0, 50).map((p, i) => (
            <div
              key={p}
              className={"qrow" + (i === sel ? " sel" : "")}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(p)}
            >
              <span className="fico" style={{ display: "inline-flex" }}><FileIcon path={p} /></span>
              <span className="nm">{p.split("/").pop()}</span>
              <span className="p">{p}</span>
            </div>
          ))
        )}
      </div>
      <div className="qhint">
        <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> {t("Common_Choose")}</span>
        <span><kbd className="kbd">Enter</kbd> {t("Files_TreeOpen")}</span>
        <span><kbd className="kbd">Esc</kbd> {t("Common_Close")}</span>
      </div>
    </div>
  );
}
