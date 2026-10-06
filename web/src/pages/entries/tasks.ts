/**
 * tasks 页入口（ui-full-pluginization-plan.md R2：内置页面包 gitui.page.tasks 的渲染层产物）。
 * 经典 script：GITTER_UI.registerPage 把页面组件挂进宿主容器（React/组件来自
 * window.GITTER_KIT 单实例）；页面代码只经 pageSdk/kit 消费宿主（构建期映射到 external/*）。
 * 身份（标题/图标/权限/顺序）来自包 manifest 元数据，脚本 def 只给 id。
 */
import { TasksPage } from "../TasksPage";
import { PageErrorBoundary, React, ReactDOMClient } from "../../external/kitShim";

window.GITTER_UI!.registerPage({ id: "tasks" }, (container) => {
  // 幂等：热重载会把同一容器再次交给本 mount——先清掉旧 React root，防多实例同容器冲突
  const host = container as HTMLElement & { __gitterRoot?: { unmount(): void } };
  host.__gitterRoot?.unmount();
  const root = ReactDOMClient.createRoot(container);
  root.render(
    React.createElement(PageErrorBoundary, {
      pageKey: "tasks",
      children: React.createElement(TasksPage),
    }),
  );
  host.__gitterRoot = root;
  return () => {
    host.__gitterRoot = undefined;
    root.unmount();
  };
});
