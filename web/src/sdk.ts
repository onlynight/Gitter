import { call, onEvent } from "./bridge/client";
import { getState, setState, subscribeState, type PageKey } from "./state/store";
import { hostSurface, subscribeContextChanged, type PageSurface } from "./surface";
import { registerUiPage, uiPage, type UIPageDef } from "./uiRegistry";
import { runCommand } from "./commands";

/**
 * UI SDK（ui-pluginization-plan.md U1c + ui-full-pluginization-plan.md R2）：
 * loader 装载外部页面前安装 window.GITTER_UI；外部页脚本（经典 script，非 module）
 * 同步调用 GITTER_UI.registerPage(def, mount)（def 除 id 外可省——身份/权限/图标来自 manifest 元数据）。
 * mount(container, ctx) 渲染进宿主提供的容器，可返回清理函数。
 *
 * GITTER_UI 的非 RPC 方法与内置 pageSdk 同实现（surface.ts 单一源）；
 * 另暴露 getState/subscribeState/t/runCommand——外部页 React 面（useSyncExternalStore）
 * 与右键菜单经此消费宿主活状态。window.GITTER_KIT（kitGlobal.ts 组装）提供 React 与内核组件。
 *
 * 信任模型：渲染层 in-process（U0 路线 a）——用户包装载受 settings.allowCodePlugins 门控
 * （内置页面包免门，R0/A3），来源在侧栏以包名标记。
 * U2 权限令牌（advisory）+ R0/A1 闭环：call 自动携带包身份与 manifest 声明的权限域
 * （loader 从清单注入，页面脚本不可自报）；bridge 入口按权限域过滤。
 * in-process 物理极限：直连 gitter.invoke 可绕过——最终防线是审核渠道门 + 主进程人审。
 */
function callWithCaller(packageId: string | null, permissions: string[] | undefined, method: string, params?: unknown): Promise<unknown> {
  const base = (params ?? {}) as Record<string, unknown>;
  const merged = { ...base, __caller: { packageId: packageId ?? "", permissions } };
  return call(method, merged);
}

export interface PageContextSnapshot {
  repo: { workDir: string; name: string } | null;
  selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
  selectedCommitSha: string | null;
}

export interface ExternalPageContext extends Omit<PageSurface, "call" | "on" | "context"> {
  packageId: string;
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  on(method: string, cb: (params: never) => void): () => void;
  context(): PageContextSnapshot;
}

interface PendingExternalPage {
  id: string;
  title?: string;
  icon?: string;
  order?: number;
  mount: (container: HTMLElement, ctx: ExternalPageContext) => void | (() => void);
}

type PageRegistration = Pick<PendingExternalPage, "id" | "title" | "icon" | "order">;

let loadingPackageId: string | null = null;
let loadingPermissions: string[] | undefined = undefined;

/** loader 在注入每个包的脚本前调用（包名与 manifest 权限用于页面归属与 __caller 强制）。 */
export function beginExternalPackage(packageId: string, permissions?: string[]): void {
  loadingPackageId = packageId;
  loadingPermissions = permissions;
}

export function endExternalPackage(): void {
  loadingPackageId = null;
  loadingPermissions = undefined;
}

export interface CallerIdentityView {
  packageId: string;
  permissions?: string[];
}

declare global {
  interface Window {
    /** 外部页宿主面 = PageSurface 全量（surface.ts 实现）+ 页面注册 + 活状态订阅。 */
    GITTER_UI?: PageSurface & {
      registerPage(def: PageRegistration, mount: PendingExternalPage["mount"]): void;
      context(): PageContextSnapshot;
      getState(): ReturnType<typeof getState>;
      subscribeState(cb: () => void): () => void;
      /** 装载期窗口内可取：当前注入包的 caller 身份（适配层在入口脚本 eval 期捕获） */
      getActiveCaller(): CallerIdentityView | null;
      /** 以显式 caller 调桥（页面挂载后的全部调用走这里——装载期模块变量早已重置） */
      callWith<T = unknown>(caller: CallerIdentityView | null, method: string, params?: unknown): Promise<T>;
    };
    GITTER_KIT?: Record<string, unknown>;
  }
}

function makeCtx(packageId: string, permissions: string[] | undefined): ExternalPageContext {
  const surface = hostSurface(
    // permissions 必须是注册瞬间捕获的闭包值——loader 注入完成后 loadingPermissions 已被重置，
    // 挂载时再读模块变量会恒回退缺省权限（terminal/extensions.admin/git.write 全被拒的事故根因）
    <T,>(method: string, params?: unknown) => callWithCaller(packageId, permissions, method, params) as Promise<T>,
    (method, cb) => (method === "context.changed" ? subscribeContextChanged(cb as never) : onEvent(method, cb)),
  );
  return { packageId, ...surface, context: () => ({ repo: getState().repo, ...getState().context }) };
}

/** 安装全局 API（App 装配时一次）。 */
export function installUiApi(): void {
  if (window.GITTER_UI) return;
  // 外部面与内置 pageSdk 同实现（surface.ts），仅 call 注入 caller 身份
  const surface = hostSurface(
    <T,>(method: string, params?: unknown) => callWithCaller(loadingPackageId, loadingPermissions, method, params) as Promise<T>,
    (method, cb) => (method === "context.changed" ? subscribeContextChanged(cb as never) : onEvent(method, cb)),
  );
  window.GITTER_UI = {
    getActiveCaller: () => (loadingPackageId ? { packageId: loadingPackageId, permissions: loadingPermissions } : null),
    callWith: <T,>(caller: CallerIdentityView | null, method: string, params?: unknown) =>
      callWithCaller(caller?.packageId ?? null, caller?.permissions, method, params) as Promise<T>,
    registerPage(def, mount) {
      const packageId = loadingPackageId;
      if (!packageId) return;
      // 注册瞬间捕获 manifest 权限（loader 在 beginExternalPackage 时注入）——
      // 页面挂载发生在注入完成之后，届时模块变量已被 endExternalPackage 重置
      const permissions = loadingPermissions;
      const fullId = `ext.${packageId}.${def.id}`;
      const prev = uiPage(fullId);
      const pageDef: UIPageDef = {
        // 脚本注册 = 惰性阶段结束：合并 loader 元数据（slot/permissions/svg/isBuiltInPackage），脚本 def 胜出
        ...prev,
        id: fullId,
        title: def.title ?? prev?.title,
        glyph: def.icon ?? prev?.glyph,
        order: def.order ?? prev?.order ?? 500,
        source: "package",
        packageId,
        lazy: false,
        mount: (container) => mount(container, makeCtx(packageId, permissions)),
      };
      registerUiPage(pageDef);
    },
    ...surface,
    context: () => ({ repo: getState().repo, ...getState().context }),
    t: surface.t,
    getState,
    subscribeState,
  };
}
