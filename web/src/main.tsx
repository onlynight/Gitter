import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./builtinPages"; // 内置页面注册表自举（必须先于 App 渲染）
import "./kitGlobal"; // window.GITTER_KIT 组装（必须先于任何外部页脚本装载）
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { resolveUiPage } from "./uiRegistry";

// F5 事件桥（命令面板/键盘触发统一走 CustomEvent）
window.addEventListener("gitter:refresh", () => {
  import("./state/store").then((m) => m.refreshCurrent());
});

// boot-check 内省钩子（scripts/boot-check.mjs 断言槽位解析；无安全面——in-process 只读）
(window as unknown as { __gitterDebugResolve: (slot: string) => unknown }).__gitterDebugResolve = (slot) => {
  const d = resolveUiPage(slot);
  return d ? { source: d.source ?? null, id: d.id, isBuiltInPackage: d.isBuiltInPackage ?? false, lazy: d.lazy ?? false } : null;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
