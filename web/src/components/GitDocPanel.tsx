import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, Select } from "../kit";
import { pageSdk, useAppState, useDocs, docTitle } from "../pageSdk";
import type { DocDescriptor } from "../pageSdk";
import docSource from "./GitCommands.md?raw";

/**
 * 终端页 Git 命令文档面板（design/terminal-git-docs-mockup.html 实现落点，插件化文档）：
 * 文档源走 docRegistry 注册表（宿主单源，pageSdk 消费）——内置 Git 手册在本模块
 * eval 期自举注册（builtin 层，第三方包可同 id 覆盖或另立新篇），面板按注册表渲染，
 * >1 篇时头部出 Select 切换器。左上汉堡 → 目录浮层（三级目录 + 标题搜索 + scroll-spy
 * + 点击跳转），右上查找条（n/m 循环定位）。纯渲染层组件，零 RPC。
 */
const { t } = pageSdk;

/** 内置 Git 命令手册：与插件包同接缝注册（builtin 层）。模块 eval 期 = loader 注入窗口内，层级自动归因。 */
pageSdk.registerDoc({
  id: "builtin.git-commands",
  title: () => t("Terminal_DocTitle"),
  source: () => docSource,
});

interface TocItem {
  id: string;
  text: string;
  level: string;
}

/** 标题「中文功能名 git xxx」尾部命令名（含 "git a / git b" 复合形），渲染为 mono 徽标 */
const CMD_TAIL_RE = /^(.*?)(git\s+[\w./@^{}~-]+(?:\s*\/\s*git\s+[\w./@^{}~-]+)*)\s*$/;

/** 目录搜索关键字高亮（React 节点，避免 innerHTML） */
function markLabel(text: string, kw: string) {
  const i = kw ? text.toLowerCase().indexOf(kw.toLowerCase()) : -1;
  if (!kw || i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + kw.length)}</mark>
      {text.slice(i + kw.length)}
    </>
  );
}

