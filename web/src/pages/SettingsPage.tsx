import { useEffect, useState } from "react";
import { call } from "../bridge/client";
import type { SettingsDTO, ThemePackageDTO } from "../bridge/types";
import { reapplyLanguage, reapplyTheme, setState, t, useApp } from "../state/store";
export function SettingsPage() {
  const app = useApp();
  const s = app.settings;
  const [themes, setThemes] = useState<ThemePackageDTO[]>([]);
  const [gitVersion, setGitVersion] = useState<string>("…");

  useEffect(() => {
    void call<ThemePackageDTO[]>("themes.list").then(setThemes);
    void call<string | null>("app.gitVersion").then((v) => setGitVersion(v ?? t("Settings_GitNotFound")));
  }, []);

  if (!s) return null;

  const patch = async (p: Partial<SettingsDTO>) => {
    const next = await call<SettingsDTO>("settings.set", { patch: p });
    setState({ settings: next });
    if (p.theme !== undefined || p.themePackageId !== undefined) await reapplyTheme(next);
    if (p.language !== undefined) await reapplyLanguage(next);
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
