import { useEffect, useRef, useState } from "react";
import { call, onEvent } from "./bridge/client";
import type { CommandDTO } from "./bridge/types";
import { runCommand } from "./commands";
import { CommandPalette } from "./components/CommandPalette";
import { Modal, PageErrorBoundary } from "./kit";
import { Sidebar, StatusBar, TitleBar } from "./components/Shell";
import { appendAgentStream, applyDiffModeToDom, applyThemeToDom, getState, navigate, notifyRepoChanged, pushToast, reapplyLanguage, reapplyTheme, refreshCurrent, setState, t, useApp } from "./state/store";
import { onUiPagesChanged, resolveUiPage, uiPages, type UIPageDef } from "./uiRegistry";
import { installUiApi } from "./sdk";
import { ensureExternalPageLoaded, loadExternalPages, reloadExternalPages } from "./pageLoader";

/** 全局快捷键（keybindings 接缝自举：Ctrl+1..7 / F5 / Ctrl+Shift+N 等由 commands.list 的
 * keyHint 驱动分发；面板开关与 Ctrl+Tab 循环不是命令，保留硬编码。Ctrl+Enter 由提交框
 * 输入上下文处理，分发器跳过）。 */
/** 外部页宿主组件：容器 div 交给插件 mount(ctx)，卸载时执行清理
 * （R0/A2 修复：__gitterCleanup 只写不读的断链——清理函数经 effect return 真正调用）。 */
function ExternalPageHost({ def }: { def: UIPageDef }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !def.mount) return;
    const cleanup = def.mount(el, { repo: getState().repo, packageId: def.packageId ?? "?" });
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, [def]);
  // 容器复用 .page 布局语义：页面根（toolbar/内容区 fragment）与内置时期同构
  return <div ref={ref} className="page" />;
}

/** 单槽位内容（R0-2 槽位-提供者解析）：用户包 > 内置包；惰性页面在此触发首次装载
 * （loader 注入脚本 → registerPage → 注册表 notify 重渲染）。 */
function PageContent({ pageId }: { pageId: string }) {
  const def = resolveUiPage(pageId);
  const lazyPending = !!(def?.lazy && !def.mount);
  // ensure 失败（热重载竞态下 metas 暂空等场景）→ 短间隔重试直至 mount 出现或达到上限
  const [lazyAttempts, setLazyAttempts] = useState(0);
  useEffect(() => {
    setLazyAttempts(0);
  }, [pageId]);
  useEffect(() => {
    if (!lazyPending) return;
    let cancelled = false;
    const attempt = (n: number) => {
      if (cancelled) return;
      void ensureExternalPageLoaded(pageId).then((ok) => {
        if (ok || cancelled) return;
        // 未成功：注册表没有新增 mount 时退避重试（成功时注册表 notify 会重渲染并清 pending）
        setTimeout(() => {
          if (!cancelled && n < 5) {
            setLazyAttempts((x) => x + 1);
            attempt(n + 1);
          }
        }, 400 * (n + 1));
      });
    };
    attempt(lazyAttempts);
    return () => { cancelled = true; };
  }, [lazyPending, pageId, lazyAttempts]);

  if (def?.mount) {
    return <PageErrorBoundary pageKey={pageId}><ExternalPageHost def={def} /></PageErrorBoundary>;
  }
  if (lazyPending) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text3)" }}>…</div>;
  }
  // 提供者存在但装载终态失败（markLoadFailed）或槽位彻底无提供者：如实呈现，不静默
  return (
    <div className="empty-state" style={{ flex: 1 }}>
      <div className="big">⊘</div>
      <div>页面不可用：{pageId}</div>
      <div style={{ color: "var(--c-text3)", fontSize: 12, marginTop: 4 }}>页面包装载失败或已被移除——可在 设置 → 扩展 检查</div>
    </div>
  );
}

