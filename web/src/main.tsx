import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

// F5 事件桥（命令面板/键盘触发统一走 CustomEvent）
window.addEventListener("gitter:refresh", () => {
  import("./state/store").then((m) => m.refreshCurrent());
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
