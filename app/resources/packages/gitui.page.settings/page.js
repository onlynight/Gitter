(function(jsxRuntime, react) {
  "use strict";
  var _a, _b;
  function U() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  const BOOT = ((_b = (_a = window.GITTER_UI) == null ? void 0 : _a.getActiveCaller) == null ? void 0 : _b.call(_a)) ?? null;
  const pageSdk = {
    call: (method, params) => {
      const g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    t: (key, ...args) => U().t(key, ...args),
    updateSettings: (patch) => U().updateSettings(patch),
    applySettings: (s) => U().applySettings(s),
    reloadTheme: () => U().reloadTheme(),
    clearSettingsFocus: () => U().clearSettingsFocus()
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  const K = () => {
    const k = window.GITTER_KIT;
    if (!k) throw new Error("GITTER_KIT 未注入（外部页必须经宿主 pageLoader 装载）");
    return k;
  };
  const React = K().React;
  K().ReactDOM;
  const ReactDOMClient = K().ReactDOMClient;
  K().DiffView;
  K().diffStatusLetter;
  K().renderSegments;
  K().wordDiff;
  K().SplitPane;
  K().Banner;
  K().Modal;
  K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  const NavIcon = K().NavIcon;
  const { call, t, updateSettings, applySettings, clearSettingsFocus, reloadTheme } = pageSdk;
  const useApp = useAppState;
  const GIT_KEYS = {
    userName: "user.name",
    userEmail: "user.email",
    autoSetupRemote: "push.autoSetupRemote",
    pullRebase: "pull.rebase",
    autocrlf: "core.autocrlf"
  };
  const CATEGORIES = [
    { id: "appearance", titleKey: "Settings_CatAppearance", glyph: "" },
    { id: "terminal", titleKey: "Settings_CatTerminal", glyph: "" },
    {
      id: "repo",
      titleKey: "Settings_CatRepo",
      svg: "M13.1 3.9a2.3 2.3 0 0 0-3.25 3.25l-.1.1a2.3 2.3 0 0 1-3.25 0L5.4 6.2a2.3 2.3 0 1 0-1.06 1.06l1.1 1.05a3.8 3.8 0 0 0 2.31 1.09v1.2a2.3 2.3 0 1 0 1.5 0V9.4a3.8 3.8 0 0 0 2.31-1.09l.1-.1a2.3 2.3 0 1 0 1.44-4.31z"
    },
    { id: "models", titleKey: "Settings_CatModels", glyph: "" },
    { id: "ai", titleKey: "Settings_CatAi", glyph: "" },
    { id: "extensions", titleKey: "Settings_CatExtensions", glyph: "" },
    { id: "about", titleKey: "Settings_CatAbout", glyph: "" }
  ];
  const SECTIONS = [
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
    { id: "about", cat: "about", titleKey: "Settings_AboutSection" }
  ];
  const SEARCH_INDEX = [
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
    { section: "about", labelKey: "Settings_AboutSection", kw: "about 版本 version git" }
  ];
  function SettingsPage() {
    var _a2;
    const app = useApp();
    const s = app.settings;
    const [themes, setThemes] = react.useState([]);
    const [profiles, setProfiles] = react.useState([
      { id: "powershell", name: "PowerShell", source: "builtin" },
      { id: "cmd", name: "CMD", source: "builtin" },
      { id: "bash", name: "Git Bash", source: "builtin" }
    ]);
    const [gitVersion, setGitVersion] = react.useState("…");
    const [configScope, setConfigScope] = react.useState("repo");
    const [localCfg, setLocalCfg] = react.useState({});
    const [globalCfg, setGlobalCfg] = react.useState({});
    const [noRepo, setNoRepo] = react.useState(false);
    const [remotes, setRemotes] = react.useState([]);
    const [newRemote, setNewRemote] = react.useState({ name: "", url: "" });
    const [cfgError, setCfgError] = react.useState(null);
    const [exts, setExts] = react.useState([]);
    const [extError, setExtError] = react.useState(null);
    const [catalogUrl, setCatalogUrl] = react.useState("");
    const KIND_SECTIONS = [
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
      { kind: "configuration", label: "配置" }
    ];
    const primaryKindOf = (p) => p.kinds.find((k) => KIND_SECTIONS.some((x) => x.kind === k)) ?? p.kinds[0] ?? "__other";
    const kindLabel = (k) => {
      var _a3;
      return ((_a3 = KIND_SECTIONS.find((x) => x.kind === k)) == null ? void 0 : _a3.label) ?? k;
    };
    const renderExtCard = (p) => {
      var _a3, _b2;
      const cfgValues = ((_b2 = (_a3 = s == null ? void 0 : s.packages) == null ? void 0 : _a3[p.id]) == null ? void 0 : _b2.config) ?? {} ?? {};
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              type: "checkbox",
              checked: p.state === "active",
              disabled: p.state === "error",
              title: p.state === "disabled" && p.reason ? p.reason : void 0,
              onChange: (e) => void setPkgEnabled(p, e.target.checked)
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--c-text2)" }, children: [
              "[",
              kindLabel(primaryKindOf(p)),
              "]"
            ] }),
            " ",
            p.name,
            " ",
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
              "v",
              p.version
            ] })
          ] }),
          p.isBuiltIn && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Extensions_BuiltIn") }),
          p.kinds.map((k) => /* @__PURE__ */ jsxRuntime.jsxs(
            "button",
            {
              className: "tool-btn",
              title: p.kindStates[k] ? "点击禁用该类内容" : "点击启用该类内容",
              style: { opacity: p.kindStates[k] === false ? 0.45 : 1, padding: "0 6px" },
              onClick: async () => {
                setExtError(null);
                try {
                  await refreshExts(await call("extensions.setKindEnabled", {
                    id: p.id,
                    kind: k,
                    enabled: p.kindStates[k] === false
                  }));
                } catch (e) {
                  setExtError(e.message);
                }
              },
              children: [
                k,
                p.kindStates[k] === false ? "（已禁用）" : ""
              ]
            },
            k
          )),
          p.permissions.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", title: "权限域声明", children: [
            "权限: ",
            p.permissions.join(" / ")
          ] }),
          p.state !== "active" && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { color: "var(--c-red)" }, children: p.state === "error" ? `${t("Extensions_Error")}: ${p.reason ?? ""}` : t("Extensions_Disabled") + (p.reason ? ` — ${p.reason}` : "") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } }),
          !p.isBuiltIn && p.state !== "error" && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void uninstallPkg(p), children: t("Extensions_Uninstall") })
        ] }),
        p.state === "active" && p.kindStates.configuration && p.configuration.map((item) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", paddingLeft: 24 }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { width: 140 }, children: item.title ?? item.key }),
          item.type === "boolean" ? /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              type: "checkbox",
              checked: typeof cfgValues[item.key] === "boolean" ? cfgValues[item.key] : !!item.default,
              onChange: (e) => void call("extensions.setConfig", { id: p.id, key: item.key, value: e.target.checked })
            }
          ) : /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "input",
              style: { width: 200 },
              type: item.type === "number" ? "number" : "text",
              value: cfgValues[item.key] !== void 0 ? String(cfgValues[item.key]) : String(item.default),
              onChange: (e) => {
                const v = item.type === "number" ? Number(e.target.value) : e.target.value;
                void call("extensions.setConfig", { id: p.id, key: item.key, value: v });
              }
            }
          )
        ] }, item.key))
      ] }, p.id);
    };
    const [modelProfiles, setModelProfiles] = react.useState([]);
    const [newModel, setNewModel] = react.useState({
      name: "",
      kind: "openai-compatible",
      baseURL: "",
      modelId: "",
      apiKey: ""
    });
    const [modelTest, setModelTest] = react.useState({ testing: false, result: null, ok: false });
    const loadModels = react.useCallback(async () => {
      try {
        setModelProfiles(await call("models.list"));
      } catch {
      }
    }, []);
    const testModelConn = async () => {
      var _a3, _b2;
      setModelTest({ testing: true, result: null, ok: false });
      try {
        const r = await call("models.test", {
          kind: newModel.kind,
          baseURL: newModel.baseURL,
          apiKey: newModel.apiKey || void 0
        });
        if (r.ok) {
          const first = (_a3 = r.models) == null ? void 0 : _a3[0];
          setNewModel((m) => ({ ...m, modelId: m.modelId || first || "" }));
          setModelTest({ testing: false, result: `✓ ${t("Settings_ModelsTestOk", ((_b2 = r.models) == null ? void 0 : _b2.length) ?? 0)}`, ok: true });
        } else {
          setModelTest({ testing: false, result: `✕ ${r.error ?? t("Settings_ModelsTestFail")}`, ok: false });
        }
      } catch (e) {
        setModelTest({ testing: false, result: `✕ ${e.message}`, ok: false });
      }
    };
    const [cat, setCat] = react.useState("appearance");
    const [query, setQuery] = react.useState("");
    const [flash, setFlash] = react.useState(null);
    const flashTimer = react.useRef(null);
    react.useEffect(() => {
      void call("themes.list").then(setThemes);
      void call("terminal.profiles").then(setProfiles);
      void call("app.gitVersion").then((v) => setGitVersion(v ?? t("Settings_GitNotFound")));
      void call("extensions.list").then(setExts);
      void loadModels();
    }, [loadModels]);
    const refreshExts = async (list) => {
      setExts(list);
      if (list.some((p) => p.kinds.includes("theme"))) {
        const fresh = await call("settings.get");
        applySettings(fresh);
        await reloadTheme();
      }
    };
    const importGpk = async () => {
      setExtError(null);
      try {
        const r = await call("extensions.importGpk");
        if (r) await refreshExts(r);
      } catch (e) {
        setExtError(e.message);
      }
    };
    const setPkgEnabled = async (p, enabled) => {
      setExtError(null);
      try {
        await refreshExts(await call("extensions.setEnabled", { id: p.id, enabled }));
      } catch (e) {
        setExtError(e.message);
      }
    };
    const uninstallPkg = async (p) => {
      setExtError(null);
      try {
        await refreshExts(await call("extensions.uninstall", { id: p.id }));
      } catch (e) {
        setExtError(e.message);
      }
    };
    react.useEffect(() => {
      (async () => {
        const [l, g] = await Promise.all([
          call("gitconfig.list", { scope: "repo" }).catch(() => null),
          call("gitconfig.list", { scope: "global" }).catch(() => ({}))
        ]);
        setNoRepo(l === null);
        setLocalCfg(l ?? {});
        setGlobalCfg(g);
        setRemotes(l !== null ? await call("remote.list").catch(() => []) : []);
      })();
    }, [(_a2 = app.repo) == null ? void 0 : _a2.workDir]);
    const gotoSection = (id) => {
      const sec = SECTIONS.find((x) => x.id === id);
      if (!sec) return;
      setCat(sec.cat);
      setQuery("");
      window.setTimeout(() => {
        var _a3;
        (_a3 = document.getElementById(`set-sec-${id}`)) == null ? void 0 : _a3.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlash(id);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
      }, 60);
    };
    react.useEffect(() => {
      if (app.settingsFocus) {
        gotoSection(app.settingsFocus);
        clearSettingsFocus();
      }
    }, [app.settingsFocus]);
    if (!s) return null;
    const patch = async (p) => {
      await updateSettings(p);
    };
    const q = query.trim().toLowerCase();
    const matches = q ? SEARCH_INDEX.filter((it) => {
      const label = t(it.labelKey).toLowerCase();
      return label.includes(q) || it.labelKey.toLowerCase().includes(q) || (it.kw ?? "").toLowerCase().includes(q);
    }) : [];
    const cfgGet = (map, key) => map[key.toLowerCase()];
    const cfgInherited = (key) => cfgGet(localCfg, key) === void 0 ? globalCfg[key.toLowerCase()] ?? null : null;
    const reloadGitConfig = async () => {
      const [l, g, r] = await Promise.all([
        call("gitconfig.list", { scope: "repo" }).catch(() => null),
        call("gitconfig.list", { scope: "global" }).catch(() => ({})),
        call("remote.list").catch(() => [])
      ]);
      setNoRepo(l === null);
      setLocalCfg(l ?? {});
      setGlobalCfg(g);
      setRemotes(r);
    };
    const saveConfig = async (key, value) => {
      setCfgError(null);
      try {
        await call("gitconfig.set", { key, value, scope: configScope });
        await reloadGitConfig();
      } catch (e) {
        setCfgError(e.message);
        await reloadGitConfig();
      }
    };
    const cfgTextLabel = (key) => {
      const inherited = cfgInherited(key);
      return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "input",
          {
            className: "input",
            style: { width: 260 },
            value: configScope === "repo" ? cfgGet(localCfg, key) ?? "" : cfgGet(globalCfg, key) ?? "",
            placeholder: inherited ?? "",
            title: inherited !== null ? t("Settings_GitInheritGlobal", inherited) : void 0,
            onChange: (e) => void saveConfig(key, e.target.value === "" ? null : e.target.value),
            disabled: configScope === "repo" && noRepo
          }
        ),
        inherited !== null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitInheritGlobal", inherited) })
      ] });
    };
    const cfgSelect = (key, options) => {
      const value = configScope === "repo" ? cfgGet(localCfg, key) ?? "" : cfgGet(globalCfg, key) ?? "";
      const inherited = cfgInherited(key);
      return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs(
          "select",
          {
            className: "input",
            value,
            disabled: configScope === "repo" && noRepo,
            onChange: (e) => void saveConfig(key, e.target.value === "" ? null : e.target.value),
            children: [
              /* @__PURE__ */ jsxRuntime.jsx("option", { value: "", children: t("Settings_Unset") }),
              options.map((o) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: o, children: o }, o))
            ]
          }
        ),
        inherited !== null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitInheritGlobal", inherited) })
      ] });
    };
    const Radio = (props) => /* @__PURE__ */ jsxRuntime.jsx("div", { className: "radio-group", children: props.options.map((o) => /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn" + (props.value === o.value ? " chosen" : ""), onClick: () => props.onChange(o.value), children: o.label }, o.value)) });
    const secCls = (id) => flash === id ? "settings-section flash" : "settings-section";
    const renderSection = (id) => {
      var _a3, _b2;
      switch (id) {
        case "appearance":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AppearanceSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_Theme") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.theme,
                  options: [
                    { value: "system", label: t("Settings_ThemeSystem") },
                    { value: "light", label: t("Settings_ThemeLight") },
                    { value: "dark", label: t("Settings_ThemeDark") }
                  ],
                  onChange: (v) => void patch({ theme: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_ThemePackage") }),
              /* @__PURE__ */ jsxRuntime.jsxs("select", { className: "input", value: s.themePackageId ?? "", onChange: (e) => void patch({ themePackageId: e.target.value || null }), children: [
                /* @__PURE__ */ jsxRuntime.jsx("option", { value: "", children: t("Settings_ThemeDefault") }),
                themes.map((tp) => /* @__PURE__ */ jsxRuntime.jsxs("option", { value: tp.id, children: [
                  tp.name,
                  "（",
                  tp.base === "dark" ? t("Settings_Dark") : t("Settings_Light"),
                  "）"
                ] }, tp.id))
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_Language") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.language,
                  options: [
                    { value: "system", label: t("Settings_LangSystem") },
                    { value: "en", label: "English" },
                    { value: "zh-Hans", label: "简体中文" }
                  ],
                  onChange: (v) => void patch({ language: v })
                }
              )
            ] })
          ] }, id);
        case "diff":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_DiffSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_DiffMode") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.diffMode,
                  options: [
                    { value: "sideBySide", label: t("Settings_DiffSide") },
                    { value: "inline", label: t("Settings_DiffInline") }
                  ],
                  onChange: (v) => void patch({ diffMode: v })
                }
              )
            ] })
          ] }, id);
        case "terminal":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_TerminalSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_Shell") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.terminalShell,
                  options: profiles.map((p) => ({ value: p.id, label: p.name })),
                  onChange: (v) => void patch({ terminalShell: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_TerminalFont") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", value: s.terminalFontFamily, onChange: (e) => void patch({ terminalFontFamily: e.target.value }) }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  className: "input",
                  type: "number",
                  min: 8,
                  max: 28,
                  style: { width: 70 },
                  value: s.terminalFontSize,
                  onChange: (e) => void patch({ terminalFontSize: Number(e.target.value) || 13 })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_TerminalFollowRepo") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.terminalFollowRepo, onChange: (e) => void patch({ terminalFollowRepo: e.target.checked }) })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_BashPath") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 320 }, placeholder: t("Settings_BashPathHint"), value: s.bashPath ?? "", onChange: (e) => void patch({ bashPath: e.target.value || null }) })
            ] })
          ] }, id);
        case "git":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_GitSection") }),
            cfgError && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", style: { marginBottom: 8 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: cfgError }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setCfgError(null), children: "✕" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitScope") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: configScope,
                  options: [
                    { value: "repo", label: t("Settings_GitRepoLevel") },
                    { value: "global", label: t("Settings_GitGlobalLevel") }
                  ],
                  onChange: (v) => setConfigScope(v)
                }
              ),
              configScope === "repo" && noRepo && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_NoRepoHint") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitUserName") }),
              cfgTextLabel(GIT_KEYS.userName)
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitUserEmail") }),
              cfgTextLabel(GIT_KEYS.userEmail)
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitAutoSetupRemote") }),
              cfgSelect(GIT_KEYS.autoSetupRemote, ["true", "false"]),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitAutoSetupRemoteHint") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitPullRebase") }),
              cfgSelect(GIT_KEYS.pullRebase, ["true", "false"])
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_GitAutocrlf") }),
              cfgSelect(GIT_KEYS.autocrlf, ["input", "true", "false"])
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { style: { paddingTop: 4 }, children: t("Settings_GitRemotes") }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, flex: 1 }, children: [
                remotes.map((r) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontFamily: "var(--mono)", fontSize: 11.5, width: 80, flex: "none" }, children: r.name }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { fontFamily: "var(--mono)", userSelect: "text", flex: 1, wordBreak: "break-all" }, children: r.url }),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "button",
                    {
                      className: "tool-btn",
                      onClick: async () => {
                        setCfgError(null);
                        try {
                          await call("remote.remove", { name: r.name });
                          await reloadGitConfig();
                        } catch (e) {
                          setCfgError(e.message);
                        }
                      },
                      children: t("Projects_Remove")
                    }
                  )
                ] }, r.name)),
                remotes.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_GitNoRemotes") }),
                /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 110 }, placeholder: t("Settings_GitRemoteName"), value: newRemote.name, onChange: (e) => setNewRemote((n) => ({ ...n, name: e.target.value })) }),
                  /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { flex: 1 }, placeholder: t("Settings_GitRemoteUrl"), value: newRemote.url, onChange: (e) => setNewRemote((n) => ({ ...n, url: e.target.value })) }),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "button",
                    {
                      className: "tool-btn",
                      disabled: !newRemote.name.trim() || !newRemote.url.trim() || noRepo,
                      onClick: async () => {
                        setCfgError(null);
                        try {
                          await call("remote.add", { name: newRemote.name.trim(), url: newRemote.url.trim() });
                          setNewRemote({ name: "", url: "" });
                          await reloadGitConfig();
                        } catch (e) {
                          setCfgError(e.message);
                        }
                      },
                      children: t("Settings_GitAddRemote")
                    }
                  )
                ] })
              ] })
            ] })
          ] }, id);
        case "monitor":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_MonitorSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AutoFetch") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.autoFetch, onChange: (e) => void patch({ autoFetch: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AutoFetchHint") })
            ] })
          ] }, id);
        case "editor":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_EditorSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_ExternalEditor") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 320 }, placeholder: "code --wait", value: s.externalEditor ?? "", onChange: (e) => void patch({ externalEditor: e.target.value || null }) }),
              /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "tool-btn",
                  onClick: async () => {
                    const p = await call("dialog.pickFile", { title: t("Settings_PickEditor"), filters: [{ name: "exe", ext: ["exe"] }] });
                    if (p) await patch({ externalEditor: `"${p}"` });
                  },
                  children: "…"
                }
              )
            ] })
          ] }, id);
        case "ai":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AiSection") }),
            (((_a3 = s.models) == null ? void 0 : _a3.length) ?? 0) > 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "settings-row", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AiMigrated") }) }),
            (((_b2 = s.models) == null ? void 0 : _b2.length) ?? 0) === 0 && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiProvider") }),
                /* @__PURE__ */ jsxRuntime.jsx(
                  Radio,
                  {
                    value: s.aiProvider,
                    options: [
                      { value: "off", label: t("Settings_AiOff") },
                      { value: "openai", label: "OpenAI 兼容" },
                      { value: "anthropic", label: "Anthropic" },
                      { value: "cli", label: "CLI 桥" }
                    ],
                    onChange: (v) => void patch({ aiProvider: v })
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AiProviderHint") })
              ] }),
              s.aiProvider === "openai" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: "Endpoint / Model" }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 220 }, placeholder: "https://api.xx.com/v1", value: s.aiEndpoint ?? "", onChange: (e) => void patch({ aiEndpoint: e.target.value || null }) }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 160 }, placeholder: "model", value: s.aiModel ?? "", onChange: (e) => void patch({ aiModel: e.target.value || null }) })
              ] }),
              s.aiProvider === "anthropic" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: "Endpoint / Model" }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 220 }, placeholder: "https://api.anthropic.com", value: s.aiEndpoint ?? "", onChange: (e) => void patch({ aiEndpoint: e.target.value || null }) }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 160 }, placeholder: "claude-…", value: s.aiModel ?? "", onChange: (e) => void patch({ aiModel: e.target.value || null }) })
              ] }),
              s.aiProvider === "cli" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiCliCommand") }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 320 }, placeholder: `claude -p / codex exec`, value: s.aiCliCommand ?? "", onChange: (e) => void patch({ aiCliCommand: e.target.value || null }) })
              ] }),
              (s.aiProvider === "openai" || s.aiProvider === "anthropic") && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
                /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiApiKey") }),
                /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", type: "password", style: { width: 260 }, placeholder: s.aiApiKeyProtected ? "••••••（已保存）" : "sk-…", onChange: (e) => {
                  const key = e.target.value;
                  if (key.length >= 8) void call("settings.setAiKey", { key });
                } }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AiKeyHint") })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiPrivacy") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.aiPrivacy,
                  options: [
                    { value: "metadataOnly", label: t("Settings_AiMetadata") },
                    { value: "fullDiff", label: t("Settings_AiFullDiff") },
                    { value: "disabled", label: t("Settings_AiDisabled") }
                  ],
                  onChange: (v) => void patch({ aiPrivacy: v })
                }
              )
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AiTrailer") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.aiAppendTrailer, onChange: (e) => void patch({ aiAppendTrailer: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "Assisted-by: Gitter" })
            ] })
          ] }, id);
        case "models":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_ModelsSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { style: { paddingTop: 4 }, children: t("Settings_ModelsProfiles") }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, flex: 1 }, children: [
                modelProfiles.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_ModelsEmpty") }),
                modelProfiles.map((m) => /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--c-border)", paddingBottom: 8 }, children: [
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx("b", { style: { fontSize: 12.5 }, children: m.name }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint mono", children: m.modelId }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: m.kind === "anthropic" ? "Anthropic" : "OpenAI 兼容" }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: m.source === "package" ? t("Settings_ModelsSourcePackage") : t("Settings_ModelsSourceUser") }),
                    !m.configured && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", style: { color: "var(--c-amber)", background: "transparent", border: "1px solid var(--c-amber)" }, children: t("Settings_ModelsNeedKey") }),
                    m.isDefault && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsDefault") }),
                    m.isFast && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsFast") }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
                    m.usage.turns > 0 && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint mono", children: [
                      m.usage.turns,
                      " 轮 · in ",
                      m.usage.inputTokens,
                      " / out ",
                      m.usage.outputTokens
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsx("div", { className: "card-path", children: m.baseURL }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "input",
                      {
                        className: "input",
                        type: "password",
                        style: { width: 200 },
                        placeholder: m.hasKey ? "••••••（已保存）" : m.keyHint ?? t("Settings_ModelsKeyPlaceholder"),
                        onChange: (e) => {
                          const k = e.target.value;
                          if (k.length >= 8) void call("models.setKey", { id: m.id, key: k }).then(loadModels);
                        }
                      }
                    ),
                    !m.isDefault && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("models.setDefault", { id: m.id }).then(loadModels), children: t("Settings_ModelsSetDefault") }),
                    m.isDefault && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "chip", children: t("Settings_ModelsDefault") }),
                    !m.isFast && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("models.setFast", { id: m.id }).then(loadModels), children: t("Settings_ModelsSetFast") }),
                    m.source === "user" && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => void call("models.delete", { id: m.id }).then(loadModels), children: t("Settings_ModelsDelete") })
                  ] })
                ] }, m.id)),
                /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--c-border)", borderRadius: 10, padding: "10px 12px" }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 12, fontWeight: 600, color: "var(--c-text)" }, children: t("Settings_ModelsAdd") }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { width: 140 }, placeholder: t("Settings_ModelsName"), value: newModel.name, onChange: (e) => setNewModel({ ...newModel, name: e.target.value }) }),
                    /* @__PURE__ */ jsxRuntime.jsxs("select", { className: "input", style: { width: 150 }, value: newModel.kind, onChange: (e) => {
                      setNewModel({ ...newModel, kind: e.target.value, modelId: "" });
                      setModelTest({ testing: false, result: null, ok: false });
                    }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx("option", { value: "openai-compatible", children: "OpenAI 兼容" }),
                      /* @__PURE__ */ jsxRuntime.jsx("option", { value: "anthropic", children: "Anthropic" })
                    ] }),
                    /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { flex: 1, minWidth: 180 }, placeholder: newModel.kind === "anthropic" ? "https://api.anthropic.com" : "https://api.deepseek.com/v1（或 Ollama: http://127.0.0.1:11434/v1）", value: newModel.baseURL, onChange: (e) => setNewModel({ ...newModel, baseURL: e.target.value }) })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", type: "password", style: { width: 220 }, placeholder: t("Settings_ModelsApiKey"), value: newModel.apiKey, onChange: (e) => setNewModel({ ...newModel, apiKey: e.target.value }) }),
                    /* @__PURE__ */ jsxRuntime.jsx("input", { className: "input", style: { flex: 1, minWidth: 140 }, placeholder: t("Settings_ModelsIdPlaceholder"), value: newModel.modelId, onChange: (e) => setNewModel({ ...newModel, modelId: e.target.value }) }),
                    /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: modelTest.testing || !newModel.baseURL.trim(), onClick: () => void testModelConn(), children: modelTest.testing ? "…" : t("Settings_ModelsTestConn") }),
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "button",
                      {
                        className: "tool-btn primary",
                        disabled: !newModel.name.trim() || !newModel.baseURL.trim() || !newModel.modelId.trim(),
                        onClick: async () => {
                          try {
                            const r = await call("models.save", { profile: { name: newModel.name.trim(), kind: newModel.kind, baseURL: newModel.baseURL.trim(), modelId: newModel.modelId.trim() } });
                            if (newModel.apiKey.length >= 8) {
                              await call("models.setKey", { id: r.id, key: newModel.apiKey });
                            }
                            setNewModel({ name: "", kind: "openai-compatible", baseURL: "", modelId: "", apiKey: "" });
                            setModelTest({ testing: false, result: null, ok: false });
                            await loadModels();
                          } catch (e) {
                            setExtError(e.message);
                          }
                        },
                        children: t("Settings_ModelsAdd")
                      }
                    )
                  ] }),
                  modelTest.result && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11.5, color: modelTest.ok ? "var(--c-green)" : "var(--c-red)" }, children: modelTest.result })
                ] }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_ModelsHint") })
              ] })
            ] })
          ] }, id);
        case "safety":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_SafetyNetSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_SafetyNet") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.safetyNet,
                  options: [
                    { value: "off", label: t("Settings_SafetyOff") },
                    { value: "warn", label: t("Settings_SafetyWarn") },
                    { value: "block", label: t("Settings_SafetyBlock") }
                  ],
                  onChange: (v) => void patch({ safetyNet: v })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_SafetyNetHint") })
            ] })
          ] }, id);
        case "agent":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AgentSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AgentCheckpoint") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.agentsCheckpoint, onChange: (e) => void patch({ agentsCheckpoint: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_AgentCheckpointHint") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_AgentOnExit") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Radio,
                {
                  value: s.agentsOnExit,
                  options: [
                    { value: "terminate", label: t("Settings_AgentOnExitTerminate") },
                    { value: "keep", label: t("Settings_AgentOnExitKeep") }
                  ],
                  onChange: (v) => void patch({ agentsOnExit: v })
                }
              )
            ] })
          ] }, id);
        case "mcp":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_McpSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: t("Settings_McpEnabled") }),
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: s.mcpEnabled, onChange: (e) => void patch({ mcpEnabled: e.target.checked }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Settings_McpHint") })
            ] })
          ] }, id);
        case "extensions":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_ExtensionsSection") }),
            extError && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", style: { marginBottom: 8 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: extError }),
              /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setExtError(null), children: "✕" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", style: { alignItems: "flex-start" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { style: { paddingTop: 4 }, children: t("Settings_ExtensionsSection") }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, flex: 1 }, children: [
                /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
                  /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "input",
                      {
                        type: "checkbox",
                        checked: s.allowCodePlugins,
                        onChange: (e) => void patch({ allowCodePlugins: e.target.checked })
                      }
                    ),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Ext_AllowCodePlugins") }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Ext_AllowCodePluginsHint") })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "input",
                      {
                        type: "checkbox",
                        checked: s.externalMcpEnabled,
                        onChange: (e) => void patch({ externalMcpEnabled: e.target.checked })
                      }
                    ),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Ext_ExternalMcp") }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Ext_ExternalMcpHint") })
                  ] })
                ] }),
                /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
                  /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Extensions_Import"), onClick: () => void importGpk(), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "input",
                    {
                      className: "input",
                      style: { width: 260 },
                      placeholder: "https://…/pack.gpk（目录安装）",
                      value: catalogUrl,
                      onChange: (e) => setCatalogUrl(e.target.value)
                    }
                  ),
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "button",
                    {
                      className: "tool-btn",
                      disabled: !catalogUrl.trim().startsWith("http"),
                      onClick: async () => {
                        setExtError(null);
                        try {
                          const r = await call("extensions.installFromCatalog", { url: catalogUrl.trim() });
                          if (r) await refreshExts(r);
                          setCatalogUrl("");
                        } catch (e) {
                          setExtError(e.message);
                        }
                      },
                      children: t("Extensions_InstallFromUrl")
                    }
                  )
                ] }),
                exts.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: t("Extensions_Empty") }),
                KIND_SECTIONS.map(({ kind, label }) => {
                  const group = exts.filter((p) => primaryKindOf(p) === kind).sort((a, b) => a.name.localeCompare(b.name));
                  if (group.length === 0) return null;
                  return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: 10 }, children: [
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }, children: [
                      label,
                      " ",
                      /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "hint", children: [
                        "（",
                        group.length,
                        "）"
                      ] })
                    ] }),
                    group.map((p) => renderExtCard(p))
                  ] }, kind);
                }),
                (() => {
                  const known = new Set(KIND_SECTIONS.map((x) => x.kind));
                  const others = exts.filter((p) => !known.has(primaryKindOf(p)));
                  if (others.length === 0) return null;
                  return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: 10 }, children: [
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontWeight: 600, fontSize: 12, margin: "4px 0 6px", color: "var(--c-text2)" }, children: [
                      "其他（",
                      others.length,
                      "）"
                    ] }),
                    others.map((p) => renderExtCard(p))
                  ] });
                })()
              ] })
            ] })
          ] }, id);
        case "about":
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: secCls(id), id: `set-sec-${id}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx("h4", { children: t("Settings_AboutSection") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "Gitter" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", children: "v0.1.0 · Electron 全栈（winui3-to-web-migration.md）" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("label", { children: "git" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "hint", style: { fontFamily: "var(--mono)" }, children: gitVersion })
            ] })
          ] }, id);
      }
    };
    const catTitle = (c) => t(CATEGORIES.find((x) => x.id === c).titleKey);
    const matchedSections = [...new Set(matches.map((m) => m.section))];
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "toolbar", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "settings-page-title", children: t("Nav_Settings") }) }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-layout", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "settings-nav", children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              className: "input",
              style: { width: "100%", flex: "none" },
              placeholder: t("Settings_Search"),
              value: query,
              onChange: (e) => setQuery(e.target.value)
            }
          ),
          !q && CATEGORIES.map((c) => /* @__PURE__ */ jsxRuntime.jsxs(
            "button",
            {
              className: "settings-cat" + (cat === c.id ? " active" : ""),
              onClick: () => setCat(c.id),
              title: t(c.titleKey),
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ic", children: /* @__PURE__ */ jsxRuntime.jsx(NavIcon, { glyph: c.glyph, svg: c.svg }) }),
                t(c.titleKey)
              ]
            },
            c.id
          )),
          q && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
            matchedSections.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "hint", style: { padding: "6px 4px" }, children: t("Settings_NoResults") }),
            matchedSections.map((sid) => {
              const sec = SECTIONS.find((x) => x.id === sid);
              return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card", style: { padding: "8px 10px" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("div", { className: "search-result-cat", children: catTitle(sec.cat) }),
                /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 12.5, color: "var(--c-text)", marginBottom: 4 }, children: t(sec.titleKey) }),
                matches.filter((m) => m.section === sid).map((m, i) => /* @__PURE__ */ jsxRuntime.jsx("div", { className: "search-result-item", onClick: () => gotoSection(sid), children: t(m.labelKey) }, i))
              ] }, sid);
            })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "settings-content", children: SECTIONS.filter((x) => x.cat === cat).map((x) => renderSection(x.id)) })
      ] })
    ] });
  }
  window.GITTER_UI.registerPage({ id: "settings" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "settings",
        children: React.createElement(SettingsPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