export function GitDocPanel({ onClose }: { onClose: () => void }) {
  useAppState(); // 订阅宿主 store：语言/主题切换时随渲染更新
  const docs = useDocs();
  const bodyRef = useRef<HTMLDivElement>(null);
  const tocSearchRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const hitsRef = useRef<HTMLElement[]>([]);
  const curRef = useRef(-1);

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const activeDoc = docs.find((d) => d.doc.id === activeDocId) ?? docs[0] ?? null;
  const activeId = activeDoc?.doc.id ?? "";

  const [content, setContent] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocKw, setTocKw] = useState("");
  const [spyId, setSpyId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findKw, setFindKw] = useState("");
  const [findState, setFindState] = useState<{ count: number; cur: number } | null>(null);

  // 切换文档：查找/目录搜索/滚动位置全部重置（TOC 随内容重建）
  useEffect(() => {
    clearMarks();
    setFindOpen(false);
    setFindKw("");
    setFindState(null);
    setTocKw("");
    setSpyId(null);
    bodyRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 加载当前文档源（source 可同步可 Promise——包资源/远程文档均可）
  useEffect(() => {
    let alive = true;
    if (!activeDoc) {
      setContent(null);
      return;
    }
    Promise.resolve(activeDoc.doc.source()).then(
      (md) => {
        if (alive) setContent(md);
      },
      () => {
        if (alive) setContent(null);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const html = useMemo(() => renderMarkdown(content ?? ""), [content]);

  /** 渲染后处理：标题分配锚点 id + 命令名徽标 + 构建三级目录（每次内容变化后重建） */
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || content === null) return;
    const items: TocItem[] = [];
    let sec = 0;
    for (const h of Array.from(root.querySelectorAll("h1, h2, h3, h4"))) {
      const text = h.textContent ?? "";
      const m = CMD_TAIL_RE.exec(text);
      if (m) {
        const name = document.createElement("span");
        name.textContent = m[1];
        const cmd = document.createElement("span");
        cmd.className = "cmd";
        cmd.textContent = m[2];
        h.replaceChildren(name, cmd);
      }
      if (h.tagName !== "H1") {
        const id = `gitdoc-sec-${sec++}`;
        h.id = id;
        items.push({ id, text, level: h.tagName.toLowerCase() });
      }
    }
    setToc(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  /** 清除正文查找高亮（mark → 还原纯文本节点） */
  function clearMarks() {
    const root = bodyRef.current;
    if (!root) return;
    root.querySelectorAll("mark.hit").forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent ?? ""), m);
      p.normalize();
    });
    hitsRef.current = [];
    curRef.current = -1;
  }

  const paintCur = (cur: number) => {
    const hits = hitsRef.current;
    hits.forEach((m, i) => m.classList.toggle("cur", i === cur));
    if (cur >= 0) hits[cur].scrollIntoView({ block: "center" });
    else if (hits.length === 0 && findKw) bodyRef.current?.scrollTo({ top: 0 });
  };

  /** 正文查找：大小写不敏感子串，全部命中 <mark.hit>，当前命中加 .cur */
  function runFind(kw: string) {
    const root = bodyRef.current;
    if (!root) return;
    clearMarks();
    if (!kw) {
      setFindState(null);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("mark.hit") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const kwL = kw.toLowerCase();
    const hits: HTMLElement[] = [];
    for (const node of nodes) {
      const text = node.nodeValue ?? "";
      const low = text.toLowerCase();
      let idx = low.indexOf(kwL);
      if (idx < 0) continue;
      const frag = document.createDocumentFragment();
      let pos = 0;
      while (idx >= 0) {
        frag.appendChild(document.createTextNode(text.slice(pos, idx)));
        const mark = document.createElement("mark");
        mark.className = "hit";
        mark.textContent = text.slice(idx, idx + kw.length);
        frag.appendChild(mark);
        hits.push(mark);
        pos = idx + kw.length;
        idx = low.indexOf(kwL, pos);
      }
      frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode?.replaceChild(frag, node);
    }
    hitsRef.current = hits;
    const cur = hits.length ? 0 : -1;
    curRef.current = cur;
    setFindState({ count: hits.length, cur });
    if (cur >= 0) hits[cur].scrollIntoView({ block: "center" });
  }

  function stepFind(d: number) {
    const hits = hitsRef.current;
    if (!hits.length) return;
    const cur = (curRef.current + d + hits.length) % hits.length;
    curRef.current = cur;
    paintCur(cur);
    setFindState({ count: hits.length, cur });
  }

  const openFind = () => {
    setFindOpen(true);
    setTimeout(() => findInputRef.current?.focus(), 150);
  };
  const closeFind = () => {
    setFindOpen(false);
    setFindKw("");
    setFindState(null);
    clearMarks();
  };

  const openToc = () => {
    setTocOpen(true);
    syncActive();
    setTimeout(() => tocSearchRef.current?.focus(), 150);
  };

  /** scroll-spy：正文滚动位置 → 当前章节（目录条目高亮联动） */
  function syncActive() {
    const root = bodyRef.current;
    if (!root || !toc.length) return;
    const top = root.scrollTop;
    let cur: string | null = toc[0]?.id ?? null;
    for (const it of toc) {
      const el = document.getElementById(it.id);
      if (el && el.offsetTop <= top + 24) cur = it.id;
      else break;
    }
    setSpyId(cur);
  }

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) bodyRef.current?.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: "smooth" });
    setTocOpen(false);
  };

  // Esc 分层收起：先查找条，后目录浮层（输入框内 Esc 由输入框自管：先清关键字再收起）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || (e.target as HTMLElement).tagName === "INPUT") return;
    if (findOpen) {
      e.preventDefault();
      closeFind();
    } else if (tocOpen) {
      e.preventDefault();
      setTocOpen(false);
    }
  };

  const kwL = tocKw.trim().toLowerCase();
  const visibleToc = kwL ? toc.filter((it) => it.text.toLowerCase().includes(kwL)) : toc;
  const findCountText = !findKw || !findState
    ? ""
    : `${findState.count > 0 ? findState.cur + 1 : 0} / ${findState.count}`;

  return (
    <div className="git-doc" onKeyDown={onKeyDown}>
      <div className="git-doc-inner">
        <div className="git-doc-head">
          <button className="tool-btn icon" aria-expanded={tocOpen} title={t("Terminal_DocToc")}
            onClick={() => (tocOpen ? setTocOpen(false) : openToc())}>
            <span className="glyph">{"\uE700"}</span>
          </button>
          {docs.length > 1 ? (
            <Select
              className="git-doc-switch"
              title={t("Terminal_DocSwitch")}
              value={activeId}
              options={docs.map((d) => ({ value: d.doc.id, label: docTitle(d.doc) }))}
              onChange={(id) => setActiveDocId(id)}
            />
          ) : (
            <span className="git-doc-title">{activeDoc ? docTitle(activeDoc.doc) : ""}</span>
          )}
          <span style={{ flex: 1 }} />
          <button className={"tool-btn icon" + (findOpen ? " on" : "")} title={t("Terminal_DocFind")}
            onClick={() => (findOpen ? closeFind() : openFind())}>
            <span className="glyph">{"\uE721"}</span>
          </button>
          <button className="tool-btn icon" title={t("Terminal_DocClosePanel")} onClick={onClose}>
            <span className="glyph">{"\uE711"}</span>
          </button>
        </div>
        <div className={"git-doc-find" + (findOpen ? " open" : "")}>
          <span className="glyph git-doc-find-ico">{"\uE721"}</span>
          <input
            ref={findInputRef}
            value={findKw}
            placeholder={t("Terminal_DocFindPlaceholder")}
            autoComplete="off"
            onChange={(e) => {
              setFindKw(e.target.value);
              runFind(e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepFind(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeFind();
              }
            }}
          />
          <span className={"git-doc-find-count" + (findKw && findState?.count === 0 ? " none" : "")}>{findCountText}</span>
          <button className="tool-btn sm icon" title={t("Terminal_DocFindPrev")} onClick={() => stepFind(-1)}>
            <span className="glyph">{"\uE70E"}</span>
          </button>
          <button className="tool-btn sm icon" title={t("Terminal_DocFindNext")} onClick={() => stepFind(1)}>
            <span className="glyph">{"\uE70D"}</span>
          </button>
          <button className="tool-btn sm icon" title={t("Terminal_DocFindClose")} onClick={closeFind}>
            <span className="glyph">{"\uE711"}</span>
          </button>
        </div>
        <div
          className="git-doc-body md-body"
          ref={bodyRef}
          onScroll={syncActive}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <div className={"git-doc-scrim" + (tocOpen ? " open" : "")} onClick={() => setTocOpen(false)} />
      <aside className={"git-doc-toc" + (tocOpen ? " open" : "")} aria-hidden={!tocOpen}>
        <div className="git-doc-toc-head">
          <button className="tool-btn sm icon" title={t("Terminal_DocTocClose")} onClick={() => setTocOpen(false)}>
            <span className="glyph">{"\uE711"}</span>
          </button>
          {t("Terminal_DocToc")}
        </div>
        <div className="git-doc-toc-search">
          <span className="glyph">{"\uE721"}</span>
          <input
            ref={tocSearchRef}
            value={tocKw}
            placeholder={t("Terminal_DocTocSearch")}
            autoComplete="off"
            onChange={(e) => setTocKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              if (tocKw) setTocKw("");
              else setTocOpen(false);
            }}
          />
        </div>
        <div className="git-doc-toc-count">
          {kwL ? t("Terminal_DocSectionsHit", visibleToc.length, toc.length) : t("Terminal_DocSections", toc.length)}
        </div>
        <nav className="git-doc-toc-list">
          {visibleToc.map((it) => (
            <button
              key={it.id}
              className={"git-doc-toc-item lv-" + it.level + (it.id === spyId ? " active" : "")}
              data-id={it.id}
              onClick={() => jumpTo(it.id)}
            >
              {markLabel(it.text, kwL)}
            </button>
          ))}
          {kwL && visibleToc.length === 0 && (
            <div className="git-doc-toc-empty">
              {t("Terminal_DocTocEmpty")}
              <div className="git-doc-toc-empty-hint">{t("Terminal_DocTocEmptyHint")}</div>
            </div>
          )}
        </nav>
      </aside>
    </div>
  );
}
