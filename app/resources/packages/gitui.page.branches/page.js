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
    openSettings: (section) => U().openSettings(section)
  };
  function useAppState() {
    const g = U();
    return react.useSyncExternalStore(g.subscribeState, g.getState);
  }
  async function seamMenuItems(location, filePath) {
    var _a2;
    try {
      const g = window.GITTER_UI;
      if (!g) return [];
      const items = await g.call("menus.list", { location, lang: ((_a2 = g.getState().i18n) == null ? void 0 : _a2.lang) ?? "en", fileSelected: !!filePath });
      return items.map((m) => ({ label: m.title, action: () => void g.runCommand({ id: m.command, title: m.title }, { filePath }) }));
    } catch {
      return [];
    }
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
  const Modal = K().Modal;
  const useContextMenu = K().useContextMenu;
  const SyncBar = K().SyncBar;
  const useSyncProgress = K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  const { call, t, openSettings } = pageSdk;
  const useApp = useAppState;
  function isNoUpstreamError(msg) {
    if (!msg) return false;
    return /push\.autoSetupRemote|set-upstream|no upstream|上游/i.test(msg);
  }
  function BranchesPage() {
    var _a2;
    const app = useApp();
    const repo = app.repo;
    const [state, setState] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [transient, setTransient] = react.useState(null);
    const [busy, setBusy] = react.useState(false);
    const [selected, setSelected] = react.useState(null);
    const [dialog, setDialog] = react.useState(null);
    const { showMenu, menuElement } = useContextMenu();
    const [syncProgress, clearSyncProgress] = useSyncProgress();
    const reload = react.useCallback(async () => {
      if (!repo) return;
      try {
        setState(await call("branches.state"));
        setError(null);
      } catch (e) {
        setError(e.message);
      }
    }, [repo]);
    react.useEffect(() => {
      void reload();
    }, [repo, app.refreshTick]);
    const run = async (fn) => {
      setBusy(true);
      try {
        setTransient(await fn());
        await reload();
      } catch (e) {
        setError(e.message);
      } finally {
        clearSyncProgress();
        setBusy(false);
      }
    };
    const branchMenu = (name, isRemote) => {
      if (isRemote) {
        return [
          { label: t("Branches_FastForward"), action: () => void run(async () => {
            await call("branches.ff", { name });
            return t("Branches_FastForwarded");
          }) }
        ];
      }
      const isCurrent = (state == null ? void 0 : state.current) === name;
      return [
        ...isCurrent ? [] : [{ label: t("Branches_Checkout"), action: () => void run(async () => {
          await call("branches.checkout", { name });
          return t("Branches_CheckedOut", name);
        }) }],
        { label: t("Branches_Rename"), action: () => setDialog({ kind: "rename", oldName: name, newName: name }) },
        { sep: true, label: "", action: () => {
        } },
        { label: t("Branches_Merge"), action: () => setDialog({ kind: "merge", name, noFf: false, message: "" }) },
        { label: t("Branches_MergeNoFf"), action: () => setDialog({ kind: "merge", name, noFf: true, message: "" }) },
        { label: t("Branches_Rebase"), action: () => void run(async () => {
          await call("branches.rebase", { name });
          return t("Branches_Rebased", name);
        }) },
        { sep: true, label: "", action: () => {
        } },
        { label: t("Branches_Delete"), action: () => void (async () => {
          try {
            const preview = await call("branches.deletePreview", { name });
            setDialog({ kind: "deletePreview", name, preview });
          } catch (e) {
            setError(e.message);
          }
        })() }
      ];
    };
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "⑂" }),
        t("Common_NoProjectSelected")
      ] });
    }
    const renderGroup = (title, remote) => {
      const list = remote ? (state == null ? void 0 : state.remote) ?? [] : (state == null ? void 0 : state.local) ?? [];
      if (list.length === 0) return null;
      return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "group-header", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { children: title }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontWeight: 400 }, children: list.length })
        ] }),
        list.map((b) => /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            className: "list-row" + ((selected == null ? void 0 : selected.name) === b.name ? " selected" : ""),
            onClick: () => setSelected({ name: b.name, isRemote: remote }),
            onContextMenu: (e) => {
              setSelected({ name: b.name, isRemote: remote });
              void (async () => {
                showMenu(e, [...branchMenu(b.name, remote), ...await seamMenuItems("branchRow")]);
              })();
            },
            children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: b.shortSha }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "trim", style: { flex: 1 }, children: [
                b.name,
                (state == null ? void 0 : state.current) === b.name && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "badge", style: { marginLeft: 6 }, children: "HEAD" })
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { color: "var(--c-text3)", fontSize: 11, maxWidth: 260 }, children: b.subject })
            ]
          },
          b.name
        ))
      ] });
    };
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", onClick: () => setDialog({ kind: "create", name: "" }), children: t("Branches_Create") }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: busy, onClick: () => void run(async () => {
          await call("branches.pull", { rebase: false });
          return t("Branches_Pulled");
        }), children: t("Branches_Pull") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: busy, onClick: () => void run(async () => {
          await call("branches.pull", { rebase: true });
          return t("Branches_PulledRebase");
        }), children: t("Branches_PullRebase") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: busy, onClick: () => void run(async () => {
          await call("branches.push", {});
          return t("Branches_Pushed");
        }), children: t("Branches_Push") })
      ] }),
      error && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner error", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: error }),
        isNoUpstreamError(error) && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => openSettings("git"), children: t("Common_GoToSettings") }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setError(null), children: "✕" })
      ] }),
      transient && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: transient }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setTransient(null), children: "✕" })
      ] }),
      busy && /* @__PURE__ */ jsxRuntime.jsx(SyncBar, { progress: syncProgress }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "split-pane", style: { flex: 1 }, children: state ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        renderGroup(t("Branches_LocalGroup"), false),
        renderGroup(t("Branches_RemoteGroup"), true)
      ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", children: t("Common_Loading") }) }),
      (dialog == null ? void 0 : dialog.kind) === "create" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_CreateTitle"),
          confirmText: t("Common_Create"),
          confirmDisabled: !dialog.name.trim(),
          onClose: () => setDialog(null),
          onConfirm: () => {
            const name = dialog.name.trim();
            void run(async () => {
              await call("branches.create", { name });
              return t("Branches_Created", name);
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              autoFocus: true,
              className: "input",
              style: { width: "100%" },
              placeholder: t("Branches_NamePlaceholder"),
              value: dialog.name,
              onChange: (e) => setDialog({ ...dialog, name: e.target.value })
            }
          )
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "rename" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_RenameTitle"),
          confirmText: t("Common_Rename"),
          confirmDisabled: !dialog.newName.trim() || dialog.newName === dialog.oldName,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("branches.rename", { oldName: dialog.oldName, newName: dialog.newName.trim() });
              return t("Branches_Renamed");
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              autoFocus: true,
              className: "input",
              style: { width: "100%" },
              value: dialog.newName,
              onChange: (e) => setDialog({ ...dialog, newName: e.target.value })
            }
          )
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "deletePreview" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_DeleteTitle", dialog.name),
          confirmText: t("Common_Delete"),
          danger: true,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              var _a3;
              await call("branches.delete", { name: dialog.name, force: (_a3 = dialog.preview) == null ? void 0 : _a3.forceRequired });
              return t("Branches_Deleted", dialog.name);
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: ((_a2 = dialog.preview) == null ? void 0 : _a2.forceRequired) ? t("Branches_DeleteLoseWarning", dialog.preview.lostCount) + " " + dialog.preview.lostSamples.map((c) => c.shortSha).join(", ") : t("Branches_DeleteSafe", dialog.name) })
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "merge" && /* @__PURE__ */ jsxRuntime.jsxs(
        Modal,
        {
          title: t("Branches_MergeTitle", dialog.name),
          confirmText: t("Common_Merge"),
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("branches.merge", { name: dialog.name, noFf: dialog.noFf, message: dialog.message || null });
              return t("Branches_Merged", dialog.name);
            });
            setDialog(null);
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: dialog.noFf, onChange: (e) => setDialog({ ...dialog, noFf: e.target.checked }) }),
              t("Branches_NoFastForward")
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                className: "input",
                style: { width: "100%" },
                placeholder: t("Branches_MergeMessagePlaceholder"),
                value: dialog.message,
                onChange: (e) => setDialog({ ...dialog, message: e.target.value })
              }
            )
          ]
        }
      ),
      menuElement
    ] });
  }
  window.GITTER_UI.registerPage({ id: "branches" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "branches",
        children: React.createElement(BranchesPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
