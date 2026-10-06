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

// ---- GITTER_UI 全局 API 面（手工维护的宿主侧契约；随 U1/U2 演进） ----
const surface = `// ---- GITTER_UI 全局 API（宿主注入；外部页脚本直接使用，无需 import） ----

/** 宿主注入的 UI SDK（allowCodePlugins 开启后可用） */
declare var GITTER_UI: GITTER_UI_API;

interface GITTER_UI_API {
  /** 注册外部页面：id 自动加 ext.<包id>. 前缀；mount 渲染进宿主提供的容器 */
  registerPage(
    def: { id: string; title: string; icon?: string; order?: number },
    mount: (container: HTMLElement, ctx: ExternalPageContext) => void | (() => void),
  ): void;
  /** 宿主桥调用（权限域过滤中，见 permissions 声明） */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** 订阅宿主事件（ui.notify / sync.progress / repo.opened / agent.stream / audit.rpc.denied 等） */
  on(method: string, cb: (params: unknown) => void): () => void;
  /** 当前仓库上下文 */
  context(): { repo: { workDir: string; name: string } | null };
}

/** mount 收到的宿主上下文（packageId = 本包反向域名） */
interface ExternalPageContext {
  packageId: string;
  repo(): { workDir: string; name: string } | null;
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  on(method: string, cb: (params: unknown) => void): () => void;
}

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
