/**
 * 快速打开（Ctrl+P，files-editor-redesign-mockup.html §三）：
 * 全仓库文件路径的子序列模糊匹配 + ↑↓ 选择 + Enter 打开（预览标签）+ Esc 关闭。
 * 纯前端过滤（repo.tree 已全量在内存），零 RPC。
 * 结果全量虚拟化渲染（不截断）+ 匹配质量打分（词边界/连续命中/basename 优先）
 * + 命中字符高亮——大仓库命中成百上千时仍全可见、相关者优先。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode } from "react";
import { pageSdk } from "../pageSdk";
import { FileIcon } from "./filesIcons";

/** 行高（虚拟化定高，与 .qo .qrow height 一致） */
const ROW_H = 30;

/** 词边界字符（命中紧随其后 = 更可能是文件名/段首） */
const SEPARATORS = "/\\-_. ";

interface Hit {
  path: string;
  /** 命中下标（path 原始下标）；空查询为 [] */
  pos: number[];
  score: number;
}

/** 贪心子序列匹配（大小写不敏感），返回命中下标；未命中返回 null */
function fuzzyMatch(q: string, s: string): number[] | null {
  const pos: number[] = [];
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) {
      pos.push(j);
      i++;
    }
  }
  return i === q.length ? pos : null;
}

/** 匹配质量分：词边界/连续命中/basename 内/短路径加成（分高者前） */
function scoreOf(path: string, pos: number[]): number {
  const bStart = path.lastIndexOf("/") + 1;
  let score = 0;
  for (let k = 0; k < pos.length; k++) {
    const i = pos[k];
    score += 2;
    if (i === 0 || SEPARATORS.includes(path[i - 1])) score += 6;
    if (k > 0 && pos[k - 1] === i - 1) score += 8;
    if (i >= bStart) score += 4;
  }
  if (pos.length > 0 && pos[0] === bStart) score += 25;
  score -= Math.min(path.length, 80) * 0.05;
  return score;
}

/** 按下标集高亮字符串片段（indices 相对 s 本身，升序） */
function hl(s: string, indices: number[]): ReactNode {
  if (indices.length === 0) return s;
  const out: ReactNode[] = [];
  let last = 0;
  for (const i of indices) {
    if (i > last) out.push(s.slice(last, i));
    out.push(<mark key={i}>{s[i]}</mark>);
    last = i + 1;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
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

  // 全量命中 + 打分排序（不截断——渲染层虚拟化，命中多少都全可见）
  const items = useMemo<Hit[]>(() => {
    const hits: Hit[] = [];
    if (!q) {
      for (const f of props.files) hits.push({ path: f, pos: [], score: 0 });
    } else {
      for (const f of props.files) {
        const pos = fuzzyMatch(q, f.toLowerCase());
        if (pos) hits.push({ path: f, pos, score: scoreOf(f, pos) });
      }
    }
    return hits.sort((a, b) =>
      a.score !== b.score ? b.score - a.score : a.path.localeCompare(b.path));
  }, [props.files, q]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  useEffect(() => setSel(0), [query]);

  useEffect(() => inputRef.current?.focus(), []);

  // 选中行滚入可视区（虚拟化：直接滚窗口，不依赖行 DOM 存在）
  useEffect(() => {
    if (items.length > 0) virtualizer.scrollToIndex(sel, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const bStartOf = (p: string) => p.lastIndexOf("/") + 1;

  const rows = virtualizer.getVirtualItems().map((vi) => {
    const hit = items[vi.index];
    const bStart = bStartOf(hit.path);
    const base = hit.path.slice(bStart);
    const dir = bStart > 0 ? hit.path.slice(0, bStart - 1) : "";
    // basename / 目录段各自的下标集（pos 全路径下标拆分）
    const basePos: number[] = [];
    const dirPos: number[] = [];
    for (const i of hit.pos) (i >= bStart ? basePos : dirPos).push(i >= bStart ? i - bStart : i);
    return (
      <div
        key={hit.path}
        className={"qrow" + (vi.index === sel ? " sel" : "")}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vi.start}px)` }}
        onMouseEnter={() => setSel(vi.index)}
        onClick={() => pick(hit.path)}
      >
        <span className="fico" style={{ display: "inline-flex" }}><FileIcon path={hit.path} /></span>
        <span className="nm">{hl(base, basePos)}</span>
        <span className="p">{dir ? hl(dir, dirPos) : null}</span>
      </div>
    );
  });

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
            pick(items[Math.min(sel, items.length - 1)]?.path);
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
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{rows}</div>
        )}
      </div>
      <div className="qhint">
        <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> {t("Common_Choose")}</span>
        <span><kbd className="kbd">Enter</kbd> {t("Files_TreeOpen")}</span>
        <span><kbd className="kbd">Esc</kbd> {t("Common_Close")}</span>
        {q && <span className="qcount">{t("Files_FilterMatches", items.length)}</span>}
      </div>
    </div>
  );
}
