import { useEffect, useState } from "react";
import { call } from "../bridge/client";
import type { SettingsDTO, ThemePackageDTO } from "../bridge/types";
import { reapplyLanguage, reapplyTheme, setState, t, useApp } from "../state/store";

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

export function SettingsPage() {
  const app = useApp();
  const s = app.settings;
  const [themes, setThemes] = useState<ThemePackageDTO[]>([]);
  const [gitVersion, setGitVersion] = useState<string>("…");
  const [configScope, setConfigScope] = useState<"repo" | "global">("repo");
  const [localCfg, setLocalCfg] = useState<CfgMap>({});
  const [globalCfg, setGlobalCfg] = useState<CfgMap>({});
  const [noRepo, setNoRepo] = useState(false);
  const [remotes, setRemotes] = useState<RemoteDTO[]>([]);
  const [newRemote, setNewRemote] = useState({ name: "", url: "" });

  useEffect(() => {
    void call<ThemePackageDTO[]>("themes.list").then(setThemes);
    void call<string | null>("app.gitVersion").then((v) => setGitVersion(v ?? t("Settings_GitNotFound")));
  }, []);

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

  // 错误横幅"去设置"跳转定位：滚动到 Git 配置区并清焦
  useEffect(() => {
    if (app.settingsFocus === "git") {
      document.getElementById("settings-git")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setState({ settingsFocus: null });
    }
  }, [app.settingsFocus]);

  if (!s) return null;

  const patch = async (p: Partial<SettingsDTO>) => {
    const next = await call<SettingsDTO>("settings.set", { patch: p });
    setState({ settings: next });
    if (p.theme !== undefined || p.themePackageId !== undefined) await reapplyTheme(next);
    if (p.language !== undefined) await reapplyLanguage(next);
  };

  // ---- Git 配置区辅助 ----
  const cfgInherited = (key: string): string | null => (localCfg[key] === undefined ? globalCfg[key] ?? null : null);

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
    await call("gitconfig.set", { key, value, scope: configScope });
    await reloadGitConfig();
  };

  const cfgTextLabel = (key: string) => {
    const inherited = cfgInherited(key);
    return (
      <>
        <input
          className="input"
          style={{ width: 260 }}
          value={configScope === "repo" ? localCfg[key] ?? "" : globalCfg[key] ?? ""}
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
    const value = configScope === "repo" ? localCfg[key] ?? "" : globalCfg[key] ?? "";
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

  return (
    <div className="settings-wrap">
      <div className="settings-section">
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

      <div className="settings-section">
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

      <div className="settings-section">
        <h4>{t("Settings_TerminalSection")}</h4>
        <div className="settings-row">
          <label>{t("Settings_Shell")}</label>
          <Radio
            value={s.terminalShell}
            options={[
              { value: "powershell", label: "PowerShell" },
              { value: "cmd", label: "CMD" },
              { value: "bash", label: "Git Bash" },
            ]}
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

      <div className="settings-section" id="settings-git">
        <h4>{t("Settings_GitSection")}</h4>
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
                  onClick={async () => { await call("remote.remove", { name: r.name }); await reloadGitConfig(); }}
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
                  try {
                    await call("remote.add", { name: newRemote.name.trim(), url: newRemote.url.trim() });
                    setNewRemote({ name: "", url: "" });
                    await reloadGitConfig();
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                {t("Settings_GitAddRemote")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h4>{t("Settings_MonitorSection")}</h4>
        <div className="settings-row">
          <label>{t("Settings_AutoFetch")}</label>
          <input type="checkbox" checked={s.autoFetch} onChange={(e) => void patch({ autoFetch: e.target.checked })} />
          <span className="hint">{t("Settings_AutoFetchHint")}</span>
        </div>
      </div>

      <div className="settings-section">
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

      <div className="settings-section">
        <h4>{t("Settings_AiSection")}</h4>
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
        </div>
      </div>

      <div className="settings-section">
        <h4>{t("Settings_McpSection")}</h4>
        <div className="settings-row">
          <label>{t("Settings_McpEnabled")}</label>
          <input type="checkbox" checked={s.mcpEnabled} onChange={(e) => void patch({ mcpEnabled: e.target.checked })} />
          <span className="hint">{t("Settings_McpHint")}</span>
        </div>
      </div>

      <div className="settings-section">
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
    </div>
  );
}
