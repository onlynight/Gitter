#!/usr/bin/env node
/**
 * UI SDK 类型契约生成器（ui-pluginization-plan.md U3）：
 * 从 web/src/bridge/types.ts（桥 DTO 单一源）生成 sdk/gitter-ui.d.ts——
 * 外部页面插件作者的 TypeScript 契约包（DTO 冻结面 + GITTER_UI 全局 API）。
 *
 * 契约冻结政策：修改 types.ts 的对外类型后必须重新运行本脚本并递增
 * app/src/shared/apiVersion.ts 的 DATA_API_VERSION。
 *
 * 用法：
 *   node scripts/gen-ui-sdk.mjs           # 生成/覆盖 sdk/gitter-ui.d.ts
 *   node scripts/gen-ui-sdk.mjs --check   # 校验已有产物与源一致（漂移即非零退出）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const typesSrc = path.join(root, "web", "src", "bridge", "types.ts");
const outFile = path.join(root, "sdk", "gitter-ui.d.ts");
const apiVersionSrc = path.join(root, "app", "src", "shared", "apiVersion.ts");

const dataApiVersion = Number((fs.readFileSync(apiVersionSrc, "utf8").match(/DATA_API_VERSION = (\d+)/) ?? [])[1] ?? 0);
if (!dataApiVersion) {
  console.error("FAIL: 无法解析 DATA_API_VERSION");
  process.exit(1);
}

const dtoTypes = fs.readFileSync(typesSrc, "utf8");

// ---- GITTER_UI 全局 API 面（手工维护的宿主侧契约；随 U1/U2/R0/R2 演进） ----
const surface = `// ---- GITTER_UI 全局 API（宿主注入；外部页脚本直接使用，无需 import） ----

/** 宿主注入的 UI SDK（内置页面包恒可用；用户页面包受 allowCodePlugins 门控）。
 * 除 registerPage/getState/subscribeState 外与内置 pageSdk 同实现（web/src/surface.ts 单一源）。 */
declare var GITTER_UI: GITTER_UI_API;

interface GITTER_UI_API {
  /** 注册外部页面：id 自动加 ext.<包id>. 前缀；身份（标题/图标/权限/顺序）来自 manifest 元数据，def 只需 id */
  registerPage(
    def: { id: string; title?: string; icon?: string; order?: number },
    mount: (container: HTMLElement, ctx: ExternalPageContext) => void | (() => void),
  ): void;
  /** 宿主桥调用（按 manifest permissions 声明过滤，advisory） */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** 订阅宿主事件（ui.notify / sync.progress / repo.opened / agent.stream / context.changed / extensions.changed 等） */
  on(method: string, cb: (params: never) => void): () => void;
  /** i18n（宿主当前语言字典） */
  t(key: string, ...args: (string | number)[]): string;
  /** 导航到页面槽位 */
  navigate(page: string): void;
  /** 打开设置页并定位区块 */
  openSettings(section?: string): void;
  /** 通知 toast */
  toast(title: string, body?: string): void;
  /** 触发全局刷新（F5 语义） */
  refresh(): void;
  /** 当前仓库 */
  repo(): { workDir: string; name: string } | null;
  /** 当前设置快照 */
  settings(): SettingsDTO | null;
  /** 当前主题状态 */
  theme(): ThemeStateDTO | null;
  /** 打开仓库（projects.open + 导航到 log；Projects/替换页用） */
  openRepo(path: string): Promise<void>;
  /** 关闭当前仓库 */
  closeRepo(): void;
  /** 命令执行唯一入口（首跑确认/模板插值/路由在宿主） */
  runCommand(cmd: { id: string; title?: string; titleKey?: string }, ctx?: { filePath?: string | null }): Promise<void>;
  /** 共享上下文（repo + selectedFile/selectedCommitSha 镜像） */
  context(): {
    repo: { workDir: string; name: string } | null;
    selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
    selectedCommitSha: string | null;
  };
  /** 共享上下文写 */
  setContext(patch: { selectedFile?: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null; selectedCommitSha?: string | null }): void;
  /** 设置更新（持久化 + 回写 + 主题/语言/差异模式按需重应用） */
  updateSettings(patch: Partial<SettingsDTO>): Promise<SettingsDTO>;
  /** 回写设置快照（专用 RPC 返回新快照后） */
  applySettings(s: SettingsDTO): void;
  /** 重取主题并落到 DOM */
  reloadTheme(): Promise<void>;
  /** 清空设置页定位信号 */
  clearSettingsFocus(): void;
  /** 任务聚焦信号（Log 会话卡 → TasksPage） */
  focusTask(taskId: string): void;
  clearTaskFocus(): void;
  /** 扩展管理树快照（页面槽位 → 提供者/替补 + agent UI 注册；设置页"插件挂载树"消费） */
  extTree(): {
    pages: Array<{
      slot: string; id: string; titleKey?: string; title?: string;
      packageId: string | null; isBuiltIn: boolean; source: "builtin" | "package"; order: number;
      shadowed: Array<{ packageId: string; isBuiltIn: boolean }>;
    }>;
    agentUI: Array<{ packageId: string; tier: "host" | "builtin" | "user"; renderers: number; providers: number }>;
  };
  /** 贡献文档（终端页文档面板可读；同 id 用户包 > 内置包 > 宿主，层级由 loader 注入的包身份决定；
   * 返回退订函数——插件页卸载时撤销本包文档）。内容一律经 renderMarkdown 渲染，无脚本注入面。 */
  registerDoc(def: { id: string; title: string | (() => string); source: () => string | Promise<string> }): () => void;
  unregisterDoc(id: string, packageId?: string): void;
  /** 已注册文档清单（同 id 覆盖已解析） */
  docs(): Array<{
    doc: { id: string; title: string | (() => string); source: () => string | Promise<string> };
    packageId: string; tier: "host" | "builtin" | "user";
  }>;
  /** 文档标题求值（title 为函数时调用） */
  docTitle(doc: { id: string; title: string | (() => string); source: () => string | Promise<string> }): string;
  /** 文档注册表变化订阅 */
  onDocsChanged(cb: () => void): () => void;
  /** 文档注册表版本 */
  docsVersion(): number;
  /** 宿主活状态快照（配合 subscribeState 组装 useSyncExternalStore） */
  getState(): AppStateSnapshot;
  /** 订阅宿主状态变化（setState 即触发；返回退订函数） */
  subscribeState(cb: () => void): () => void;
  /** 装载期窗口内可取：当前注入包的 caller 身份（适配层在入口脚本 eval 期捕获） */
  getActiveCaller(): { packageId: string; permissions?: string[] } | null;
  /** 以显式 caller 调桥（页面挂载后的全部调用走这里） */
  callWith<T = unknown>(caller: { packageId: string; permissions?: string[] } | null, method: string, params?: unknown): Promise<T>;
}

