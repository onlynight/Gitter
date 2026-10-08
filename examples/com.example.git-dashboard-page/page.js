/*
 * Git 仪表盘页 —— 渲染层页面示例（经典 IIFE，非 ES module）。
 *
 * 三条硬约定：
 *  1. React 必须来自 window.GITTER_KIT（宿主单实例）——自带 React 会双实例崩溃；
 *  2. 所有 RPC 走 pageSdk.call（封装 caller 身份）——裸 window.GITTER_UI.call 会权限回退；
 *  3. mount 返回清理函数，卸载时由宿主调用。
 */
(function (react, kit) {
  "use strict";

  var React = kit.React;
  var h = React.createElement;
  var PageErrorBoundary = kit.PageErrorBoundary;

  function U() {
    var g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（页面必须经宿主 pageLoader 装载）");
    return g;
  }

  // caller 身份必须在入口脚本 eval 期捕获——注入完成后 loader 窗口已重置，
  // 挂载时再读会永远回退缺省权限（terminal/extensions.admin/git.write 全被拒）
  var BOOT = (U().getActiveCaller ? U().getActiveCaller() : null) || null;

  var pageSdk = {
    call: function (method, params) {
      var g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
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

  // 响应式状态：宿主活 store 的跨 React 实例安全订阅
  function useAppState() {
    var g = U();
    return React.useSyncExternalStore(g.subscribeState, g.getState);
  }

  // 把 RPC 结果做成可订阅状态
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
        h("h1", null, "Git 仪表盘"),
        repo
          ? h("div", { className: "gd-repo" }, repo.name)
          : h("div", { className: "gd-empty" }, "打开一个仓库以查看")
      ),

      h("div", { className: "gd-stats" },
        h("div", { className: "gd-stat" },
          h("b", null, String(Array.isArray(log.data) ? log.data.length : 0)),
          h("span", null, "最近提交")
        ),
        h("div", { className: "gd-stat" },
          h("b", null, log.loading ? "…" : String(repo ? 1 : 0)),
          h("span", null, "仓库就绪")
        )
      ),

      log.error
        ? h("div", { className: "gd-err" }, "数据加载失败：" + log.error)
        : log.loading
          ? h("div", { className: "gd-empty" }, "加载中…")
          : h("ol", { className: "gd-log" },
              (Array.isArray(log.data) ? log.data : []).map(function (c, i) {
                return h("li", { key: c.sha || i },
                  h("code", { className: "gd-sha" }, String(c.sha || "").slice(0, 7)),
                  h("span", { className: "gd-subj" }, c.subject || ""),
                  c.author ? h("span", { className: "gd-auth" }, c.author) : null
                );
              }),
              (!log.loading && (Array.isArray(log.data) ? log.data.length : 0) === 0)
                ? h("li", { className: "gd-empty" }, "没有提交记录")
                : null
            ),

      h("div", { className: "gd-foot" },
        h("div", { className: "gd-ctx" },
          ctx && ctx.selectedFile
            ? "选中：" + ctx.selectedFile.path + (ctx.selectedFile.staged ? "（已暂存）" : "")
            : "未选中文件"
        ),
        h("div", { className: "gd-actions" },
          h("button", {
            className: "gd-btn",
            disabled: !repo,
            onClick: function () { pageSdk.refresh(); }
          }, "刷新"),
          h("button", {
            className: "gd-btn",
            disabled: !repo,
            // git.write 域：changes.stage 需权限声明含 git.write
            onClick: function () {
              pageSdk.call("changes.stage", {})
                .then(function () { pageSdk.toast("已暂存全部改动"); })
                .catch(function (e) { pageSdk.toast("暂存失败", String(e && e.message || e)); });
            }
          }, "暂存全部"),
          h("button", {
            className: "gd-btn",
            disabled: !repo,
            onClick: function () { pageSdk.navigate("changes"); }
          }, "去改动页 →")
        )
      )
    );
  }

  // 注册页面。id 会被宿主展开为 ext.git-dashboard-page.dashboard
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
