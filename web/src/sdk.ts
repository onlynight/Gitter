import { call, onEvent } from "./bridge/client";
import { getState } from "./state/store";
import { registerUiPage, unregisterUiPagesByPackage, type UIPageDef } from "./uiRegistry";

/**
 * UI SDK（ui-pluginization-plan.md U1c，G2 渲染层插件运行时的宿主侧 API）：
 * loader 装载外部页面前安装 window.GITTER_UI；外部页脚本（经典 script，非 module）
 * 同步调用 GITTER_UI.registerPage({ id, title, icon?, order? }, mount)。
 * mount(container, ctx) 渲染进宿主提供的容器，可返回清理函数。
 * 信任模型：渲染层 in-process（U0 路线 a）——外部页代码拥有页面级权限，
 * 装载受 settings.allowCodePlugins 门控，来源在侧栏以包名标记。
 */

/** U2 权限令牌（advisory）：SDK 调用自动携带包身份；bridge 入口按权限域过滤。
 * in-process 物理极限：直连 gitter.invoke 可绕过——最终防线是审核渠道门 + 主进程人审。 */
function callWithCaller(packageId: string | null, method: string, params?: unknown): Promise<unknown> {
  const base = (params ?? {}) as Record<string, unknown>;
  const merged = { ...base, __caller: { packageId: packageId ?? "" } };
  return call(method, merged);
}

export interface ExternalPageContext {
  packageId: string;
  /** 当前仓库（未打开 = null） */
  repo(): { workDir: string; name: string } | null;
  /** 宿主桥调用（v1：与宿主同权限面；按包过滤随 U2 权限令牌落地） */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** 订阅宿主事件（按事件名：ui.notify / sync.progress / repo.opened / agent.stream 等） */
  on(method: string, cb: (params: unknown) => void): () => void;
}

interface PendingExternalPage {
  id: string;
  title: string;
  icon?: string;
  order?: number;
  mount: (container: HTMLElement, ctx: ExternalPageContext) => void | (() => void);
}

let loadingPackageId: string | null = null;

/** loader 在注入每个包的脚本前调用（包名用于页面归属与侧栏来源标记）。 */
export function beginExternalPackage(packageId: string): void {
  loadingPackageId = packageId;
}

export function endExternalPackage(): void {
  loadingPackageId = null;
}

declare global {
  interface Window {
    GITTER_UI?: {
      registerPage(def: { id: string; title: string; icon?: string; order?: number }, mount: PendingExternalPage["mount"]): void;
      call<T = unknown>(method: string, params?: unknown): Promise<T>;
      on(method: string, cb: (params: unknown) => void): () => void;
      context(): { repo: { workDir: string; name: string } | null };
    };
  }
}

/** 安装全局 API（App 装配时一次）。 */
export function installUiApi(): void {
  if (window.GITTER_UI) return;
  const makeCtx = (packageId: string): ExternalPageContext => ({
    packageId,
    repo: () => getState().repo,
    call: <T,>(method: string, params?: unknown) => callWithCaller(packageId, method, params) as Promise<T>,
    on: (method, cb) => onEvent(method, cb as never),
  });
  window.GITTER_UI = {
    registerPage(def, mount) {
      const packageId = loadingPackageId;
      if (!packageId) return;
      const fullId = `ext.${packageId}.${def.id}`;
      let cleanup: (() => void) | void = undefined;
      const pageDef: UIPageDef = {
        id: fullId,
        title: def.title,
        glyph: def.icon,
        order: def.order ?? 500,
        source: "package",
        packageId,
        mount: (container, ctx) => {
          cleanup = mount(container, makeCtx(packageId));
        },
      };
      registerUiPage(pageDef);
      // 包卸载时同步注销挂载器（容器卸载由 ExternalPageHost 的 effect 清理负责）
      const off = {
        dispose: () => {
          if (typeof cleanup === "function") cleanup();
          unregisterUiPagesByPackage(packageId);
        },
      };
      void off;
    },
    call: <T,>(method: string, params?: unknown) => callWithCaller(loadingPackageId, method, params) as Promise<T>,
    on: (method, cb) => onEvent(method, cb as never),
    context: () => ({ repo: getState().repo }),
  };
}
