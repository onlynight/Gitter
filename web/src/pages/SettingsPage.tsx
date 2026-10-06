import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../bridge/client";
import { NavIcon } from "../components/Shell";
import type { ExtensionPackageDTO, ModelProfileDTO, SettingsDTO, TerminalProfileDTO, ThemePackageDTO } from "../bridge/types";
import { setState, t, updateSettings, useApp, reapplyTheme } from "../state/store";

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
  const [modelProfiles, setModelProfiles] = useState<ModelProfileDTO[]>([]);
  const [newModel, setNewModel] = useState<{ name: string; kind: "openai-compatible" | "anthropic"; baseURL: string; modelId: string; apiKey: string }>({
    name: "", kind: "openai-compatible", baseURL: "", modelId: "", apiKey: "",
  });
  const [modelTest, setModelTest] = useState<{ testing: boolean; result: string | null; ok: boolean }>({ testing: false, result: null, ok: false });

  const loadModels = useCallback(async () => {
    try {
      setModelProfiles(await call<ModelProfileDTO[]>("models.list"));
    } catch {
      /* 桥不可用（vite 调试）静默 */
    }
  }, []);

  /** 测试连接（DeepSeek-harness 式）：验证 URL+密钥，成功可自动填充首个模型 ID。 */
  const testModelConn = async () => {
    setModelTest({ testing: true, result: null, ok: false });
    try {
      const r = await call<{ ok: boolean; models?: string[]; error?: string }>("models.test", {
        kind: newModel.kind,
        baseURL: newModel.baseURL,
        apiKey: newModel.apiKey || undefined,
      });
      if (r.ok) {
        const first = r.models?.[0];
        setNewModel((m) => ({ ...m, modelId: m.modelId || first || "" }));
        setModelTest({ testing: false, result: `✓ ${t("Settings_ModelsTestOk", r.models?.length ?? 0)}`, ok: true });
      } else {
        setModelTest({ testing: false, result: `✕ ${r.error ?? t("Settings_ModelsTestFail")}`, ok: false });
      }
    } catch (e) {
      setModelTest({ testing: false, result: `✕ ${(e as Error).message}`, ok: false });
    }
  };

  // 两级导航 + 搜索状态
  const [cat, setCat] = useState<CategoryId>("appearance");
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<SectionId | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    void call<ThemePackageDTO[]>("themes.list").then(setThemes);
    void call<TerminalProfileDTO[]>("terminal.profiles").then(setProfiles);
    void call<string | null>("app.gitVersion").then((v) => setGitVersion(v ?? t("Settings_GitNotFound")));
    void call<ExtensionPackageDTO[]>("extensions.list").then(setExts);
    void loadModels();
  }, [loadModels]);

  /** 扩展操作后的统一刷新：主题 kind 变化需重应用主题（禁用活动主题 → 回退内置）。 */
  const refreshExts = async (list: ExtensionPackageDTO[]) => {
    setExts(list);
    if (list.some((p) => p.kinds.includes("theme"))) {
      const fresh = await call<SettingsDTO>("settings.get");
      setState({ settings: fresh });
      await reapplyTheme(fresh);
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
      setState({ settingsFocus: null });
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
        <select
          className="input"
          value={value}
          disabled={configScope === "repo" && noRepo}
          onChange={(e) => void saveConfig(key, e.target.value === "" ? null : e.target.value)}
        >
          <option value="">{t("Settings_Unset")}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
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
              <select className="input" value={s.themePackageId ?? ""} onChange={(e) => void patch({ themePackageId: e.target.value || null })}>
                <option value="">{t("Settings_ThemeDefault")}</option>
                {themes.map((tp) => (
                  <option key={tp.id} value={tp.id}>{tp.name}（{tp.base === "dark" ? t("Settings_Dark") : t("Settings_Light")}）</option>
                ))}
              </select>
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
            <h4>{t("Settings_ModelsSection")}</h4>
            <div className="settings-row" style={{ alignItems: "flex-start" }}>
              <label style={{ paddingTop: 4 }}>{t("Settings_ModelsProfiles")}</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {modelProfiles.length === 0 && <span className="hint">{t("Settings_ModelsEmpty")}</span>}
                {modelProfiles.map((m) => (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <b style={{ fontSize: 12.5 }}>{m.name}</b>
                      <span className="hint mono">{m.modelId}</span>
                      <span className="hint">{m.kind === "anthropic" ? "Anthropic" : "OpenAI 兼容"}</span>
                      <span className="chip">{m.source === "package" ? t("Settings_ModelsSourcePackage") : t("Settings_ModelsSourceUser")}</span>
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
                      {m.source === "user" && <button className="tool-btn" onClick={() => void call("models.delete", { id: m.id }).then(loadModels)}>{t("Settings_ModelsDelete")}</button>}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--c-border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)" }}>{t("Settings_ModelsAdd")}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input className="input" style={{ width: 140 }} placeholder={t("Settings_ModelsName")} value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} />
                    <select className="input" style={{ width: 150 }} value={newModel.kind} onChange={(e) => { setNewModel({ ...newModel, kind: e.target.value as "openai-compatible" | "anthropic", modelId: "" }); setModelTest({ testing: false, result: null, ok: false }); }}>
                      <option value="openai-compatible">OpenAI 兼容</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                    <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder={newModel.kind === "anthropic" ? "https://api.anthropic.com" : "https://api.deepseek.com/v1（或 Ollama: http://127.0.0.1:11434/v1）"} value={newModel.baseURL} onChange={(e) => setNewModel({ ...newModel, baseURL: e.target.value })} />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input className="input" type="password" style={{ width: 220 }} placeholder={t("Settings_ModelsApiKey")} value={newModel.apiKey} onChange={(e) => setNewModel({ ...newModel, apiKey: e.target.value })} />
                    <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder={t("Settings_ModelsIdPlaceholder")} value={newModel.modelId} onChange={(e) => setNewModel({ ...newModel, modelId: e.target.value })} />
                    <button className="tool-btn" disabled={modelTest.testing || !newModel.baseURL.trim()} onClick={() => void testModelConn()}>
                      {modelTest.testing ? "…" : t("Settings_ModelsTestConn")}
                    </button>
                    <button
                      className="tool-btn primary"
                      disabled={!newModel.name.trim() || !newModel.baseURL.trim() || !newModel.modelId.trim()}
                      onClick={async () => {
                        try {
                          const r = await call<{ id: string }>("models.save", { profile: { name: newModel.name.trim(), kind: newModel.kind, baseURL: newModel.baseURL.trim(), modelId: newModel.modelId.trim() } });
                          if (newModel.apiKey.length >= 8) {
                            await call("models.setKey", { id: r.id, key: newModel.apiKey });
                          }
                          setNewModel({ name: "", kind: "openai-compatible", baseURL: "", modelId: "", apiKey: "" });
                          setModelTest({ testing: false, result: null, ok: false });
                          await loadModels();
                        } catch (e) {
                          setExtError((e as Error).message);
                        }
                      }}
                    >
                      {t("Settings_ModelsAdd")}
                    </button>
                  </div>
                  {modelTest.result && (
                    <div style={{ fontSize: 11.5, color: modelTest.ok ? "var(--c-green)" : "var(--c-red)" }}>{modelTest.result}</div>
                  )}
                </div>
                <span className="hint">{t("Settings_ModelsHint")}</span>
              </div>
            </div>
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
                  <button className="tool-btn" onClick={() => void importGpk()}>{t("Extensions_Import")}</button>
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
                {exts.length === 0 && <span className="hint">{t("Extensions_Empty")}</span>}
                {exts.map((p) => {
                  const cfgValues = (s.packages?.[p.id]?.config ?? {}) as Record<string, unknown>;
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
                        <span>{p.name} <span className="hint">v{p.version}</span></span>
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
                    {p.permissions.length > 0 && <span className="hint" title="L3 隔离插件权限清单">权限: {p.permissions.join(" / ")}</span>}
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
                })}
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
