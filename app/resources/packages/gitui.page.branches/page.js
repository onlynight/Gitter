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
  const Banner = K().Banner;
  const Modal = K().Modal;
  const useContextMenu = K().useContextMenu;
  const SyncBar = K().SyncBar;
  const useSyncProgress = K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  const Select = K().Select;
  K().ScrollArea;
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
    const [errorDetail, setErrorDetail] = react.useState(null);
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
        setErrorDetail(null);
      } catch (e) {
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      }
    }, [repo]);
    react.useEffect(() => {
      void reload();
    }, [repo, app.refreshTick]);
    react.useEffect(() => {
      var _a3;
      if (((_a3 = app.routedCommand) == null ? void 0 : _a3.id) === "branches.create") {
        setDialog({ kind: "create", name: "", startPoint: "HEAD", checkout: true });
      }
    }, [app.routedCommand]);
    const startPointOptions = () => {
      const cur = (state == null ? void 0 : state.current) ?? null;
      return [
        { value: "HEAD", label: t("Branches_StartHead", cur ?? "HEAD") },
        ...((state == null ? void 0 : state.local) ?? []).filter((b) => b.name !== cur).map((b) => ({ value: "refs/heads/" + b.name, label: b.name })),
        ...((state == null ? void 0 : state.remote) ?? []).map((b) => ({ value: "refs/remotes/" + b.name, label: b.name })),
        ...((state == null ? void 0 : state.tags) ?? []).map((tg) => ({ value: "refs/tags/" + tg.name, label: `${tg.name} (${t("Branches_TagSuffix")})` }))
      ];
    };
    const mergeSourceOptions = () => [
      ...((state == null ? void 0 : state.local) ?? []).map((b) => ({ value: "refs/heads/" + b.name, label: b.name })),
      ...((state == null ? void 0 : state.remote) ?? []).map((b) => ({ value: "refs/remotes/" + b.name, label: b.name }))
    ];
    const mergeTargetOptions = () => ((state == null ? void 0 : state.local) ?? []).map((b) => ({ value: b.name, label: b.name }));
    const tagMenu = (name) => [
      { label: t("Branches_CreateBranchFromTag"), action: () => setDialog({ kind: "create", name: "", startPoint: "refs/tags/" + name, checkout: true }) },
      { sep: true, label: "", action: () => {
      } },
      { label: t("Branches_DeleteTag"), action: () => setDialog({ kind: "deleteTag", name }) }
    ];
    const run = async (fn) => {
      setBusy(true);
      try {
        setTransient(await fn());
        await reload();
      } catch (e) {
        setError(e.message);
        setErrorDetail(e.detail ?? null);
      } finally {
        clearSyncProgress();
        setBusy(false);
      }
    };
    const branchMenu = (name, isRemote) => {
      if (isRemote) {
        return [
          { label: t("Branches_CheckoutLocal"), action: () => void run(async () => {
            const local = await call("branches.checkoutRemote", { name });
            return t("Branches_CheckedOut", local);
          }) },
          { label: t("Branches_FastForward"), action: () => void run(async () => {
            await call("branches.ff", { name });
            return t("Branches_FastForwarded");
          }) },
          { sep: true, label: "", action: () => {
          } },
          { label: t("Branches_DeleteRemote"), action: () => setDialog({ kind: "deleteRemote", name }) }
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
        { label: t("Branches_Merge"), action: () => {
          var _a3, _b2;
          return setDialog({ kind: "merge", source: "refs/heads/" + name, target: (state == null ? void 0 : state.current) ?? ((_b2 = (_a3 = state == null ? void 0 : state.local) == null ? void 0 : _a3[0]) == null ? void 0 : _b2.name) ?? "", noFf: false, message: "" });
        } },
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
            setErrorDetail(e.detail ?? null);
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
    const groupHeader = (title, count) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "group-header solid", children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { children: title }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontWeight: 400 }, children: count })
    ] });
    const renderBranchRows = (remote) => (remote ? (state == null ? void 0 : state.remote) ?? [] : (state == null ? void 0 : state.local) ?? []).map((b) => /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: "list-row" + ((selected == null ? void 0 : selected.kind) === (remote ? "remote" : "local") && (selected == null ? void 0 : selected.name) === b.name ? " selected" : ""),
        onClick: () => setSelected({ kind: remote ? "remote" : "local", name: b.name }),
        onContextMenu: (e) => {
          setSelected({ kind: remote ? "remote" : "local", name: b.name });
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
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { color: "var(--c-text3)", fontSize: 11, maxWidth: 180 }, children: b.subject })
        ]
      },
      b.name
    ));
    const renderTagRows = () => ((state == null ? void 0 : state.tags) ?? []).map((tg) => /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        className: "list-row" + ((selected == null ? void 0 : selected.kind) === "tag" && (selected == null ? void 0 : selected.name) === tg.name ? " selected" : ""),
        onClick: () => setSelected({ kind: "tag", name: tg.name }),
        onContextMenu: (e) => {
          setSelected({ kind: "tag", name: tg.name });
          showMenu(e, tagMenu(tg.name));
        },
        children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: tg.shortSha }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { flex: 1 }, children: tg.name }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { color: "var(--c-text3)", fontSize: 11, maxWidth: 140 }, children: tg.subject })
        ]
      },
      tg.name
    ));
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_Create"), onClick: () => setDialog({ kind: "create", name: "", startPoint: "HEAD", checkout: true }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_Pull"), disabled: busy, onClick: () => void run(async () => {
          await call("branches.pull", { rebase: false });
          return t("Branches_Pulled");
        }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_PullRebase"), disabled: busy, onClick: () => void run(async () => {
          await call("branches.pull", { rebase: true });
          return t("Branches_PulledRebase");
        }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn icon", "data-tip": t("Branches_Push"), disabled: busy, onClick: () => void run(async () => {
          await call("branches.push", {});
          return t("Branches_Pushed");
        }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "glyph", children: "" }) })
      ] }),
      error && /* @__PURE__ */ jsxRuntime.jsx(
        Banner,
        {
          text: error,
          detail: errorDetail ?? void 0,
          error: true,
          onCopyDetail: errorDetail ? () => navigator.clipboard.writeText(errorDetail) : void 0,
          onClose: () => {
            setError(null);
            setErrorDetail(null);
          },
          actions: isNoUpstreamError(error) ? [{ label: t("Common_GoToSettings"), onClick: () => openSettings("git") }] : void 0
        }
      ),
      transient && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "banner", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "banner-text", children: transient }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setTransient(null), children: "✕" })
      ] }),
      busy && /* @__PURE__ */ jsxRuntime.jsx(SyncBar, { progress: syncProgress }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", gap: 12, margin: "10px 12px 12px" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "pane-card", style: { flex: 1.7, display: "flex", flexDirection: "column", overflow: "hidden" }, children: state ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" }, children: [
          groupHeader(t("Branches_LocalGroup"), state.local.length),
          renderBranchRows(false),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { height: 8 } }),
          groupHeader(t("Branches_RemoteGroup"), state.remote.length),
          renderBranchRows(true)
        ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", style: { flex: 1 }, children: t("Common_Loading") }) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "pane-card", style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }, children: state ? /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" }, children: [
          groupHeader(t("Branches_TagGroup"), state.tags.length),
          state.tags.length > 0 ? renderTagRows() : /* @__PURE__ */ jsxRuntime.jsx("div", { style: { padding: "14px 12px", color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_NoTags") })
        ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", style: { flex: 1 }, children: t("Common_Loading") }) })
      ] }),
      (dialog == null ? void 0 : dialog.kind) === "create" && /* @__PURE__ */ jsxRuntime.jsxs(
        Modal,
        {
          title: t("Branches_CreateTitle"),
          confirmText: t("Common_Create"),
          confirmDisabled: !dialog.name.trim(),
          onClose: () => setDialog(null),
          onConfirm: () => {
            const name = dialog.name.trim();
            const from = dialog.startPoint === "HEAD" ? null : dialog.startPoint;
            void run(async () => {
              await call("branches.create", { name, fromSha: from, checkout: dialog.checkout });
              return t("Branches_Created", name);
            });
            setDialog(null);
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                autoFocus: true,
                className: "input",
                style: { width: "100%" },
                placeholder: t("Branches_NamePlaceholder"),
                value: dialog.name,
                onChange: (e) => setDialog({ ...dialog, name: e.target.value })
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_StartPoint") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "full",
                  style: { width: "100%" },
                  value: dialog.startPoint,
                  options: startPointOptions(),
                  onChange: (v) => setDialog({ ...dialog, startPoint: v })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: dialog.checkout, onChange: (e) => setDialog({ ...dialog, checkout: e.target.checked }) }),
                t("Branches_CheckoutAfter")
              ] })
            ] })
          ]
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
      (dialog == null ? void 0 : dialog.kind) === "deleteRemote" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_DeleteRemoteTitle", dialog.name),
          confirmText: t("Common_Delete"),
          danger: true,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("branches.deleteRemote", { name: dialog.name });
              return t("Branches_DeletedRemote", dialog.name);
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Branches_DeleteRemoteWarning", dialog.name) })
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "deleteTag" && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Branches_DeleteTagTitle", dialog.name),
          confirmText: t("Common_Delete"),
          danger: true,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("tags.delete", { name: dialog.name });
              return t("Branches_DeletedTag", dialog.name);
            });
            setDialog(null);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Branches_DeleteTagSafe", dialog.name) })
        }
      ),
      (dialog == null ? void 0 : dialog.kind) === "merge" && /* @__PURE__ */ jsxRuntime.jsxs(
        Modal,
        {
          title: t("Branches_MergeTitlePlain"),
          confirmText: t("Common_Merge"),
          confirmDisabled: !dialog.source || !dialog.target,
          onClose: () => setDialog(null),
          onConfirm: () => {
            void run(async () => {
              await call("branches.merge", { name: dialog.source, target: dialog.target, noFf: dialog.noFf, message: dialog.message || null });
              return t("Branches_MergedInto", dialog.source.replace(/^refs\/(heads|remotes)\//, ""), dialog.target);
            });
            setDialog(null);
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_MergeSource") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "full",
                  style: { width: "100%" },
                  value: dialog.source,
                  options: mergeSourceOptions(),
                  onChange: (v) => setDialog({ ...dialog, source: v })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_MergeTarget") }),
              /* @__PURE__ */ jsxRuntime.jsx(
                Select,
                {
                  className: "full",
                  style: { width: "100%" },
                  value: dialog.target,
                  options: mergeTargetOptions(),
                  onChange: (v) => setDialog({ ...dialog, target: v })
                }
              ),
              dialog.target !== (state == null ? void 0 : state.current) && /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontSize: 12 }, children: t("Branches_MergeTargetHint") }),
              /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: dialog.noFf, onChange: (e) => setDialog({ ...dialog, noFf: e.target.checked }) }),
                t("Branches_NoFastForward")
              ] })
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