/** 页面出口（keep-alive，R2.1）：访问过的槽位保持挂载，display 切换可见性——
 * 切页不卸载不重载：终端回滚、列表勾选/折叠、滚动位置、表单状态全部保留。
 * 真正卸载只发生在：包热刷新（def 变化重挂）、页面被卸载/停用（wrapper 移除）。 */
function PageOutlet({ pageId }: { pageId: string }) {
  const [, tick] = useState(0);
  useEffect(() => onUiPagesChanged(() => tick((x) => x + 1)), []);

  // 未知槽位（页面被卸载/停用后残留的 page 值）→ 回落注册表首个槽位
  const first = uiPages()[0];
  const firstSlot = first ? first.slot ?? first.id : null;
  const effective = resolveUiPage(pageId) ? pageId : firstSlot ?? pageId;

  const [visited, setVisited] = useState<string[]>(() => [effective]);
  useEffect(() => {
    setVisited((prev) => (prev.includes(effective) ? prev : [...prev, effective]));
  }, [effective]);

  return (
    <>
      {visited.map((slot) => (
        <div key={slot} className="page page-slot" style={slot === effective ? undefined : { display: "none" }}>
          <PageContent pageId={slot} />
        </div>
      ))}
    </>
  );
}

function useShortcuts(openPalette: (prefill?: string) => void) {
  const repoPath = useApp().repo?.workDir ?? null;
  useEffect(() => {
    let cmds: CommandDTO[] = [];
    const load = () => void call<CommandDTO[]>("commands.list", { lang: getState().i18n?.lang ?? "en" }).then((r) => (cmds = r));
    void load();
    const off = onEvent("repo.refresh", () => refreshCurrent());

    const match = (hint: string, e: KeyboardEvent): boolean => {
      const parts = hint.split("+").map((p) => p.trim());
      const key = parts[parts.length - 1];
      const needCtrl = parts.some((p) => p.toLowerCase() === "ctrl");
      const needShift = parts.some((p) => p.toLowerCase() === "shift");
      const needAlt = parts.some((p) => p.toLowerCase() === "alt");
      if (needCtrl !== e.ctrlKey || needShift !== e.shiftKey || needAlt !== e.altKey) return false;
      return e.key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
    };

    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey && !e.altKey;
      if (ctrl && e.shiftKey && (e.key === "P" || e.key === "p")) { e.preventDefault(); openPalette(); return; }
      if (ctrl && !e.shiftKey && (e.key === "P" || e.key === "p")) { e.preventDefault(); openPalette(">"); return; }
      if (ctrl && e.key >= "1" && e.key <= "9") {
        const order = uiPages().filter((x) => x.id !== "settings");
        const idx = parseInt(e.key, 10) - 1;
        if (order[idx]) {
          e.preventDefault();
          navigate(order[idx].id);
        }
        return;
      }
      if (ctrl && e.key === "Tab") {
        e.preventDefault();
        // R0-8：循环顺序由页面注册表驱动（槽位 order，settings 天然在末位）
        const order = uiPages().map((x) => x.slot ?? x.id);
        const idx = order.indexOf(getState().page);
        navigate(order[(idx + 1 + order.length) % order.length]);
        return;
      }
      // keybindings 接缝：按 keyHint 分发（Ctrl+Enter 输入上下文保留给提交框）
      for (const c of cmds) {
        if (!c.keyHint || c.keyHint === "Ctrl+Enter" || c.enabled === false) continue;
        if (match(c.keyHint, e)) {
          e.preventDefault();
          void runCommand(c);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [openPalette, repoPath]);
}

export function App() {
  const app = useApp();
  const [palette, setPalette] = useState<{ prefill?: string; ts: number } | null>(null);
  const [mcpApproval, setMcpApproval] = useState<{ id: string; description: string; repo: string } | null>(null);

  // MCP 写操作人审卡（McpPipeHost.requestApproval 的 GUI 侧）
  useEffect(
    () =>
      onEvent("mcp.approval", (p: { id: string; description: string; repo: string }) => {
        setMcpApproval(p);
      }),
    [],
  );

  // 启动装配：设置 → 主题 → 语言 → 恢复上次仓库
  useEffect(() => {
    (async () => {
      try {
        const settings = await call<import("./bridge/types").SettingsDTO>("settings.get");
        setState({ settings });
        await reapplyTheme(settings);
        await reapplyLanguage(settings);
        const last = settings.currentProjectPath;
        if (last) {
          try {
            const repo = await call<{ workDir: string; name: string }>("repo.open", { path: last });
            setState({ repo });
          } catch {
            setState({ repo: null });
          }
        }
        setState({ booted: true, page: settings.currentProjectPath ? "log" : "projects" });
        // U1c：外部页面装载（R0/A3：bridge 侧内置包免门、用户包按 allowCodePlugins 门；SDK 全局先装）
        installUiApi();
        void loadExternalPages(settings.allowCodePlugins, settings.language);
      } catch (e) {
        // 桥不可用（纯浏览器调试）：以未开仓库状态进入
        setState({ booted: true, page: "projects" });
        console.error("boot failed:", e);
      }
    })();
  }, []);

  // 设置变化（主题/语言/差异模式）→ 重应用视觉
  useEffect(() => {
    if (app.settings) {
      applyDiffModeToDom(app.settings.diffMode);
    }
    if (app.theme) applyThemeToDom(app.theme);
    if (app.settings?.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => void reapplyTheme(app.settings!);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
  }, [app.settings?.theme, app.settings?.themePackageId, app.settings?.diffMode, app.theme]);

  // 主进程请求打开仓库（新窗口 / second-instance）
  useEffect(() =>
    onEvent("app.openRepo", async (p: { path: string }) => {
      try {
        const repo = await call<{ workDir: string; name: string }>("repo.open", { path: p.path });
        setState({ repo, page: "log" });
        refreshCurrent();
      } catch (e) {
        console.error("openRepo failed:", e);
      }
    }),
  []);

  // L1 命令首跑确认（commands.exec confirm-required 的 GUI 侧）
  const commandConfirm = useApp().commandConfirm;
  const toasts = useApp().toasts;

  // E 阶段面板插槽：ui.panels 拉取（15s 轮询，正文为插件数据供给文本）
  const panels = useApp().panels;
  const [views, setViews] = useState<{ id: string; title: string; html: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => void call<{ id: string; title: string; html: string }[]>("ui.views").then((r) => {
      if (!cancelled) setViews(r);
    });
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () => void call<{ id: string; title: string; body: string }[]>("ui.panels").then((r) => {
      if (!cancelled) setState({ panels: r });
    });
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [app.repo?.workDir]);

  // agent.stream → 流式缓冲条（D 阶段：循环 delta 透传的可视化）
  const agentStreamText = useApp().agentStreamText;
  useEffect(() => onEvent("agent.stream", (p: { delta?: string }) => {
    if (typeof p?.delta === "string") appendAgentStream(p.delta);
  }), []);

  // 任务状态变化（含 checkpoint 提交 / restore 恢复工作区等改仓动作）→ 各 git 页数据重拉
  useEffect(() => onEvent("agent.tasks.changed", () => notifyRepoChanged()), []);

  // ctx.ui.notify → toast（L2 插件通知接缝）
  useEffect(() => onEvent("ui.notify", (p: { title: string; body?: string }) => {
    pushToast(String(p?.title ?? ""), String(p?.body ?? ""));
  }), []);

  // R0/D6 生命周期：包集合变化（导入/卸载/启停/allowCodePlugins 切换）→ 外部页热重同步
  useEffect(() => onEvent("extensions.changed", () => {
    void reloadExternalPages(
      getState().settings?.allowCodePlugins ?? false,
      getState().i18n?.lang ?? "en",
    );
  }), []);

  // R2：语言切换 → 包标题（%key% 装载时解析）重解析
  const lang = useApp().i18n?.lang;
  useEffect(() => {
    if (!lang) return;
    void reloadExternalPages(getState().settings?.allowCodePlugins ?? false, lang);
  }, [lang]);

  useShortcuts((prefill) => setPalette({ prefill, ts: Date.now() }));

  // 标题栏面板按钮（CustomEvent 桥）
  useEffect(() => {
    const open = () => setPalette({ ts: Date.now() });
    window.addEventListener("gitter:palette", open);
    return () => window.removeEventListener("gitter:palette", open);
  }, []);

  if (!app.booted) {
    return (
      <div className="app">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--c-text3)" }}>
          Gitter…
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar />
      <div className={"main" + (app.settings?.sidebarCollapsed ? " collapsed" : "")}>
        <Sidebar />
        {/* page-root：内容列唯一的 Base 着色点（与 sidebar/titlebar/statusbar 同为单层叠涂，
         * 观感对齐边框）；内层 .page/.page-slot 保持透明——多层 .page 嵌套会把底色叠成 3-4 层 */}
        <div className="page page-root">
          <PageOutlet pageId={app.page} />
        </div>
      </div>
      <StatusBar />
      {palette && <CommandPalette prefill={palette.prefill} onClose={() => setPalette(null)} />}
      {mcpApproval && (
        <Modal
          title="Agent 写操作确认"
          confirmText="允许"
          cancelText="拒绝"
          danger
          onClose={() => {
            void call("mcp.approve", { id: mcpApproval.id, ok: false });
            setMcpApproval(null);
          }}
          onConfirm={() => {
            void call("mcp.approve", { id: mcpApproval.id, ok: true });
            setMcpApproval(null);
          }}
        >
          <div style={{ userSelect: "text" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--c-text2)", marginBottom: 6 }}>{mcpApproval.repo}</div>
            {mcpApproval.description}
          </div>
        </Modal>
      )}
      {panels.length > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: "var(--sb-h, 28px)", display: "flex", gap: 8, padding: "4px 12px", borderTop: "1px solid var(--c-border)", background: "var(--c-panel)", maxHeight: 180, overflow: "auto" }}>
          {panels.map((p) => (
            <details key={p.id} style={{ flex: 1, minWidth: 200 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{p.title}</summary>
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap", userSelect: "text", marginTop: 4 }}>{p.body}</div>
            </details>
          ))}
          {agentStreamText && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: "var(--sb-h, 28px)", padding: "4px 12px", borderTop: "1px solid var(--c-border)", background: "var(--c-panel)", fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>
          <b>AI：</b>{agentStreamText}
        </div>
      )}
      {views.map((v) => (
            <details key={v.id} style={{ flex: 1, minWidth: 200 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{v.title}</summary>
              {/* webview 视图容器：sandbox 无 allow-scripts——插件 HTML 静态渲染，无脚本执行权 */}
              <iframe
                title={v.title}
                sandbox=""
                srcDoc={v.html}
                style={{ width: "100%", height: 140, border: "none", background: "#fff", marginTop: 4 }}
              />
            </details>
          ))}
        </div>
      )}
      {toasts.length > 0 && (
        <div className="toast-stack" style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
          {toasts.map((x) => (
            <div key={x.id} className="banner" style={{ minWidth: 240, maxWidth: 360 }}>
              <div style={{ fontWeight: 600 }}>{x.title}</div>
              {x.body && <div style={{ color: "var(--c-text2)", fontSize: 12, marginTop: 2 }}>{x.body}</div>}
            </div>
          ))}
        </div>
      )}
      {commandConfirm && (
        <Modal
          title={t("Ext_ConfirmTitle")}
          confirmText={t("Ext_ConfirmRun")}
          cancelText={t("Common_Cancel")}
          danger
          onClose={() => setState({ commandConfirm: null })}
          onConfirm={() => {
            void call("commands.exec", { id: commandConfirm.id, confirmed: true, filePath: commandConfirm.filePath })
              .catch((e) => console.warn("命令执行失败:", (e as Error).message));
            setState({ commandConfirm: null });
          }}
        >
          <div style={{ userSelect: "text" }}>
            <div>{t("Ext_ConfirmBody")}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, marginTop: 6 }}>{commandConfirm.title}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
