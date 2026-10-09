/**
 * files 页入口（editor-design.md §4.1）：
 * 经典 script：GITTER_UI.registerPage 把页面组件挂进宿主容器。
 * 身份（标题/图标/权限/顺序）来自包 manifest 元数据，脚本 def 只给 id。
 */
import { FilesPage } from "../FilesPage";
import { PageErrorBoundary, React, ReactDOMClient } from "../../external/kitShim";

window.GITTER_UI!.registerPage({ id: "files" }, (container) => {
  // 幂等：热重载会把同一容器再次交给本 mount——先清掉旧 React root，防多实例同容器冲突
  const host = container as HTMLElement & { __gitterRoot?: { unmount(): void } };
  host.__gitterRoot?.unmount();
  const root = ReactDOMClient.createRoot(container);
  root.render(
    React.createElement(PageErrorBoundary, {
      pageKey: "files",
      children: React.createElement(FilesPage),
    }),
  );
  host.__gitterRoot = root;
  return () => {
    host.__gitterRoot = undefined;
    root.unmount();
  };
});
