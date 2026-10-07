import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 页面级错误边界（ui-full-pluginization-plan.md R0-4/D4 + R2）：
 * 页面（外部页在自身入口用同组件包装 React 树——外部 root 与宿主边界隔离，
 * 崩溃不会传播到壳）渲染崩溃只塌本页——壳不倒；错误卡可"重载页面"重挂载。
 * 不做静默回退：失败原因如实呈现（诚实插件失败 ≠ 停用）。
 */
export class PageErrorBoundary extends Component<{ pageKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[page:${this.props.pageKey}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="banner" style={{ margin: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>页面崩溃：{this.props.pageKey}</div>
            <div style={{ fontSize: 12, color: "var(--c-text2)", marginTop: 2, userSelect: "text", wordBreak: "break-all" }}>
              {String(this.state.error?.message ?? this.state.error)}
            </div>
          </div>
          <button className="tool-btn" onClick={() => this.setState({ error: null })}>重载页面</button>
        </div>
      );
    }
    return this.props.children;
  }
}
