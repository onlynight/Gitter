/**
 * changes 页入口（ui-full-pluginization-plan.md R2：内置页面包 gitui.page.changes 的渲染层产物）。
 * 经典 script：GITTER_UI.registerPage 把页面组件挂进宿主容器（React/组件来自
 * window.GITTER_KIT 单实例）；页面代码只经 pageSdk/kit 消费宿主（构建期映射到 external/*）。
 * 身份（标题/图标/权限/顺序）来自包 manifest 元数据，脚本 def 只给 id。
 */
import { ChangesPage } from "../ChangesPage";
import { PageErrorBoundary, React, ReactDOMClient } from "../../external/kitShim";

window.GITTER_UI!.registerPage({ id: "changes" }, (container) => {
  const root = ReactDOMClient.createRoot(container);
  root.render(
    React.createElement(PageErrorBoundary, {
      pageKey: "changes",
      children: React.createElement(ChangesPage),
    }),
  );
  return () => root.unmount();
});
