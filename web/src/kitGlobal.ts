import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as Kit from "./kit";

/**
 * window.GITTER_KIT 组装（ui-full-pluginization-plan.md R2 架构裁决）：
 * 不再单独构建 kit.iife 制品——宿主 bundle 即 KIT 制品。启动时把宿主的
 * React 单实例（活 store 的内核组件随宿主模块解析）挂到 window.GITTER_KIT，
 * 外部页（经典脚本）与页面构建产物（react 系声明为 GITTER_KIT.* globals external）
 * 三方共享同一 React 与同一内核组件实例——杜绝"组件包内嵌死 store 副本"问题。
 */
window.GITTER_KIT = {
  ...Kit,
  React,
  ReactDOM,
  ReactDOMClient,
  ReactJSXRuntime,
};
