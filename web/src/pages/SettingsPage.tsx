import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import type { ExtTreeSnapshot } from "../pageSdk";
import { NavIcon, Select, Modal } from "../kit";
import { TlIcon } from "./taskIcons";
import type { ExtensionPackageDTO, ModelDiscoveryEntryDTO, ModelProfileDTO, SettingsDTO, TerminalProfileDTO, ThemePackageDTO } from "../bridge/types";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, t, updateSettings, applySettings, clearSettingsFocus, reloadTheme } = pageSdk;
const useApp = useAppState;

/**
 * 设置页 v2（两级导航 + 搜索，agent-harness.md v3.0 任务流配套）：
 * 一级 = 分类（左栏）；二级 = 分类内的节（右栏锚点）；搜索 = 条目级索引，点击跳转到节并高亮。
 * 节 id 同时承载 legacy openSettings("git") 跳转（settingsFocus）。
 */

interface RemoteDTO {
  name: string;
  url: string;
}

type CfgMap = Record<string, string>;

const GIT_KEYS = {
  userName: "user.name",
  userEmail: "user.email",
  autoSetupRemote: "push.autoSetupRemote",
  pullRebase: "pull.rebase",
  autocrlf: "core.autocrlf",
} as const;

// ---- 两级结构声明 ----

type CategoryId = "appearance" | "terminal" | "repo" | "models" | "ai" | "extensions" | "about";
type SectionId =
  | "appearance" | "diff" | "terminal"
  | "git" | "monitor" | "editor"
  | "models"
  | "ai" | "safety" | "agent" | "mcp"
  | "extensions" | "about";

// 图标 = 主侧栏同款设计语言：Segoe Fluent Icons 字形（repo 复用 branches 的 16×16 SVG path），
// 不再用 mono 文本符号（◑ ⑂ 等）——那些与 .nav-ico .glyph 的 WinUI 风格不符。
const CATEGORIES: { id: CategoryId; titleKey: string; glyph?: string; svg?: string }[] = [
  { id: "appearance", titleKey: "Settings_CatAppearance", glyph: "\uE790" },
  { id: "terminal", titleKey: "Settings_CatTerminal", glyph: "\uE756" },
  {
    id: "repo",
    titleKey: "Settings_CatRepo",
    svg: "M13.1 3.9a2.3 2.3 0 0 0-3.25 3.25l-.1.1a2.3 2.3 0 0 1-3.25 0L5.4 6.2a2.3 2.3 0 1 0-1.06 1.06l1.1 1.05a3.8 3.8 0 0 0 2.31 1.09v1.2a2.3 2.3 0 1 0 1.5 0V9.4a3.8 3.8 0 0 0 2.31-1.09l.1-.1a2.3 2.3 0 1 0 1.44-4.31z",
  },
  { id: "models", titleKey: "Settings_CatModels", glyph: "\uE8F1" },
  { id: "ai", titleKey: "Settings_CatAi", glyph: "\uE753" },
  { id: "extensions", titleKey: "Settings_CatExtensions", glyph: "\uE71D" },
  { id: "about", titleKey: "Settings_CatAbout", glyph: "\uE945" },
];

const SECTIONS: { id: SectionId; cat: CategoryId; titleKey: string }[] = [
  { id: "appearance", cat: "appearance", titleKey: "Settings_AppearanceSection" },
  { id: "diff", cat: "appearance", titleKey: "Settings_DiffSection" },
  { id: "terminal", cat: "terminal", titleKey: "Settings_TerminalSection" },
  { id: "git", cat: "repo", titleKey: "Settings_GitSection" },
  { id: "monitor", cat: "repo", titleKey: "Settings_MonitorSection" },
  { id: "editor", cat: "repo", titleKey: "Settings_EditorSection" },
  { id: "models", cat: "models", titleKey: "Settings_ModelsSection" },
  { id: "ai", cat: "ai", titleKey: "Settings_AiSection" },
  { id: "safety", cat: "ai", titleKey: "Settings_SafetyNetSection" },
  { id: "agent", cat: "ai", titleKey: "Settings_AgentSection" },
  { id: "mcp", cat: "ai", titleKey: "Settings_McpSection" },
  { id: "extensions", cat: "extensions", titleKey: "Settings_ExtensionsSection" },
  { id: "about", cat: "about", titleKey: "Settings_AboutSection" },
];

/** 搜索索引：每条设置项一行（label 用 i18n 键，中英双语都可命中；kw = 补充关键词）。 */
const SEARCH_INDEX: { section: SectionId; labelKey: string; kw?: string }[] = [
  { section: "appearance", labelKey: "Settings_Theme", kw: "dark light 深色 浅色 theme" },
  { section: "appearance", labelKey: "Settings_ThemePackage", kw: "主题包 theme package tokenColors" },
  { section: "appearance", labelKey: "Settings_Language", kw: "language 语言 i18n 中文 english" },
  { section: "diff", labelKey: "Settings_DiffMode", kw: "diff side inline 并排 内联 差异" },
  { section: "terminal", labelKey: "Settings_Shell", kw: "shell powershell cmd bash 终端" },
  { section: "terminal", labelKey: "Settings_TerminalFont", kw: "font 字体 字号" },
  { section: "terminal", labelKey: "Settings_TerminalFollowRepo", kw: "follow 跟随仓库 cwd" },
  { section: "terminal", labelKey: "Settings_BashPath", kw: "bash 路径 git bash" },
  { section: "git", labelKey: "Settings_GitScope", kw: "scope 仓库级 全局 层级" },
  { section: "git", labelKey: "Settings_GitUserName", kw: "user.name 用户名" },
  { section: "git", labelKey: "Settings_GitUserEmail", kw: "user.email 邮箱" },
  { section: "git", labelKey: "Settings_GitAutoSetupRemote", kw: "push.autoSetupRemote 上游" },
  { section: "git", labelKey: "Settings_GitPullRebase", kw: "pull.rebase 拉取 变基" },
  { section: "git", labelKey: "Settings_GitAutocrlf", kw: "autocrlf 换行" },
  { section: "git", labelKey: "Settings_GitRemotes", kw: "remote 远程 origin" },
  { section: "monitor", labelKey: "Settings_AutoFetch", kw: "fetch 自动拉取 后台 轮询" },
  { section: "editor", labelKey: "Settings_ExternalEditor", kw: "编辑器 vscode 外部" },
  { section: "ai", labelKey: "Settings_AiProvider", kw: "provider openai anthropic ollama deepseek 模型端点" },
  { section: "ai", labelKey: "Settings_AiEndpoint", kw: "endpoint model 端点 模型名" },
  { section: "ai", labelKey: "Settings_AiApiKey", kw: "api key 密钥 safeStorage" },
  { section: "ai", labelKey: "Settings_AiPrivacy", kw: "privacy 隐私 元数据 全量 diff" },
  { section: "ai", labelKey: "Settings_AiTrailer", kw: "trailer assisted-by 署名" },
  { section: "models", labelKey: "Settings_ModelsSection", kw: "模型档案 model profile deepseek ollama anthropic key 密钥 用量" },
  { section: "safety", labelKey: "Settings_SafetyNet", kw: "安全网 secrets 拦截 block warn 提交扫描" },
  { section: "agent", labelKey: "Settings_AgentCheckpoint", kw: "agent checkpoint 托管 wip 提交" },
  { section: "agent", labelKey: "Settings_AgentOnExit", kw: "agent 退出 终止 保留 会话" },
  { section: "agent", labelKey: "Settings_AgentRules", kw: "agent 权限规则 allow deny 允许 拒绝 rules 前缀" },
  { section: "agent", labelKey: "Settings_AgentCompaction", kw: "agent 上下文压缩 compact compaction 摘要" },
  { section: "mcp", labelKey: "Settings_McpEnabled", kw: "mcp server 管道 工具" },
  { section: "extensions", labelKey: "Extensions_Import", kw: "扩展 包 .gpk 导入 卸载 主题 语法 harness" },
  { section: "about", labelKey: "Settings_AboutSection", kw: "about 版本 version git" },
];

