/**
 * Hello 外部页面（ui-pluginization-plan.md U1c 验收模板）：
 * 经典 script（非 module）——loader 注入后使用全局 GITTER_UI 注册页面。
 * 类型提示：TS 项目里 `/// <reference path="../../sdk/gitter-ui.d.ts" />`。
 */
(function () {
  var PAGE_ORDER = 550; // 内置页 10..700；外部页缺省 500（侧栏位置）

  GITTER_UI.registerPage(
    { id: "hello", title: "Hello 页", icon: "\uE8F1", order: PAGE_ORDER },
    function (container, ctx) {
      container.innerHTML =
        '<div style="padding:16px;font-family:inherit;user-select:text">' +
        '<h3 style="margin:0 0 8px">Hello 外部页面</h3>' +
        '<div class="hint" style="margin-bottom:8px">包: ' + ctx.packageId +
        " · 仓库: " + (ctx.repo() ? ctx.repo().name : "未打开") + "</div>" +
        '<div style="margin-bottom:8px">最近提交（ctx.call "log.query"，权限域 git.read）：</div>' +
        '<pre id="hello-out" style="white-space:pre-wrap;margin:0">加载中…</pre>' +
        "</div>";
      var out = container.querySelector("#hello-out");

      var off = ctx.on("sync.progress", function () { /* 演示事件订阅 */ });

      ctx.call("log.query", { limit: 5 }).then(function (r) {
        var lines = (r.commits || []).map(function (c) { return c.shortSha + " " + c.subject; });
        out.textContent = lines.length ? lines.join("\n") : "（空仓库）";
      }).catch(function (e) {
        out.textContent = "查询失败: " + e.message;
      });

      return function () {
        off();
        container.innerHTML = "";
      };
    }
  );
})();