/** 宿主状态快照（渲染层 AppState 的只读镜像；字段见 web/src/state/store.ts） */
interface AppStateSnapshot {
  booted: boolean;
  page: string;
  repo: { workDir: string; name: string } | null;
  settings: SettingsDTO | null;
  theme: ThemeStateDTO | null;
  i18n: { lang: string; strings: Record<string, string> } | null;
  refreshTick: number;
  context: {
    selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
    selectedCommitSha: string | null;
  };
  [key: string]: unknown;
}

/** mount 收到的宿主上下文（packageId = 本包反向域名；其余与 GITTER_UI 同面） */
interface ExternalPageContext extends Omit<GITTER_UI_API, "registerPage" | "getState" | "subscribeState"> {
  packageId: string;
}

/** window.GITTER_KIT：宿主启动时组装的 React 单实例 + 内核组件库（web/src/kitGlobal.ts）。
 * 页面构建把 react/jsx-runtime/react-dom(+/client) 声明为 GITTER_KIT.* globals external。 */
declare var GITTER_KIT: {
  React: unknown;
  ReactDOM: unknown;
  ReactDOMClient: { createRoot(container: Element): { render(node: unknown): void; unmount(): void } };
  ReactJSXRuntime: unknown;
  DiffView: unknown;
  SplitPane: unknown;
  Banner: unknown;
  Modal: unknown;
  SyncBar: unknown;
  PageErrorBoundary: unknown;
  NavIcon: unknown;
  useContextMenu: () => unknown;
  renderMarkdown: (text: string) => string;
  registerMarkdownPlugin: (plugin: unknown) => void;
  [key: string]: unknown;
};

/** 权限域（contributes.pages[].permissions；缺省 = ["open", "git.read"]） */
type UiPermission =
  | "open" | "git.read" | "git.write" | "settings.write"
  | "agent.run" | "agent.config" | "extensions.admin"
  | "terminal" | "ai.invoke" | "approval" | "window" | "webview";
`;

const banner = `// 自动生成：scripts/gen-ui-sdk.mjs —— 不要手改（再生成：node scripts/gen-ui-sdk.mjs）
// 数据 API 版本：v${dataApiVersion}
// 契约冻结政策：修改 web/src/bridge/types.ts 对外类型 → 递增 DATA_API_VERSION → 重新生成
// 兼容查询：宿主桥 RPC "api.info" 返回 { dataApiVersion, hostApiVersion }

`;

const content = banner + dtoTypes + "\n" + surface;

if (process.argv[2] === "--check") {
  const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (existing !== content) {
    console.error("FAIL: sdk/gitter-ui.d.ts 与数据源漂移——请重新运行 node scripts/gen-ui-sdk.mjs 并评估是否递增 DATA_API_VERSION");
    process.exit(1);
  }
  console.log(`[PASS] UI SDK 契约无漂移（数据 API v${dataApiVersion}）`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, content);
console.log(`UI SDK 契约已生成 → ${outFile}（数据 API v${dataApiVersion}）`);