export function SettingsPage() {
  const app = useApp();
  const s = app.settings;
  const [themes, setThemes] = useState<ThemePackageDTO[]>([]);
  const [profiles, setProfiles] = useState<TerminalProfileDTO[]>([
    { id: "powershell", name: "PowerShell", source: "builtin" },
    { id: "cmd", name: "CMD", source: "builtin" },
    { id: "bash", name: "Git Bash", source: "builtin" },
  ]);
  const [gitVersion, setGitVersion] = useState<string>("…");
  const [configScope, setConfigScope] = useState<"repo" | "global">("repo");
  const [localCfg, setLocalCfg] = useState<CfgMap>({});
  const [globalCfg, setGlobalCfg] = useState<CfgMap>({});
  const [noRepo, setNoRepo] = useState(false);
  const [remotes, setRemotes] = useState<RemoteDTO[]>([]);
  const [newRemote, setNewRemote] = useState({ name: "", url: "" });
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [exts, setExts] = useState<ExtensionPackageDTO[]>([]);
  const [extError, setExtError] = useState<string | null>(null);
  const [catalogUrl, setCatalogUrl] = useState("");
  // 插件挂载树（页面 → 挂载插件 → 贡献明细）+ 视图切换（树状 / 类型分组）
  const [extView, setExtView] = useState<"tree" | "kind">("tree");
  const [treeOpen, setTreeOpen] = useState<Record<string, boolean>>({});
  const [extTreeData, setExtTreeData] = useState<ExtTreeSnapshot | null>(null);
  const [agentCmds, setAgentCmds] = useState<{ id: string; packageId?: string; args?: unknown }[]>([]);

  // 包类型分组（按 primaryKind 固定顺序分节显示；名称按类型前缀区分）
  const KIND_SECTIONS: { kind: string; label: string }[] = [
    { kind: "theme", label: "主题" },
    { kind: "grammar", label: "语法" },
    { kind: "skills", label: "技能" },
    { kind: "commands", label: "命令" },
    { kind: "pages", label: "页面" },
    { kind: "mcpServers", label: "MCP 服务器" },
    { kind: "models", label: "模型" },
    { kind: "taskTypes", label: "任务型" },
    { kind: "harness", label: "Agent 宿主" },
    { kind: "terminalProfiles", label: "终端档位" },
    { kind: "safetyRules", label: "安全网规则" },
    { kind: "emptyHints", label: "空状态提示" },
    { kind: "menus", label: "菜单" },
    { kind: "keybindings", label: "快捷键" },
    { kind: "configuration", label: "配置" },
  ];
  const primaryKindOf = (p: ExtensionPackageDTO): string =>
    p.kinds.find((k) => KIND_SECTIONS.some((x) => x.kind === k)) ?? p.kinds[0] ?? "__other";
  const kindLabel = (k: string): string => KIND_SECTIONS.find((x) => x.kind === k)?.label ?? k;

  /** 树节点行（页面/全局分组头）：▸▾ 折叠 + 计数徽标。 */
  const treeHeader = (id: string, glyph: string, title: string, sub: ReactNode, count: number | null) => {
    const open = treeOpen[id] ?? false;
    return (
      <div onClick={() => setTreeOpen((m) => ({ ...m, [id]: !open }))}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 8, cursor: "pointer", background: "var(--c-hover)", fontSize: 12.5 }}>
        <span className="mono" style={{ color: "var(--c-text3)", width: 12 }}>{open ? "▾" : "▸"}</span>
        <span>{glyph}</span>
        <b>{title}</b>
        {sub}
        {count !== null && count > 0 && <span className="hint">· 挂载 {count}</span>}
      </div>
    );
  };

  /** 插件挂载树：页面（槽位）→ 提供者 / 挂载插件 → 贡献明细；非页面级 → 全局分支。 */
  const extMountTree = () => {
    const pkgById = new Map(exts.map((p) => [p.id, p]));
    const consumed = new Set<string>();
    // 会话命令（agent.command → 任务页斜杠菜单）按包分组
    const cmdsByPkg = new Map<string, string[]>();
    for (const c of agentCmds) {
      const a = (c.args ?? {}) as { slash?: string };
      const pid = c.packageId ?? "";
      if (!pid) continue;
      if (!cmdsByPkg.has(pid)) cmdsByPkg.set(pid, []);
      cmdsByPkg.get(pid)!.push(`${pid.split(".").pop() ?? "pkg"}:${a.slash ?? c.id}`);
    }
    // agent UI 注册表（时间线渲染器/输入台 provider）的消费页 = agent 时间线所在页（当前为任务页）
    const AGENT_TIMELINE_SLOT = "tasks";
    const tierLabel = (x: string) => (x === "user" ? "用户包" : x === "builtin" ? "内置包" : "宿主");
    const agentUI = extTreeData?.agentUI ?? [];
    const pageNodes = (extTreeData?.pages ?? []).map((pg) => {
      const provider = pg.packageId ? pkgById.get(pg.packageId) ?? null : null;
      if (provider) consumed.add(provider.id);
      const mountees: { pkg: ExtensionPackageDTO; note: string }[] = [];
      for (const sh of pg.shadowed) {
        const p2 = pkgById.get(sh.packageId);
        if (p2) { consumed.add(p2.id); mountees.push({ pkg: p2, note: "页面提供者（替补 · 同槽位竞争落败）" }); }
      }
      if (pg.slot === AGENT_TIMELINE_SLOT) {
        for (const r of agentUI) {
          if (r.packageId === pg.packageId) continue;
          const p2 = pkgById.get(r.packageId);
          if (!p2) continue;
          consumed.add(p2.id);
          mountees.push({ pkg: p2, note: `挂载：时间线渲染器 ×${r.renderers} · 输入台 provider ×${r.providers}（${tierLabel(r.tier)}层）` });
        }
        for (const [pid, names] of cmdsByPkg) {
          if (pid === pg.packageId) continue;
          const p2 = pkgById.get(pid);
          if (!p2) continue;
          consumed.add(pid);
          mountees.push({ pkg: p2, note: `挂载：会话命令 ×${names.length}（${names.map((n) => `/${n}`).join(" ")}）` });
        }
      }
      // 文档贡献（终端页文档面板消费）：归属贡献包的页面节点展示
      const myDocs = (extTreeData?.docs ?? []).filter((d) => d.packageId === pg.packageId);
      if (myDocs.length > 0 && provider) {
        const tier = myDocs[0]?.tier ?? "host";
        mountees.push({ pkg: provider, note: `贡献：文档 ×${myDocs.length}（${myDocs.map((d) => d.title).join("、")} · ${tierLabel(tier)}层）` });
      }
      const providerReg = agentUI.find((r) => r.packageId === pg.packageId) ?? null;
      return { pg, provider, providerReg, mountees };
    });
    const knownKinds = new Set(KIND_SECTIONS.map((x) => x.kind));
    const globalGroups = KIND_SECTIONS
      .map(({ kind, label }) => ({
        key: kind, label,
        pkgs: exts.filter((p) => !consumed.has(p.id) && primaryKindOf(p) === kind).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.pkgs.length > 0);
    const otherGlobal = exts.filter((p) => !consumed.has(p.id) && !knownKinds.has(primaryKindOf(p)));
    const globalCount = globalGroups.reduce((n, g) => n + g.pkgs.length, 0) + otherGlobal.length;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {pageNodes.map(({ pg, provider, providerReg, mountees }) => {
          const title = pg.titleKey ? t(pg.titleKey) : pg.title ?? pg.slot;
          return (
            <div key={pg.slot}>
              {treeHeader(`page:${pg.slot}`, "📄", title, (
                <>
                  <span className="hint mono">{pg.slot}</span>
                  {!provider && <span className="hint">（提供者未装载）</span>}
                </>
              ), mountees.length)}
              {(treeOpen[`page:${pg.slot}`] ?? mountees.length > 0) && (
                <div style={{ marginLeft: 16, borderLeft: "2px solid var(--c-border)", paddingLeft: 12, paddingTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                  {provider && renderExtCard(provider, (
                    <span className="hint">
                      页面提供者{pg.isBuiltIn ? " · 内置" : " · 用户包"}
                      {providerReg ? ` · 本页自举：渲染器 ×${providerReg.renderers} · 输入台 provider ×${providerReg.providers}` : ""}
                    </span>
                  ))}
                  {mountees.map(({ pkg, note }, idx) => (
                    <div key={`${pkg.id}:${idx}`}>{renderExtCard(pkg, <span className="hint">{note}</span>)}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {globalCount > 0 && (
          <div>
            {treeHeader("__global", "🌐", "全局（非页面级）", null, -1)}
            {(treeOpen["__global"] ?? false) && (
              <div style={{ marginLeft: 16, borderLeft: "2px solid var(--c-border)", paddingLeft: 12, paddingTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                {globalGroups.map((g) => (
                  <div key={g.key}>
                    <div style={{ fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }}>{g.label} <span className="hint">（{g.pkgs.length}）</span></div>
                    {g.pkgs.map((p) => renderExtCard(p))}
                  </div>
                ))}
                {otherGlobal.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }}>其他 <span className="hint">（{otherGlobal.length}）</span></div>
                    {otherGlobal.map((p) => renderExtCard(p))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderExtCard = (p: ExtensionPackageDTO, extra?: ReactNode) => {
    const cfgValues = ((s?.packages?.[p.id]?.config ?? {}) ?? {}) as Record<string, unknown>;
    return (
      <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="checkbox"
            checked={p.state === "active"}
            disabled={p.state === "error"}
            title={p.state === "disabled" && p.reason ? p.reason : undefined}
            onChange={(e) => void setPkgEnabled(p, e.target.checked)}
          />
          <span><span style={{ color: "var(--c-text2)" }}>[{kindLabel(primaryKindOf(p))}]</span> {p.name} <span className="hint">v{p.version}</span></span>
          {p.isBuiltIn && <span className="hint">{t("Extensions_BuiltIn")}</span>}
          {p.kinds.map((k) => (
            <button
              key={k}
              className="tool-btn"
              title={p.kindStates[k] ? "点击禁用该类内容" : "点击启用该类内容"}
              style={{ opacity: p.kindStates[k] === false ? 0.45 : 1, padding: "0 6px" }}
              onClick={async () => {
                setExtError(null);
                try {
                  await refreshExts(await call<ExtensionPackageDTO[]>("extensions.setKindEnabled", {
                    id: p.id, kind: k, enabled: p.kindStates[k] === false,
                  }));
                } catch (e) {
                  setExtError((e as Error).message);
                }
              }}
            >
              {k}{p.kindStates[k] === false ? "（已禁用）" : ""}
            </button>
          ))}
          {p.permissions.length > 0 && <span className="hint" title="权限域声明">权限: {p.permissions.join(" / ")}</span>}
          {p.state !== "active" && (
            <span className="hint" style={{ color: "var(--c-red)" }}>
              {p.state === "error" ? `${t("Extensions_Error")}: ${p.reason ?? ""}` : t("Extensions_Disabled") + (p.reason ? ` — ${p.reason}` : "")}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {!p.isBuiltIn && p.state !== "error" && (
            <button className="tool-btn" onClick={() => void uninstallPkg(p)}>{t("Extensions_Uninstall")}</button>
          )}
        </div>
        {extra && <div style={{ paddingLeft: 24, marginTop: -2 }}>{extra}</div>}
        {p.state === "active" && p.kindStates.configuration && p.configuration.map((item) => (
          <div key={item.key} style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 24 }}>
            <span className="hint" style={{ width: 140 }}>{item.title ?? item.key}</span>
            {item.type === "boolean" ? (
              <input
                type="checkbox"
                checked={typeof cfgValues[item.key] === "boolean" ? (cfgValues[item.key] as boolean) : !!item.default}
                onChange={(e) => void call("extensions.setConfig", { id: p.id, key: item.key, value: e.target.checked })}
              />
            ) : (
              <input
                className="input"
                style={{ width: 200 }}
                type={item.type === "number" ? "number" : "text"}
                value={cfgValues[item.key] !== undefined ? String(cfgValues[item.key]) : String(item.default)}
                onChange={(e) => {
                  const v = item.type === "number" ? Number(e.target.value) : e.target.value;
                  void call("extensions.setConfig", { id: p.id, key: item.key, value: v });
                }}
              />
            )}
          </div>
        ))}
      </div>
    );
  };
  const [modelProfiles, setModelProfiles] = useState<ModelProfileDTO[]>([]);
  /** 添加/编辑模型弹窗（DeepSeek-harness 式）：一条连接可勾选多个模型一次性保存为分组 */
  const [modelAddOpen, setModelAddOpen] = useState(false);
  /** 编辑目标（分组主条目）；null = 新建 */
  const [modelEdit, setModelEdit] = useState<ModelProfileDTO | null>(null);
  /** 多模型分组"设为默认"的成员选择面板（展开的分组 id） */
  const [defaultPickFor, setDefaultPickFor] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    try {
      setModelProfiles(await call<ModelProfileDTO[]>("models.list"));
    } catch {
      /* 桥不可用（vite 调试）静默 */
    }
  }, []);

  // 两级导航 + 搜索状态
  const [cat, setCat] = useState<CategoryId>("appearance");
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<SectionId | null>(null);
  const flashTimer = useRef<number | null>(null);

  /** 扩展管理树快照（页面槽位/agent UI 注册都在渲染层注册表——随包热插拔刷新）。 */
  const pullExtTree = useCallback(() => {
    try { setExtTreeData(pageSdk.extTree()); } catch { /* GITTER_UI 未注入（vite 调试）静默 */ }
  }, []);

  // 包集合变化（导入/卸载/启停）→ 挂载树重取（页面包提供者与 agent UI 注册都可能变）
  useEffect(() => pageSdk.on("extensions.changed", () => pullExtTree()), [pullExtTree]);

  useEffect(() => {
    void call<ThemePackageDTO[]>("themes.list").then(setThemes);
    void call<TerminalProfileDTO[]>("terminal.profiles").then(setProfiles);
    void call<string | null>("app.gitVersion").then((v) => setGitVersion(v ?? t("Settings_GitNotFound")));
    void call<ExtensionPackageDTO[]>("extensions.list").then(setExts);
    void call<{ id: string; action?: string; packageId?: string; args?: unknown }[]>("commands.list")
      .then((cmds) => setAgentCmds(cmds.filter((c) => c.action === "agent.command")))
      .catch(() => {});
    pullExtTree();
    void loadModels();
  }, [loadModels, pullExtTree]);

  /** 扩展操作后的统一刷新：主题 kind 变化需重应用主题（禁用活动主题 → 回退内置）。 */
  const refreshExts = async (list: ExtensionPackageDTO[]) => {
    setExts(list);
    pullExtTree();
    if (list.some((p) => p.kinds.includes("theme"))) {
      const fresh = await call<SettingsDTO>("settings.get");
      applySettings(fresh);
      await reloadTheme();
    }
  };

  const importGpk = async () => {
    setExtError(null);
    try {
      const r = await call<ExtensionPackageDTO[] | null>("extensions.importGpk");
      if (r) await refreshExts(r);
    } catch (e) {
      setExtError((e as Error).message);
    }
  };

  const setPkgEnabled = async (p: ExtensionPackageDTO, enabled: boolean) => {
    setExtError(null);
    try {
      await refreshExts(await call<ExtensionPackageDTO[]>("extensions.setEnabled", { id: p.id, enabled }));
    } catch (e) {
      setExtError((e as Error).message);
    }
  };

  const uninstallPkg = async (p: ExtensionPackageDTO) => {
    setExtError(null);
    try {
      await refreshExts(await call<ExtensionPackageDTO[]>("extensions.uninstall", { id: p.id }));
    } catch (e) {
      setExtError((e as Error).message);
    }
  };

  // Git 配置：双层级读取（有效值 = 仓库覆盖全局）；未开仓库时仓库层级不可用
  useEffect(() => {
    (async () => {
      const [l, g] = await Promise.all([
        call<CfgMap>("gitconfig.list", { scope: "repo" }).catch(() => null),
        call<CfgMap>("gitconfig.list", { scope: "global" }).catch(() => ({})),
      ]);
      setNoRepo(l === null);
      setLocalCfg(l ?? {});
      setGlobalCfg(g);
      setRemotes(l !== null ? await call<RemoteDTO[]>("remote.list").catch(() => []) : []);
    })();
  }, [app.repo?.workDir]);

  const gotoSection = (id: SectionId) => {
    const sec = SECTIONS.find((x) => x.id === id);
    if (!sec) return;
    setCat(sec.cat);
    setQuery("");
    window.setTimeout(() => {
      document.getElementById(`set-sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setFlash(id);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
    }, 60);
  };

  // legacy 跳转（openSettings("git")）与通用节定位
  useEffect(() => {
    if (app.settingsFocus) {
      gotoSection(app.settingsFocus as SectionId);
      clearSettingsFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.settingsFocus]);

  if (!s) return null;

  const patch = async (p: Partial<SettingsDTO>) => {
    await updateSettings(p);
  };

  // ---- 搜索（条目级：中英文 label + 关键词；结果点击跳转到节）----
  const q = query.trim().toLowerCase();
  const matches = q
    ? SEARCH_INDEX.filter((it) => {
        const label = t(it.labelKey).toLowerCase();
        return label.includes(q) || it.labelKey.toLowerCase().includes(q) || (it.kw ?? "").toLowerCase().includes(q);
      })
    : [];

  // ---- Git 配置区辅助 ----
  const cfgGet = (map: CfgMap, key: string): string | undefined => map[key.toLowerCase()];
  const cfgInherited = (key: string): string | null =>
    cfgGet(localCfg, key) === undefined ? globalCfg[key.toLowerCase()] ?? null : null;

  const reloadGitConfig = async () => {
    const [l, g, r] = await Promise.all([
      call<CfgMap>("gitconfig.list", { scope: "repo" }).catch(() => null),
      call<CfgMap>("gitconfig.list", { scope: "global" }).catch(() => ({})),
      call<RemoteDTO[]>("remote.list").catch(() => []),
    ]);
    setNoRepo(l === null);
    setLocalCfg(l ?? {});
    setGlobalCfg(g);
    setRemotes(r);
  };

  const saveConfig = async (key: string, value: string | null) => {
    setCfgError(null);
    try {
      await call("gitconfig.set", { key, value, scope: configScope });
      await reloadGitConfig();
    } catch (e) {
      setCfgError((e as Error).message);
      await reloadGitConfig();
    }
  };

  const cfgTextLabel = (key: string) => {
    const inherited = cfgInherited(key);
    return (
      <>
        <input
          className="input"
          style={{ width: 260 }}
          value={configScope === "repo" ? cfgGet(localCfg, key) ?? "" : cfgGet(globalCfg, key) ?? ""}
          placeholder={inherited ?? ""}
          title={inherited !== null ? t("Settings_GitInheritGlobal", inherited) : undefined}
          onChange={(e) => void saveConfig(key, e.target.value === "" ? null : e.target.value)}
          disabled={configScope === "repo" && noRepo}
        />
        {inherited !== null && <span className="hint">{t("Settings_GitInheritGlobal", inherited)}</span>}
      </>
    );
  };

  const cfgSelect = (key: string, options: string[]) => {
    const value = configScope === "repo" ? cfgGet(localCfg, key) ?? "" : cfgGet(globalCfg, key) ?? "";
    const inherited = cfgInherited(key);
    return (
      <>
        <Select
          value={value}
          disabled={configScope === "repo" && noRepo}
          onChange={(v) => void saveConfig(key, v === "" ? null : v)}
          options={[{ value: "", label: t("Settings_Unset") }, ...options.map((o) => ({ value: o, label: o }))]}
        />
        {inherited !== null && <span className="hint">{t("Settings_GitInheritGlobal", inherited)}</span>}
      </>
    );
  };

  const Radio = <K extends string>(props: { value: K; options: { value: K; label: string }[]; onChange: (v: K) => void }) => (
    <div className="radio-group">
      {props.options.map((o) => (
        <button key={o.value} className={"tool-btn" + (props.value === o.value ? " chosen" : "")} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  const secCls = (id: SectionId) => (flash === id ? "settings-section flash" : "settings-section");

  // ---- 二级节渲染（原各节 JSX，原样分组）----

  const renderSection = (id: SectionId) => {
    switch (id) {
      case "appearance":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_AppearanceSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_Theme")}</label>
              <Radio
                value={s.theme}
                options={[
                  { value: "system", label: t("Settings_ThemeSystem") },
                  { value: "light", label: t("Settings_ThemeLight") },
                  { value: "dark", label: t("Settings_ThemeDark") },
                ]}
                onChange={(v) => void patch({ theme: v })}
              />
            </div>
            <div className="settings-row">
              <label>{t("Settings_ThemePackage")}</label>
              <Select value={s.themePackageId ?? ""} onChange={(v) => void patch({ themePackageId: v || null })}
                options={[
                  { value: "", label: t("Settings_ThemeDefault") },
                  ...themes.map((tp) => {
                    const covers = (tp.bases?.length ?? 1) > 1;
                    return { value: tp.id, label: covers ? tp.name : `${tp.name}（${tp.base === "dark" ? t("Settings_Dark") : t("Settings_Light")}）` };
                  }),
                ]}
              />
            </div>
            <div className="settings-row">
              <label>{t("Settings_Language")}</label>
              <Radio
                value={s.language}
                options={[
                  { value: "system", label: t("Settings_LangSystem") },
                  { value: "en", label: "English" },
                  { value: "zh-Hans", label: "简体中文" },
                ]}
                onChange={(v) => void patch({ language: v })}
              />
            </div>
          </div>
        );
      case "diff":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_DiffSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_DiffMode")}</label>
              <Radio
                value={s.diffMode}
                options={[
                  { value: "sideBySide", label: t("Settings_DiffSide") },
                  { value: "inline", label: t("Settings_DiffInline") },
                ]}
                onChange={(v) => void patch({ diffMode: v })}
              />
            </div>
          </div>
        );
      case "terminal":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_TerminalSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_Shell")}</label>
              <Radio
                value={s.terminalShell}
                options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(v) => void patch({ terminalShell: v })}
              />
            </div>
            <div className="settings-row">
              <label>{t("Settings_TerminalFont")}</label>
              <input className="input" value={s.terminalFontFamily} onChange={(e) => void patch({ terminalFontFamily: e.target.value })} />
              <input
                className="input"
                type="number"
                min={8}
                max={28}
                style={{ width: 70 }}
                value={s.terminalFontSize}
                onChange={(e) => void patch({ terminalFontSize: Number(e.target.value) || 13 })}
              />
            </div>
            <div className="settings-row">
              <label>{t("Settings_TerminalFollowRepo")}</label>
              <input type="checkbox" checked={s.terminalFollowRepo} onChange={(e) => void patch({ terminalFollowRepo: e.target.checked })} />
            </div>
            <div className="settings-row">
              <label>{t("Settings_BashPath")}</label>
              <input className="input" style={{ width: 320 }} placeholder={t("Settings_BashPathHint")} value={s.bashPath ?? ""} onChange={(e) => void patch({ bashPath: e.target.value || null })} />
            </div>
          </div>
        );
      case "git":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_GitSection")}</h4>
            {cfgError && (
              <div className="banner error" style={{ marginBottom: 8 }}>
                <span className="banner-text">{cfgError}</span>
                <button className="tool-btn" onClick={() => setCfgError(null)}>✕</button>
              </div>
            )}
            <div className="settings-row">
              <label>{t("Settings_GitScope")}</label>
              <Radio
                value={configScope}
                options={[
                  { value: "repo", label: t("Settings_GitRepoLevel") },
                  { value: "global", label: t("Settings_GitGlobalLevel") },
                ]}
                onChange={(v) => setConfigScope(v)}
              />
              {configScope === "repo" && noRepo && <span className="hint">{t("Settings_NoRepoHint")}</span>}
            </div>
            <div className="settings-row">
              <label>{t("Settings_GitUserName")}</label>
              {cfgTextLabel(GIT_KEYS.userName)}
            </div>
            <div className="settings-row">
              <label>{t("Settings_GitUserEmail")}</label>
              {cfgTextLabel(GIT_KEYS.userEmail)}
            </div>
            <div className="settings-row">
              <label>{t("Settings_GitAutoSetupRemote")}</label>
              {cfgSelect(GIT_KEYS.autoSetupRemote, ["true", "false"])}
              <span className="hint">{t("Settings_GitAutoSetupRemoteHint")}</span>
            </div>
            <div className="settings-row">
              <label>{t("Settings_GitPullRebase")}</label>
              {cfgSelect(GIT_KEYS.pullRebase, ["true", "false"])}
            </div>
            <div className="settings-row">
              <label>{t("Settings_GitAutocrlf")}</label>
              {cfgSelect(GIT_KEYS.autocrlf, ["input", "true", "false"])}
            </div>
            <div className="settings-row" style={{ alignItems: "flex-start" }}>
              <label style={{ paddingTop: 4 }}>{t("Settings_GitRemotes")}</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                {remotes.map((r) => (
                  <div key={r.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, width: 80, flex: "none" }}>{r.name}</span>
                    <span className="hint" style={{ fontFamily: "var(--mono)", userSelect: "text", flex: 1, wordBreak: "break-all" }}>{r.url}</span>
                    <button
                      className="tool-btn"
                      onClick={async () => {
                        setCfgError(null);
                        try { await call("remote.remove", { name: r.name }); await reloadGitConfig(); }
                        catch (e) { setCfgError((e as Error).message); }
                      }}
                    >
                      {t("Projects_Remove")}
                    </button>
                  </div>
                ))}
                {remotes.length === 0 && <span className="hint">{t("Settings_GitNoRemotes")}</span>}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input className="input" style={{ width: 110 }} placeholder={t("Settings_GitRemoteName")} value={newRemote.name} onChange={(e) => setNewRemote((n) => ({ ...n, name: e.target.value }))} />
                  <input className="input" style={{ flex: 1 }} placeholder={t("Settings_GitRemoteUrl")} value={newRemote.url} onChange={(e) => setNewRemote((n) => ({ ...n, url: e.target.value }))} />
                  <button
                    className="tool-btn"
                    disabled={!newRemote.name.trim() || !newRemote.url.trim() || noRepo}
                    onClick={async () => {
                      setCfgError(null);
                      try {
                        await call("remote.add", { name: newRemote.name.trim(), url: newRemote.url.trim() });
                        setNewRemote({ name: "", url: "" });
                        await reloadGitConfig();
                      } catch (e) {
                        setCfgError((e as Error).message);
                      }
                    }}
                  >
                    {t("Settings_GitAddRemote")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      case "monitor":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_MonitorSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_AutoFetch")}</label>
              <input type="checkbox" checked={s.autoFetch} onChange={(e) => void patch({ autoFetch: e.target.checked })} />
              <span className="hint">{t("Settings_AutoFetchHint")}</span>
            </div>
          </div>
        );
      case "editor":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_EditorSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_ExternalEditor")}</label>
              <input className="input" style={{ width: 320 }} placeholder="code --wait" value={s.externalEditor ?? ""} onChange={(e) => void patch({ externalEditor: e.target.value || null })} />
              <button
                className="tool-btn"
                onClick={async () => {
                  const p = await call<string | null>("dialog.pickFile", { title: t("Settings_PickEditor"), filters: [{ name: "exe", ext: ["exe"] }] });
                  if (p) await patch({ externalEditor: `"${p}"` });
                }}
              >
                …
              </button>
            </div>
          </div>
        );
      case "ai":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_AiSection")}</h4>
            {(s.models?.length ?? 0) > 0 && (
              <div className="settings-row">
                <span className="hint">{t("Settings_AiMigrated")}</span>
              </div>
            )}
            {(s.models?.length ?? 0) === 0 && (
              <>
            <div className="settings-row">
              <label>{t("Settings_AiProvider")}</label>
              <Radio
                value={s.aiProvider}
                options={[
                  { value: "off", label: t("Settings_AiOff") },
                  { value: "openai", label: "OpenAI 兼容" },
                  { value: "anthropic", label: "Anthropic" },
                  { value: "cli", label: "CLI 桥" },
                ]}
                onChange={(v) => void patch({ aiProvider: v })}
              />
              <span className="hint">{t("Settings_AiProviderHint")}</span>
            </div>
            {s.aiProvider === "openai" && (
              <div className="settings-row">
                <label>Endpoint / Model</label>
                <input className="input" style={{ width: 220 }} placeholder="https://api.xx.com/v1" value={s.aiEndpoint ?? ""} onChange={(e) => void patch({ aiEndpoint: e.target.value || null })} />
                <input className="input" style={{ width: 160 }} placeholder="model" value={s.aiModel ?? ""} onChange={(e) => void patch({ aiModel: e.target.value || null })} />
              </div>
            )}
            {s.aiProvider === "anthropic" && (
              <div className="settings-row">
                <label>Endpoint / Model</label>
                <input className="input" style={{ width: 220 }} placeholder="https://api.anthropic.com" value={s.aiEndpoint ?? ""} onChange={(e) => void patch({ aiEndpoint: e.target.value || null })} />
                <input className="input" style={{ width: 160 }} placeholder="claude-…" value={s.aiModel ?? ""} onChange={(e) => void patch({ aiModel: e.target.value || null })} />
              </div>
            )}
            {s.aiProvider === "cli" && (
              <div className="settings-row">
                <label>{t("Settings_AiCliCommand")}</label>
                <input className="input" style={{ width: 320 }} placeholder={`claude -p / codex exec`} value={s.aiCliCommand ?? ""} onChange={(e) => void patch({ aiCliCommand: e.target.value || null })} />
              </div>
            )}
            {(s.aiProvider === "openai" || s.aiProvider === "anthropic") && (
              <div className="settings-row">
                <label>{t("Settings_AiApiKey")}</label>
                <input className="input" type="password" style={{ width: 260 }} placeholder={s.aiApiKeyProtected ? "••••••（已保存）" : "sk-…"} onChange={(e) => {
                  const key = e.target.value;
                  if (key.length >= 8) void call("settings.setAiKey", { key });
                }} />
                <span className="hint">{t("Settings_AiKeyHint")}</span>
              </div>
            )}
              </>
            )}
            <div className="settings-row">
              <label>{t("Settings_AiPrivacy")}</label>
              <Radio
                value={s.aiPrivacy}
                options={[
                  { value: "metadataOnly", label: t("Settings_AiMetadata") },
                  { value: "fullDiff", label: t("Settings_AiFullDiff") },
                  { value: "disabled", label: t("Settings_AiDisabled") },
                ]}
                onChange={(v) => void patch({ aiPrivacy: v })}
              />
            </div>
            <div className="settings-row">
              <label>{t("Settings_AiTrailer")}</label>
              <input type="checkbox" checked={s.aiAppendTrailer} onChange={(e) => void patch({ aiAppendTrailer: e.target.checked })} />
              <span className="hint">Assisted-by: Gitter</span>
            </div>
          </div>
        );
      case "models":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <div className="section-head">
              <h4>{t("Settings_ModelsSection")}</h4>
              <button
                className="tool-btn icon"
                data-tip={t("Settings_ModelsAddBtn")}
                aria-label={t("Settings_ModelsAddBtn")}
                onClick={() => { setModelEdit(null); setModelAddOpen(true); }}
              >
                <TlIcon name="plus" size={14} />
              </button>
            </div>
            <div className="settings-row" style={{ alignItems: "flex-start" }}>
              <label style={{ paddingTop: 4 }}>{t("Settings_ModelsProfiles")}</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {modelProfiles.length === 0 && <span className="hint">{t("Settings_ModelsEmpty")}</span>}
                {modelProfiles.map((m) => m.source === "package" ? (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <b style={{ fontSize: 12.5 }}>{m.name}</b>
                      <span className="hint mono">{m.modelId}</span>
                      <span className="hint">{m.kind === "anthropic" ? "Anthropic" : "OpenAI 兼容"}</span>
                      <span className="chip">{t("Settings_ModelsSourcePackage")}</span>
                      {!m.configured && <span className="chip" style={{ color: "var(--c-amber)", background: "transparent", border: "1px solid var(--c-amber)" }}>{t("Settings_ModelsNeedKey")}</span>}
                      {m.isDefault && <span className="chip">{t("Settings_ModelsDefault")}</span>}
                      {m.isFast && <span className="chip">{t("Settings_ModelsFast")}</span>}
                      <span className="grow" />
                      {m.usage.turns > 0 && (
                        <span className="hint mono">{m.usage.turns} 轮 · in {m.usage.inputTokens} / out {m.usage.outputTokens}</span>
                      )}
                    </div>
                    <div className="card-path">{m.baseURL}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input className="input" type="password" style={{ width: 200 }} placeholder={m.hasKey ? "••••••（已保存）" : (m.keyHint ?? t("Settings_ModelsKeyPlaceholder"))}
                        onChange={(e) => {
                          const k = e.target.value;
                          if (k.length >= 8) void call("models.setKey", { id: m.id, key: k }).then(loadModels);
                        }} />
                      {!m.isDefault && <button className="tool-btn" onClick={() => void call("models.setDefault", { id: m.id }).then(loadModels)}>{t("Settings_ModelsSetDefault")}</button>}
                      {m.isDefault && <span className="chip">{t("Settings_ModelsDefault")}</span>}
                      {!m.isFast && <button className="tool-btn" onClick={() => void call("models.setFast", { id: m.id }).then(loadModels)}>{t("Settings_ModelsSetFast")}</button>}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <b style={{ fontSize: 12.5 }}>{m.name}</b>
                      <span className="hint">{m.kind === "anthropic" ? "Anthropic" : "OpenAI 兼容"}</span>
                      <span className="chip">{t("Settings_ModelsSourceUser")}</span>
                      {!m.configured && <span className="chip" style={{ color: "var(--c-amber)", background: "transparent", border: "1px solid var(--c-amber)" }}>{t("Settings_ModelsNeedKey")}</span>}
                      {m.isDefault && <span className="chip" title={defaultMemberName(m, s?.defaultModelId ?? null) ?? undefined}>{t("Settings_ModelsDefault")}{(m.groupModels?.length ?? 1) > 1 ? `：${defaultMemberName(m, s?.defaultModelId ?? null)}` : ""}</span>}
                      {m.isFast && <span className="chip">{t("Settings_ModelsFast")}</span>}
                      <span className="chip">{t("Settings_ModelsCount", m.groupModels?.length ?? 1)}</span>
                      <span className="grow" />
                      {m.usage.turns > 0 && (
                        <span className="hint mono">{m.usage.turns} 轮 · in {m.usage.inputTokens} / out {m.usage.outputTokens}</span>
                      )}
                    </div>
                    <div className="card-path">{m.baseURL}</div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                      {(m.groupModels ?? [{ modelId: m.modelId, vision: false, thinking: m.thinking ?? "medium" }]).map((g) => (
                        <span key={g.modelId} className="chip mono" title={[g.vision ? t("Settings_ModelsVision") : null, g.contextTokens ? `${g.contextTokens} tokens` : null].filter(Boolean).join(" · ") || undefined}>
                          {g.modelId}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input className="input" type="password" style={{ width: 200 }} placeholder={m.hasKey ? "••••••（已保存）" : t("Settings_ModelsKeyPlaceholder")}
                        onChange={(e) => {
                          const k = e.target.value;
                          if (k.length >= 8) void call("models.setKey", { id: m.id, key: k }).then(loadModels);
                        }} />
                      {/* 多模型分组：设为默认需指明具体模型（首成员用分组 id，其余 `分组id#模型id`） */}
                      {(m.groupModels?.length ?? 1) > 1 ? (
                        <>
                          <button className="tool-btn" onClick={() => setDefaultPickFor(defaultPickFor === m.id ? null : m.id)}>{t("Settings_ModelsSetDefault")}…</button>
                          {defaultPickFor === m.id && (
                            <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                              {(m.groupModels ?? []).map((g, i) => {
                                const ref = i === 0 ? m.id : `${m.groupId}#${g.modelId}`;
                                const isCur = s?.defaultModelId === ref;
                                return (
                                  <button key={g.modelId} className={"tool-btn" + (isCur ? " primary" : "")} title={g.modelId}
                                    onClick={() => void call("models.setDefault", { id: ref }).then(() => {
                                      setDefaultPickFor(null);
                                      return Promise.all([loadModels(), call<SettingsDTO>("settings.get").then(applySettings)]);
                                    })}>
                                    {g.modelId}{isCur ? " ✓" : ""}
                                  </button>
                                );
                              })}
                            </span>
                          )}
                        </>
                      ) : (
                        !m.isDefault && <button className="tool-btn" onClick={() => void call("models.setDefault", { id: m.id }).then(loadModels)}>{t("Settings_ModelsSetDefault")}</button>
                      )}
                      {!m.isFast && <button className="tool-btn" onClick={() => void call("models.setFast", { id: m.id }).then(loadModels)}>{t("Settings_ModelsSetFast")}</button>}
                      <span className="grow" />
                      <button className="tool-btn icon" data-tip={t("Settings_ModelsEditBtn")} aria-label={t("Settings_ModelsEditBtn")}
                        onClick={() => { setModelEdit(m); setModelAddOpen(true); }}>
                        <TlIcon name="pencil" size={13} />
                      </button>
                      <button className="tool-btn icon danger" data-tip={t("Settings_ModelsDelete")} aria-label={t("Settings_ModelsDelete")}
                        onClick={() => void call("models.delete", { id: m.id }).then(loadModels)}>
                        <TlIcon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                <span className="hint">{t("Settings_ModelsHint")}</span>
              </div>
            </div>
            {modelAddOpen && (
              <AddModelDialog
                edit={modelEdit ?? undefined}
                onClose={() => setModelAddOpen(false)}
                onSaved={() => { setModelAddOpen(false); void loadModels(); }}
              />
            )}
          </div>
        );
      case "safety":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_SafetyNetSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_SafetyNet")}</label>
              <Radio
                value={s.safetyNet}
                options={[
                  { value: "off", label: t("Settings_SafetyOff") },
                  { value: "warn", label: t("Settings_SafetyWarn") },
                  { value: "block", label: t("Settings_SafetyBlock") },
                ]}
                onChange={(v) => void patch({ safetyNet: v })}
              />
              <span className="hint">{t("Settings_SafetyNetHint")}</span>
            </div>
          </div>
        );
      case "agent":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_AgentSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_AgentCheckpoint")}</label>
              <input type="checkbox" checked={s.agentsCheckpoint} onChange={(e) => void patch({ agentsCheckpoint: e.target.checked })} />
              <span className="hint">{t("Settings_AgentCheckpointHint")}</span>
            </div>
            <div className="settings-row">
              <label>{t("Settings_AgentOnExit")}</label>
              <Radio
                value={s.agentsOnExit}
                options={[
                  { value: "terminate", label: t("Settings_AgentOnExitTerminate") },
                  { value: "keep", label: t("Settings_AgentOnExitKeep") },
                ]}
                onChange={(v) => void patch({ agentsOnExit: v })}
              />
            </div>
            <div className="settings-row">
              <label>上下文压缩</label>
              <Radio
                value={s.agentsCompaction ?? "auto"}
                options={[
                  { value: "auto", label: "自动（80% 阈值）" },
                  { value: "manual", label: "仅 /compact" },
                  { value: "off", label: "关闭" },
                ]}
                onChange={(v) => void patch({ agentsCompaction: v as "auto" | "manual" | "off" })}
              />
            </div>
            <div className="settings-row">
              <label>压缩调参</label>
              <span className="hint">
                阈值
                <input className="input" style={{ width: 70, marginLeft: 4 }} type="number" min={50} max={95}
                  value={Math.round((s.agentsCompactionPolicy?.threshold ?? 0.8) * 100)}
                  onChange={(e) => {
                    const v = Math.min(95, Math.max(50, Number(e.target.value) || 80)) / 100;
                    void patch({ agentsCompactionPolicy: { ...(s.agentsCompactionPolicy ?? {}), threshold: v } });
                  }} />
                % · 保留最近
                <input className="input" style={{ width: 70, marginLeft: 4 }} type="number" min={4} max={32}
                  value={s.agentsCompactionPolicy?.keepLast ?? 8}
                  onChange={(e) => {
                    const v = Math.min(32, Math.max(4, Number(e.target.value) || 8));
                    void patch({ agentsCompactionPolicy: { ...(s.agentsCompactionPolicy ?? {}), keepLast: v } });
                  }} />
                条
              </span>
            </div>
            <div className="settings-row">
              <label>轮末钩子</label>
              <input type="checkbox" checked={s.agentsPostTurnHooks ?? true} onChange={(e) => void patch({ agentsPostTurnHooks: e.target.checked })} />
              <span className="hint">插件 post-turn 钩子产物以 system-reminder 注入下一轮</span>
            </div>
            <div className="settings-row">
              <label>完成通知</label>
              <input type="checkbox" checked={s.agentsNotify ?? true} onChange={(e) => void patch({ agentsNotify: e.target.checked })} />
              <span className="hint">任务完成/失败时弹系统通知（窗口聚焦时静默）</span>
            </div>
            <div className="settings-row">
              <label>子代理并发上限</label>
              <input
                className="input"
                style={{ width: 80 }}
                type="number"
                min={1}
                max={6}
                value={s.agentsMaxSubagents ?? 3}
                onChange={(e) => void patch({ agentsMaxSubagents: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })}
              />
            </div>
            <div className="settings-row">
              <label>MCP 工具入循环</label>
              <input
                type="checkbox"
                checked={s.agentsExternalMcpTools ?? false}
                onChange={(e) => void patch({ agentsExternalMcpTools: e.target.checked })}
              />
              <span className="hint">允许 agent 调用包声明的 MCP server 工具（每次调用都需授权确认）</span>
            </div>
            <AgentRulesEditor rules={s.agentRules ?? []} onChange={(rules) => void patch({ agentRules: rules })} />
            <SeamsAuditView />
          </div>
        );
      case "mcp":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_McpSection")}</h4>
            <div className="settings-row">
              <label>{t("Settings_McpEnabled")}</label>
              <input type="checkbox" checked={s.mcpEnabled} onChange={(e) => void patch({ mcpEnabled: e.target.checked })} />
              <span className="hint">{t("Settings_McpHint")}</span>
            </div>
          </div>
        );
      case "extensions":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_ExtensionsSection")}</h4>
            {extError && (
              <div className="banner error" style={{ marginBottom: 8 }}>
                <span className="banner-text">{extError}</span>
                <button className="tool-btn" onClick={() => setExtError(null)}>✕</button>
              </div>
            )}
            <div className="settings-row" style={{ alignItems: "flex-start" }}>
              <label style={{ paddingTop: 4 }}>{t("Settings_ExtensionsSection")}</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={s.allowCodePlugins}
                      onChange={(e) => void patch({ allowCodePlugins: e.target.checked })}
                    />
                    <span>{t("Ext_AllowCodePlugins")}</span>
                    <span className="hint">{t("Ext_AllowCodePluginsHint")}</span>
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={s.externalMcpEnabled}
                      onChange={(e) => void patch({ externalMcpEnabled: e.target.checked })}
                    />
                    <span>{t("Ext_ExternalMcp")}</span>
                    <span className="hint">{t("Ext_ExternalMcpHint")}</span>
                  </label>
                </div>
                <div>
                  <button className="tool-btn icon" data-tip={t("Extensions_Import")} onClick={() => void importGpk()}>
                    <span className="glyph">{""}</span>
                  </button>
                  <input
                    className="input"
                    style={{ width: 260 }}
                    placeholder="https://…/pack.gpk（目录安装）"
                    value={catalogUrl}
                    onChange={(e) => setCatalogUrl(e.target.value)}
                  />
                  <button
                    className="tool-btn"
                    disabled={!catalogUrl.trim().startsWith("http")}
                    onClick={async () => {
                      setExtError(null);
                      try {
                        const r = await call<ExtensionPackageDTO[] | null>("extensions.installFromCatalog", { url: catalogUrl.trim() });
                        if (r) await refreshExts(r);
                        setCatalogUrl("");
                      } catch (e) {
                        setExtError((e as Error).message);
                      }
                    }}
                  >
                    {t("Extensions_InstallFromUrl")}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "6px 0" }}>
                  <span className="hint">视图</span>
                  <button className="tool-btn" style={extView === "tree" ? { borderColor: "var(--c-text)", color: "var(--c-text)" } : undefined} onClick={() => setExtView("tree")}>树状（按页面挂载）</button>
                  <button className="tool-btn" style={extView === "kind" ? { borderColor: "var(--c-text)", color: "var(--c-text)" } : undefined} onClick={() => setExtView("kind")}>类型分组</button>
                </div>
                {exts.length === 0 && <span className="hint">{t("Extensions_Empty")}</span>}
                {extView === "tree" ? (
                  /* 插件挂载树：页面（槽位）→ 页面提供者 / 挂载其下的插件（agent UI 渲染器、
                     输入台 provider、会话命令、同槽位替补）→ 贡献明细；非页面级包归入全局分支。 */
                  extMountTree()
                ) : (
                  <>
                    {/* U 分类分组：按 primaryKind 固定顺序分节；节内按名称排序 */}
                    {KIND_SECTIONS.map(({ kind, label }) => {
                      const group = exts.filter((p) => primaryKindOf(p) === kind).sort((a, b) => a.name.localeCompare(b.name));
                      if (group.length === 0) return null;
                      return (
                        <div key={kind} style={{ marginBottom: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }}>
                            {label} <span className="hint">（{group.length}）</span>
                          </div>
                          {group.map((p) => renderExtCard(p))}
                        </div>
                      );
                    })}
                    {(() => {
                      const known = new Set(KIND_SECTIONS.map((x) => x.kind));
                      const others = exts.filter((p) => !known.has(primaryKindOf(p)));
                      if (others.length === 0) return null;
                      return (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }}>其他（{others.length}）</div>
                          {others.map((p) => renderExtCard(p))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      case "about":
        return (
          <div key={id} className={secCls(id)} id={`set-sec-${id}`}>
            <h4>{t("Settings_AboutSection")}</h4>
            <div className="settings-row">
              <label>Gitter</label>
              <span className="hint">v0.1.0 · Electron 全栈（winui3-to-web-migration.md）</span>
            </div>
            <div className="settings-row">
              <label>git</label>
              <span className="hint" style={{ fontFamily: "var(--mono)" }}>{gitVersion}</span>
            </div>
          </div>
        );
    }
  };

  // ---- 搜索结果（跨分类的条目级匹配，点击跳到节）----
  const catTitle = (c: CategoryId) => t(CATEGORIES.find((x) => x.id === c)!.titleKey);
  const matchedSections = [...new Set(matches.map((m) => m.section))];

  return (
    <>
      <div className="toolbar">
        <span className="settings-page-title">{t("Nav_Settings")}</span>
      </div>
      <div className="settings-layout">
        {/* ════ 一级：分类导航 + 搜索（panel 卡片容器，项样式对齐主侧栏 nav-item）════ */}
        <div className="settings-nav">
          <input
            className="input"
            style={{ width: "100%", flex: "none" }}
            placeholder={t("Settings_Search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!q && CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={"settings-cat" + (cat === c.id ? " active" : "")}
              onClick={() => setCat(c.id)}
              title={t(c.titleKey)}
            >
              <span className="ic"><NavIcon glyph={c.glyph} svg={c.svg} /></span>
              {t(c.titleKey)}
            </button>
          ))}
          {q && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {matchedSections.length === 0 && <div className="hint" style={{ padding: "6px 4px" }}>{t("Settings_NoResults")}</div>}
              {matchedSections.map((sid) => {
                const sec = SECTIONS.find((x) => x.id === sid)!;
                return (
                  <div key={sid} className="card" style={{ padding: "8px 10px" }}>
                    <div className="search-result-cat">{catTitle(sec.cat)}</div>
                    <div style={{ fontSize: 12.5, color: "var(--c-text)", marginBottom: 4 }}>{t(sec.titleKey)}</div>
                    {matches.filter((m) => m.section === sid).map((m, i) => (
                      <div key={i} className="search-result-item" onClick={() => gotoSection(sid)}>
                        {t(m.labelKey)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ════ 二级：当前分类内的节 ════ */}
        <div className="settings-content">
          {SECTIONS.filter((x) => x.cat === cat).map((x) => renderSection(x.id))}
        </div>
      </div>
    </>
  );
}

// ---- Agent 持久授权规则编辑器（agent-harness-v4.md F5.3：deny > allow > 分级基线）----

const AGENT_RULE_TOOLS = [
  "terminal_run", "terminal_poll", "git_stage", "git_commit", "git_push",
  "file_write", "file_patch", "task",
];

function AgentRulesEditor(props: {
  rules: import("../bridge/types").AgentPermissionRuleDTO[];
  onChange: (rules: import("../bridge/types").AgentPermissionRuleDTO[]) => void;
}) {
  const { rules, onChange } = props;
  const [tool, setTool] = useState("terminal_run");
  const [pattern, setPattern] = useState("");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");

  const add = () => {
    const rule: import("../bridge/types").AgentPermissionRuleDTO = {
      id: `rule-${Date.now().toString(36)}`,
      tool,
      pattern: pattern.trim() ? pattern.trim() : null,
      effect,
      scope: "global",
      createdAt: new Date().toISOString(),
    };
    onChange([...rules, rule]);
    setPattern("");
  };

  return (
    <div className="settings-row" style={{ alignItems: "flex-start" }}>
      <label style={{ paddingTop: 4 }}>权限规则</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <div className="hint">deny 优先于 allow；pattern 为空 = 工具全量，否则为命令/参数前缀。agent 执行时先查本表，再走分级授权卡。</div>
        {rules.length === 0 && <div className="hint">（暂无规则）</div>}
        {rules.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            <span className="chip" style={{ color: r.effect === "deny" ? "var(--c-red)" : "var(--c-green)", fontSize: 10.5 }}>
              {r.effect === "deny" ? "拒绝" : "允许"}
            </span>
            <span className="mono">{r.tool}</span>
            <span className="card-path" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.pattern === null || r.pattern === "" ? "（全量）" : `前缀：${r.pattern}`}
            </span>
            <button className="tool-btn" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>删除</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Select style={{ width: 150 }} value={tool} onChange={(v) => setTool(v)}
            options={AGENT_RULE_TOOLS.map((x) => ({ value: x, label: x }))} />
          <Select style={{ width: 90 }} value={effect} onChange={(v) => setEffect(v as "allow" | "deny")}
            options={[{ value: "allow", label: "允许" }, { value: "deny", label: "拒绝" }]} />
          <input className="input" style={{ flex: 1 }} placeholder="前缀（空 = 工具全量），如 npm test" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <button className="tool-btn primary" disabled={!!rules.find((r) => r.tool === tool && r.effect === effect && (r.pattern ?? "") === (pattern.trim() || null))} onClick={add}>添加</button>
        </div>
      </div>
    </div>
  );
}


// ---- §20.6 贡献审计视图（提示词段/采集器/钩子/压缩器/预设 逐包可见）----

interface SeamsAuditDTO {
  sections: { id: string; slot: string; order: number; source: string; packageId: string | null; chars: number }[];
  collectors: { id: string; order: number; tokenBudget: number; source: string; packageId: string | null }[];
  hooks: { id: string; order: number; source: string; packageId: string | null }[];
  compactors: { id: string; source: string; packageId: string | null }[];
  presets: { id: string; name: string; readonly: boolean; tools: string[] | null }[];
  toolNames: string[];
}

function SeamsAuditView() {
  const { call } = pageSdk;
  const [audit, setAudit] = useState<SeamsAuditDTO | null>(null);
  const refresh = useCallback(() => {
    void call<SeamsAuditDTO>("agent.seams.audit").then(setAudit).catch(() => {});
  }, [call]);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [refresh]);
  if (!audit) return null;
  const group = (items: { id: string; extra: string }[], label: string) =>
    items.length > 0 ? (
      <div style={{ marginBottom: 6 }}>
        <div className="card-path">{label}</div>
        {items.map((it) => (
          <div key={it.id} style={{ fontSize: 11.5, display: "flex", gap: 6 }}>
            <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.id}</span>
            <span className="card-path">{it.extra}</span>
          </div>
        ))}
      </div>
    ) : null;
  return (
    <details className="settings-row" style={{ display: "block" }}>
      <summary className="card-path" style={{ cursor: "pointer" }}>
        贡献审计（段 {audit.sections.length} · 采集器 {audit.collectors.length} · 钩子 {audit.hooks.length} · 压缩器 {audit.compactors.length} · 子代理预设 {audit.presets.length}）
      </summary>
      <div style={{ marginTop: 8, border: "1px solid var(--c-border)", borderRadius: 8, padding: 10, maxHeight: 280, overflowY: "auto" }}>
        {group(audit.sections.map((x) => ({ id: x.id, extra: `${x.slot} · order ${x.order} · ${x.source}${x.chars ? ` · ${x.chars}字` : ""}` })), "提示词段")}
        {group(audit.collectors.map((x) => ({ id: x.id, extra: `order ${x.order} · ${x.tokenBudget} tokens · ${x.source}` })), "上下文采集器")}
        {group(audit.hooks.map((x) => ({ id: x.id, extra: `order ${x.order} · ${x.source}` })), "turn 钩子")}
        {group(audit.compactors.map((x) => ({ id: x.id, extra: x.source })), "压缩器")}
        {group(audit.presets.map((x) => ({ id: x.id, extra: `${x.readonly ? "只读" : "可写"} · ${x.tools ? x.tools.length + " 工具" : "全集"}` })), "子代理预设")}
      </div>
    </details>
  );
}

// ---- 添加模型弹窗（DeepSeek-harness 式）：一条连接（名称 + API URL + Key）→ 探测 → 勾选多个模型 → 批量保存 ----
type ModelKind = "openai-compatible" | "anthropic";
type ThinkingLevel = "off" | "low" | "medium" | "high";
const THINKING_LEVELS: ThinkingLevel[] = ["medium", "high", "low", "off"];
const THINKING_LABEL: Record<ThinkingLevel, string> = {
  medium: "Agents_ThinkingMedium",
  high: "Agents_ThinkingHigh",
  low: "Agents_ThinkingLow",
  off: "Agents_ThinkingOff",
};

interface AddModelRow {
  entry: ModelDiscoveryEntryDTO;
  checked: boolean;
  /** 视觉可勾选（false = 端点声明仅文本，置灰不可选） */
  visionEnabled: boolean;
  vision: boolean;
  /** 上下文窗口（token，空串 = 未填写，用默认） */
  contextTokens: string;
  /** 默认思考深度（默认 medium；任务输入台可逐条覆盖） */
  thinking: ThinkingLevel;
}

/** 把千分位/纯数字文本解析为整数；空串或非法 → null（视为未填写）。 */
function parseTokens(text: string): number | null {
  const n = Number(text.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** 上下文窗口的来源说明（悬停提示）：端点模型卡 > 名称推测 > 未提供。 */
/** 分组卡片的默认成员名：defaultModelId 指向具体成员时取该成员，否则为首成员。 */
function defaultMemberName(m: ModelProfileDTO, defaultModelId: string | null): string | null {
  if (!m.isDefault) return null;
  if (defaultModelId && defaultModelId.startsWith(`${m.groupId}#`)) {
    return defaultModelId.slice(m.groupId.length + 1);
  }
  return m.groupModels?.[0]?.modelId ?? m.modelId;
}

function ctxSource(r: AddModelRow): string {
  if (r.entry.contextTokens == null) return t("Settings_ModelsContextUnknown");
  if (r.entry.contextHint) return t("Settings_ModelsContextGuess");
  return t("Settings_ModelsContextFromApi");
}

/** 添加/编辑模型弹窗：一条连接（名称 + API URL + 密钥）下勾选多个模型，
 * 一次性保存为一个分组（组内共享连接与密钥，逐模型配视觉/上下文/思考深度）。
 * edit 给定时回填既有分组——已配置的模型直接以勾选行出现，无需重新探测。 */
function AddModelDialog(props: { edit?: ModelProfileDTO; onClose: () => void; onSaved: () => void }) {
  const edit = props.edit;
  const [kind, setKind] = useState<ModelKind>(edit?.kind ?? "openai-compatible");
  const [name, setName] = useState(edit?.name ?? "");
  const [baseURL, setBaseURL] = useState(edit?.baseURL ?? "");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<AddModelRow[]>(() =>
    edit
      ? // 编辑：已配置成员直接成行（无需探测即可改配/增删）
        (edit.groupModels ?? [{ modelId: edit.modelId, vision: edit.capabilities.vision ?? false, contextTokens: edit.capabilities.contextTokens, thinking: edit.thinking ?? "medium" }]).map((g) => ({
          entry: { id: g.modelId, name: g.modelId, contextTokens: g.contextTokens ?? null, image: null, imageGuess: g.vision, contextHint: null },
          checked: true,
          visionEnabled: true,
          vision: g.vision,
          contextTokens: g.contextTokens ? String(g.contextTokens) : "",
          thinking: g.thinking,
        }))
      : [],
  );
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  /** 探测 /models 并归一为可勾选行：上下文窗口与视觉均来自端点，缺声明时走名称启发式。
   *  已勾选的行（编辑回填或上一轮探测勾选）按模型名保留勾选与手工改配。 */
  const discover = async () => {
    if (!baseURL.trim()) return;
    setStatus("loading");
    setError(null);
    setNote(null);
    try {
      const r = await call<{ error: string | null; probesTruncated: boolean; models: ModelDiscoveryEntryDTO[] }>(
        "models.discover",
        // 编辑模式密钥留空 → 后端取该分组已保存的密钥探测
        { kind, baseURL, apiKey: apiKey || undefined, profileId: edit?.id },
      );
      if (r.error) {
        setStatus("error");
        setError(r.error);
        return;
      }
      if (r.models.length === 0) {
        setStatus("error");
        setError(t("Settings_ModelsEmptyResult"));
        return;
      }
      setRows((prev) => {
        const kept = new Map(prev.filter((x) => x.checked).map((x) => [x.entry.id, x]));
        return r.models.map((entry) => {
          const old = kept.get(entry.id);
          return {
            entry,
            checked: !!old,
            // 端点显式声明"无图片模态" → 视觉置灰不可选；未声明 → 取名称启发式默认
            visionEnabled: entry.image !== false,
            vision: old ? old.vision : entry.image === true ? true : entry.image === null ? entry.imageGuess : false,
            contextTokens: old?.contextTokens ?? (entry.contextTokens ? String(entry.contextTokens) : ""),
            thinking: old?.thinking ?? "medium",
          };
        });
      });
      setStatus("idle");
      setNote(r.probesTruncated
        ? `${t("Settings_ModelsProbesLimited", 12)}；${kind === "anthropic" ? t("Settings_ModelsAnthropicNote") : t("Settings_ModelsNoCard")}`
        : (kind === "anthropic" ? t("Settings_ModelsAnthropicNote") : t("Settings_ModelsNoCard")));
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  };

  const patchRow = (id: string, patch: Partial<AddModelRow>) =>
    setRows((rs) => rs.map((r) => (r.entry.id === id ? { ...r, ...patch } : r)));

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.entry.id.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  const checkedCount = rows.filter((r) => r.checked).length;
  const allChecked = rows.length > 0 && checkedCount === rows.length;

  /** 勾选集变化时统一同步上下文窗口与视觉默认值：
   *  上下文沿用该模型的端点返回值（有则填，无则清空）；视觉按端点声明/名称推断重算。 */
  const setChecked = (id: string, on: boolean) =>
    setRows((rs) => rs.map((r) => {
      if (r.entry.id !== id || r.checked === on) return r;
      return {
        ...r,
        checked: on,
        contextTokens: r.entry.contextTokens ? String(r.entry.contextTokens) : "",
        vision: r.entry.image === true ? true : r.entry.image === null ? r.entry.imageGuess : false,
      };
    }));

  const selectAll = (on: boolean) =>
    setRows((rs) => rs.map((r) => ({ ...r, checked: on })));

  const saveAll = async () => {
    const chosen = rows.filter((r) => r.checked);
    if (chosen.length === 0 || !name.trim() || !baseURL.trim() || saving) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      // 一次保存整个分组：新增合并、缺失移除，组内共享连接与密钥
      await call<{ id: string }>("models.save", {
        profile: {
          id: edit?.id,
          name: name.trim(),
          kind,
          baseURL: baseURL.trim(),
          models: chosen.map((r) => ({
            modelId: r.entry.id,
            vision: r.vision,
            contextTokens: parseTokens(r.contextTokens) ?? undefined,
            thinking: r.thinking,
          })),
        },
        apiKey: apiKey.length >= 8 ? apiKey : undefined,
      });
      setSavedMsg(t("Settings_ModelsSaved", chosen.length));
      void call<SettingsDTO>("settings.get").then(applySettings).catch(() => {});
      props.onSaved();
    } catch (e) {
      setSavedMsg(null);
      setError(`${t("Settings_ModelsTestFail")}: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const placeholder = kind === "anthropic"
    ? "https://api.anthropic.com"
    : "https://api.deepseek.com/v1（或 OpenRouter /v1、Ollama http://127.0.0.1:11434/v1）";

  return (
    <Modal
      title={edit ? t("Settings_ModelsEditTitle") : t("Settings_ModelsAddTitle")}
      confirmText={saving ? "…" : t("Settings_ModelsSaveSelected", checkedCount)}
      confirmDisabled={checkedCount === 0 || !name.trim() || !baseURL.trim() || saving}
      onClose={props.onClose}
      onConfirm={() => void saveAll()}
      className="model-add"
      cancelContent={<TlIcon name="x" size={13} />}
      confirmContent={<TlIcon name="check" size={13} />}
      titleAside={
        <>
          {status === "loading" ? (
            <span className="chip">{t("Settings_ModelsDiscovering")}</span>
          ) : rows.length > 0 ? (
            <span className="chip">{t("Settings_ModelsFound", rows.length)} · {t("Settings_ModelsChecked", checkedCount)}</span>
          ) : null}
          <button className="tool-btn icon sm" data-tip={t("Common_Close")} aria-label={t("Common_Close")}
            onClick={props.onClose}>
            <TlIcon name="x" size={13} />
          </button>
        </>
      }
    >
      <div className="ma-form">
        <span className="hint">{t("Settings_ModelsAddHint")}</span>
        <div className="ma-grid">
          <label>{t("Settings_ModelsNameFor")}</label>
          <input className="input" style={{ height: 30 }} placeholder={t("Settings_ModelsNamePlaceholder")}
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="ma-grid">
          <label>{t("Settings_ModelsType")}</label>
          <Select value={kind}
            onChange={(v) => { setKind(v as ModelKind); setRows([]); setStatus("idle"); setError(null); setNote(null); }}
            options={[{ value: "openai-compatible", label: "OpenAI 兼容（/v1/models）" }, { value: "anthropic", label: "Anthropic（/v1/models）" }]} />
        </div>
        <div className="ma-grid">
          <label>API URL</label>
          <input className="input" style={{ height: 30 }} placeholder={placeholder}
            value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
        </div>
        <div className="ma-grid">
          <label>{t("Settings_ModelsApiKey")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" type="password" style={{ flex: 1, height: 30, minWidth: 0 }}
              placeholder={edit?.hasKey ? t("Settings_ModelsKeyKept") : "sk-…"}
              value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button className="tool-btn icon" data-tip={t("Settings_ModelsDiscover")} aria-label={t("Settings_ModelsDiscover")}
              disabled={status === "loading" || !baseURL.trim()}
              onClick={() => void discover()}>
              <TlIcon name="search" size={13} />
            </button>
          </div>
        </div>
        {error && <div className="ma-conn-err">✕ {error}</div>}
        {note && status !== "loading" && !error && <div className="ma-conn-note">{note}</div>}
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" style={{ flex: 1, height: 30 }} placeholder={t("Settings_ModelsSearchFilter")}
              value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="tool-btn" onClick={() => selectAll(!allChecked)}>
              {allChecked ? t("Settings_ModelsUnselectAll") : t("Settings_ModelsSelectAll")}
            </button>
          </div>
          <div className="ma-list-head">
            <span />
            <span>Model ID</span>
            <span title={t("Settings_ModelsContextUnit")}>{t("Settings_ModelsContext")}</span>
            <span title={t("Settings_ModelsVisionHint")}>{t("Settings_ModelsVision")}</span>
            <span title={t("Settings_ModelsThinkingHint")}>{t("Settings_ModelsThinking")}</span>
          </div>
          {filtered.length === 0 ? (
            <div className="ma-none hint">{t("Settings_ModelsNoMatch")}</div>
          ) : (
            <div className="ma-list">
              {filtered.map((r: AddModelRow) => (
                <div key={r.entry.id} className={"ma-row" + (r.checked ? " checked" : "")}>
                  <input type="checkbox" checked={r.checked} onChange={(e) => setChecked(r.entry.id, e.target.checked)} />
                  <span className="ma-cell"><span className="mono" title={r.entry.id}>{r.entry.id}</span></span>
                  <span className="ma-cell">
                    <input className="input" style={{ flex: 1, height: 26, minWidth: 0 }}
                      placeholder={t("Settings_ModelsContextPlaceholder")}
                      value={r.contextTokens}
                      disabled={!r.checked}
                      title={ctxSource(r)}
                      onChange={(e) => patchRow(r.entry.id, { contextTokens: e.target.value.replace(/[^\d,]/g, "") })} />
                  </span>
                  <span className="ma-cell">
                    <input type="checkbox" checked={r.vision && r.checked}
                      disabled={!r.visionEnabled || !r.checked}
                      title={r.visionEnabled
                        ? (r.entry.image === true ? t("Settings_ModelsVisionFromApi") : t("Settings_ModelsVisionInferred"))
                        : t("Settings_ModelsVisionOff")}
                      onChange={(e) => patchRow(r.entry.id, { vision: e.target.checked })} />
                  </span>
                  <span className="ma-cell">
                    <Select<ThinkingLevel> value={r.thinking}
                      style={{ width: "100%", maxWidth: 92 }}
                      disabled={!r.checked}
                      title={t("Settings_ModelsThinkingHint")}
                      options={THINKING_LEVELS.map((v) => ({ value: v, label: t(THINKING_LABEL[v]) }))}
                      onChange={(v) => patchRow(r.entry.id, { thinking: v })} />
                  </span>
                </div>
              ))}
            </div>
          )}
          {savedMsg && <div className="ma-conn-ok">✓ {savedMsg}</div>}
        </div>
      )}
    </Modal>
  );
}
