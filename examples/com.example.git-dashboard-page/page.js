/*
 * Git Dashboard Page —— renderer page example (classic IIFE, not an ES module).
 *
 * Three hard rules:
 *  1. React must come from window.GITTER_KIT (single host instance) — bundling your own crashes with a double React;
 *  2. All RPC goes through pageSdk.call (attaches caller identity) — bare window.GITTER_UI.call falls back to default permissions;
 *  3. mount returns a cleanup function, which the host calls on unmount.
 */
(function (react, kit) {
  "use strict";

  var React = kit.React;
  var h = React.createElement;
  var PageErrorBoundary = kit.PageErrorBoundary;

  function U() {
    var g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI not injected (pages must be loaded through the host pageLoader)");
    return g;
  }

  // caller identity must be captured during entry-script eval — once injection finishes the
  // loader window is reset, and reading it at mount time would always fall back to default
  // permissions (terminal / extensions.admin / git.write all rejected)
  var BOOT = (U().getActiveCaller ? U().getActiveCaller() : null) || null;

  var pageSdk = {
    call: function (method, params) {
      var g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    /** UI strings (%key% resolved through the package i18n/<lang>.json, lang -> en -> fallback) */
    t: function (key) {
      var rest = [];
      for (var i = 1; i < arguments.length; i++) rest.push(arguments[i]);
      return U().t.apply(U(), [key].concat(rest));
    },
    on: function (method, cb) { return U().on(method, cb); },
    repo: function () { return U().repo(); },
    context: function () { return U().context(); },
    navigate: function (p) { return U().navigate(p); },
    refresh: function () { return U().refresh(); },
    toast: function (title, body) { return U().toast(title, body); },
    getState: function () { return U().getState(); },
    subscribeState: function (cb) { return U().subscribeState(cb); }
  };

  // Reactive state: cross-React-instance-safe subscription to the host live store
  function useAppState() {
    var g = U();
    return React.useSyncExternalStore(g.subscribeState, g.getState);
  }

  // Make an RPC result subscribable state
  function useRpc(method, params) {
    var app = useAppState();
    var [state, setState] = React.useState({ data: null, loading: false, error: null });
    var dep = params ? JSON.stringify(params) : "";
    var reloadTick = app.refreshTick || 0;

    React.useEffect(function () {
      if (!app.repo) { setState({ data: null, loading: false, error: null }); return; }
      var alive = true;
      setState(function (s) { return { data: s.data, loading: true, error: null }; });
      pageSdk.call(method, params)
        .then(function (data) { if (alive) setState({ data: data, loading: false, error: null }); })
        .catch(function (e) { if (alive) setState({ data: null, loading: false, error: String(e && e.message || e) }); });
      return function () { alive = false; };
    }, [method, dep, !!app.repo, reloadTick]);

    return state;
  }

  function DashboardPage() {
    var app = useAppState();
    var repo = app.repo;
    var log = useRpc("log.query", { limit: 8 });
    var ctx = pageSdk.context();

    return h("div", { className: "gd" },
      h("header", { className: "gd-head" },
        h("h1", null, pageSdk.t("dash.title")),
        repo
          ? h("div", { className: "gd-repo" }, repo.name)
          : h("div", { className: "gd-empty" }, pageSdk.t("dash.empty"))
      ),

      h("div", { className: "gd-stats" },
        h("div", { className: "gd-stat" },
          h("b", null, String(Array.isArray(log.data) ? log.data.length : 0)),
          h("span", null, pageSdk.t("dash.recent"))
        ),
        h("div", { className: "gd-stat" },
          h("b", null, log.loading ? "…" : String(repo ? 1 : 0)),
          h("span", null, pageSdk.t("dash.repoReady"))
        )
      ),

      log.error
        ? h("div", { className: "gd-err" }, pageSdk.t("dash.loadFailed", log.error))
        : log.loading
          ? h("div", { className: "gd-empty" }, pageSdk.t("dash.loading"))
          : h("ol", { className: "gd-log" },
              (Array.isArray(log.data) ? log.data : []).map(function (c, i) {
                return h("li", { key: c.sha || i },
                  h("code", { className: "gd-sha" }, String(c.sha || "").slice(0, 7)),
                  h("span", { className: "gd-subj" }, c.subject || ""),
                  c.author ? h("span", { className: "gd-auth" }, c.author) : null
                );
              }),
              (!log.loading && (Array.isArray(log.data) ? log.data.length : 0) === 0)
                ? h("li", { className: "gd-empty" }, pageSdk.t("dash.noCommits"))
                : null
            ),

      h("div", { className: "gd-foot" },
        h("div", { className: "gd-ctx" },
          ctx && ctx.selectedFile
            ? pageSdk.t("dash.selected", ctx.selectedFile.path + (ctx.selectedFile.staged ? pageSdk.t("dash.staged") : ""))
            : pageSdk.t("dash.noSelection")
        ),
        h("div", { className: "gd-actions" },
          h("button", {
            className: "gd-btn",
            disabled: !repo,
            onClick: function () { pageSdk.refresh(); }
          }, pageSdk.t("dash.refresh")),
          h("button", {
            className: "gd-btn",
            disabled: !repo,
            // git.write scope: changes.stage requires git.write in the manifest permissions
            onClick: function () {
              pageSdk.call("changes.stage", {})
                .then(function () { pageSdk.toast(pageSdk.t("dash.stagedAll")); })
                .catch(function (e) { pageSdk.toast(pageSdk.t("dash.stageFailed"), String(e && e.message || e)); });
            }
          }, pageSdk.t("dash.stageAll")),
          h("button", {
            className: "gd-btn",
            disabled: !repo,
            onClick: function () { pageSdk.navigate("changes"); }
          }, pageSdk.t("dash.goChanges"))
        )
      )
    );
  }

  // Register the page. The host expands the id to ext.git-dashboard-page.dashboard
  window.GITTER_UI.registerPage({ id: "dashboard" }, function (container) {
    var prev = container.__gitterRoot;
    if (prev) prev.unmount();
    var root = kit.ReactDOMClient.createRoot(container);
    root.render(h(PageErrorBoundary, {
      pageKey: "dashboard",
      children: h(DashboardPage)
    }));
    container.__gitterRoot = root;
    return function () {
      container.__gitterRoot = null;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime && window.GITTER_KIT.React, window.GITTER_KIT);
