import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge/client";
import { navigate, routeCommand, t, useApp, type PageKey } from "../state/store";

interface Command {
  id: string;
  category: string;
  title: string;
  keyHint?: string;
  enabled: boolean;
  run: () => void;
}

/** 命令面板 v2（docs/command-palette-v2.md 语义的 web 版）：Ctrl+Shift+P 全量 / Ctrl+P 预填 ">"。 */
export function CommandPalette({ onClose, prefill }: { onClose: () => void; prefill?: string }) {
  const { repo, settings } = useApp();
  const [query, setQuery] = useState(prefill ?? "");
  const [selected, setSelected] = useState(-1); // 相对 items 的索引
  const listRef = useRef<HTMLDivElement>(null);

  const repoOpen = !!repo;

  const commands: Command[] = useMemo(() => {
    const nav = (key: PageKey, title: string, hint: string): Command => ({
      id: `goto.${key}`, category: t("Cat_Nav"), title, keyHint: hint, enabled: true,
      run: () => navigate(key),
    });
    return [
      nav("projects", t("Cmd_GotoProjects"), "Ctrl+1"),
      nav("log", t("Cmd_GotoLog"), "Ctrl+2"),
      nav("changes", t("Cmd_GotoChanges"), "Ctrl+3"),
      nav("branches", t("Cmd_GotoBranches"), "Ctrl+4"),
      nav("tasks", t("Cmd_GotoTasks"), "Ctrl+5"),
      nav("bash", t("Cmd_GotoTerminal"), "Ctrl+6"),
      nav("settings", t("Cmd_GotoSettings"), "Ctrl+7"),
      { id: "repo.refresh", category: t("Cat_Repo"), title: t("Cmd_RefreshPage"), keyHint: "F5", enabled: true, run: () => window.dispatchEvent(new CustomEvent("gitter:refresh")) },
      { id: "repo.newWindow", category: t("Cat_Repo"), title: t("Cmd_NewWindow"), enabled: true, run: () => call("app.newWindow", { path: repo?.workDir }) },
      { id: "commit", category: t("Cat_Commit"), title: t("Cmd_Commit"), keyHint: "Ctrl+Enter", enabled: repoOpen, run: () => routeCommand("changes.commit") },
      { id: "commit.push", category: t("Cat_Commit"), title: t("Cmd_CommitPush"), enabled: repoOpen, run: () => routeCommand("changes.commitPush") },
      { id: "changes.stageAll", category: t("Cat_Commit"), title: t("Cmd_StageAll"), enabled: repoOpen, run: () => routeCommand("changes.stageAll") },
      { id: "changes.unstageAll", category: t("Cat_Commit"), title: t("Cmd_UnstageAll"), enabled: repoOpen, run: () => routeCommand("changes.unstageAll") },
      { id: "branches.create", category: t("Cat_Branch"), title: t("Cmd_CreateBranch"), keyHint: "Ctrl+Shift+N", enabled: repoOpen, run: () => routeCommand("branches.create") },
      { id: "branches.checkout", category: t("Cat_Branch"), title: t("Cmd_CheckoutBranch"), enabled: repoOpen, run: () => routeCommand("branches.checkout") },
      { id: "branches.pull", category: t("Cat_Sync"), title: t("Cmd_Pull"), enabled: repoOpen, run: () => routeCommand("branches.pull") },
      { id: "branches.pullRebase", category: t("Cat_Sync"), title: t("Cmd_PullRebase"), enabled: repoOpen, run: () => routeCommand("branches.pullRebase") },
      { id: "branches.push", category: t("Cat_Sync"), title: t("Cmd_Push"), enabled: repoOpen, run: () => routeCommand("branches.push") },
      { id: "view.diffSide", category: t("Cat_View"), title: t("Cmd_DiffSideBySide"), enabled: true, run: () => call("settings.set", { patch: { diffMode: "sideBySide" } }) },
      { id: "view.diffInline", category: t("Cat_View"), title: t("Cmd_DiffInline"), enabled: true, run: () => call("settings.set", { patch: { diffMode: "inline" } }) },
      { id: "view.themeSystem", category: t("Cat_View"), title: t("Cmd_ThemeSystem"), enabled: true, run: () => call("settings.set", { patch: { theme: "system" } }) },
      { id: "view.themeLight", category: t("Cat_View"), title: t("Cmd_ThemeLight"), enabled: true, run: () => call("settings.set", { patch: { theme: "light" } }) },
      { id: "view.themeDark", category: t("Cat_View"), title: t("Cmd_ThemeDark"), enabled: true, run: () => call("settings.set", { patch: { theme: "dark" } }) },
    ];
  }, [repo, repoOpen]);

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
