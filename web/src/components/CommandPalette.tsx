import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge/client";
import type { CommandDTO } from "../bridge/types";
import { navigate, routeCommand, t, updateSettings, useApp, type PageKey } from "../state/store";

interface Command {
  id: string;
  category: string;
  title: string;
  keyHint?: string;
  enabled: boolean;
  run: () => void;
}

/** 内置命令执行体（extension-system-v2.md §九：元数据在宿主 CommandReg，执行体留在渲染层）。 */
function builtinRunner(id: string, repoPath: string | null): (() => void) | null {
  const route = (cmd: string) => () => routeCommand(cmd);
  switch (id) {
    case "repo.refresh": return () => window.dispatchEvent(new CustomEvent("gitter:refresh"));
    case "repo.newWindow": return () => void call("app.newWindow", { path: repoPath });
    case "commit": return route("changes.commit");
    case "commit.push": return route("changes.commitPush");
    case "changes.stageAll": return route("changes.stageAll");
    case "changes.unstageAll": return route("changes.unstageAll");
    case "branches.create": return route("branches.create");
    case "branches.checkout": return route("branches.checkout");
    case "branches.pull": return route("branches.pull");
    case "branches.pullRebase": return route("branches.pullRebase");
    case "branches.push": return route("branches.push");
    case "view.diffSide": return () => void updateSettings({ diffMode: "sideBySide" });
    case "view.diffInline": return () => void updateSettings({ diffMode: "inline" });
    case "view.themeSystem": return () => void updateSettings({ theme: "system" });
    case "view.themeLight": return () => void updateSettings({ theme: "light" });
    case "view.themeDark": return () => void updateSettings({ theme: "dark" });
    default: return null;
  }
}

/** 命令面板 v2（docs/command-palette-v2.md 语义的 web 版）：Ctrl+Shift+P 全量 / Ctrl+P 预填 ">"。
 * 数据源 = 宿主 CommandReg（commands.list），扩展包命令经 commands.exec 白名单执行。 */
export function CommandPalette({ onClose, prefill }: { onClose: () => void; prefill?: string }) {
  const { repo, settings } = useApp();
  const [query, setQuery] = useState(prefill ?? "");
  const [selected, setSelected] = useState(-1); // 相对 items 的索引
  const listRef = useRef<HTMLDivElement>(null);
  const [remote, setRemote] = useState<CommandDTO[]>([]);

  const repoOpen = !!repo;

  useEffect(() => {
    let cancelled = false;
    void call<CommandDTO[]>("commands.list").then((cmds) => {
      if (!cancelled) setRemote(cmds);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const commands: Command[] = useMemo(
    () =>
      remote.map((c) => {
        const id = c.id;
        const title = (c.titleKey ? t(c.titleKey) : c.title) ?? id;
        const category = (c.categoryKey ? t(c.categoryKey) : c.category) ?? "";
        const run =
          id.startsWith("goto.")
            ? () => navigate(id.slice(5) as PageKey)
            : builtinRunner(id, repo?.workDir ?? null) ??
              (() => {
                void call("commands.exec", { id }).catch((e) => console.warn("命令执行失败:", (e as Error).message));
              });
        return { id, category, title, keyHint: c.keyHint, enabled: c.when !== "repoOpen" || repoOpen, run };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remote, repoOpen, repo?.workDir],
  );

  // 过滤（子串不区分大小写；">" 前缀仅为命令模式标记，v1 与默认同义）
  const filtered = useMemo(() => {
    const q = query.replace(/^>\s*/, "").trim().toLowerCase();
    const recent = settings?.recentCommands ?? [];
    const match = (c: Command) =>
      !q || c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || c.id.includes(q);
    const rows: ({ kind: "header"; text: string } | { kind: "cmd"; cmd: Command })[] = [];
    if (!q && recent.length > 0) {
      const recentCmds = recent.map((id) => commands.find((c) => c.id === id)).filter((c): c is Command => !!c && c.enabled);
      if (recentCmds.length > 0) {
        rows.push({ kind: "header", text: t("Palette_Recent") });
        recentCmds.forEach((c) => rows.push({ kind: "cmd", cmd: c }));
      }
    }
    const byCat = new Map<string, Command[]>();
    for (const c of commands) {
      if (!match(c) || !c.enabled) continue;
      if (!byCat.has(c.category)) byCat.set(c.category, []);
      byCat.get(c.category)!.push(c);
    }
    for (const [cat, cmds] of byCat) {
      rows.push({ kind: "header", text: cat });
      cmds.forEach((c) => rows.push({ kind: "cmd", cmd: c }));
    }
    return rows;
  }, [query, commands, settings]);

  const items = filtered.filter((r) => r.kind === "cmd") as { kind: "cmd"; cmd: Command }[];
  useEffect(() => setSelected(items.length > 0 ? 0 : -1), [query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = listRef.current?.querySelector(".palette-row.item.selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const execute = (cmd: Command) => {
    call("settings.rememberCommand", { id: cmd.id });
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selected >= 0 && items[selected]) execute(items[selected].cmd);
    }
  };

  // 行索引（跳过组头）
  let itemIndex = -1;
  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <input
          autoFocus
          value={query}
          placeholder={t("Palette_InputPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.map((row, i) => {
            if (row.kind === "header") return <div className="palette-row header" key={i}>{row.text}</div>;
            itemIndex++;
            const idx = itemIndex;
            return (
              <div
                key={i}
                className={"palette-row item" + (idx === selected ? " selected" : "")}
                onMouseEnter={() => setSelected(idx)}
                onClick={() => execute(row.cmd)}
              >
                <span className="cmd-title">{row.cmd.title}</span>
                {row.cmd.keyHint && <kbd>{row.cmd.keyHint}</kbd>}
              </div>
            );
          })}
          {items.length === 0 && <div className="palette-row header">{t("Palette_NoMatches")}</div>}
        </div>
        <div className="palette-footer">
          <span>{t("Palette_FooterKeys")}</span>
          <span>{t("Palette_FooterAt")}</span>
        </div>
      </div>
    </div>
  );
}
