/**
 * 渲染进程 Monarch 语法注册器（diff-view-monaco 插件化裁决）：
 * HAT/Aura 等语言高亮不再内置 monaco 库，由 L1 插件包 `contributes.monarchLanguages`
 * （Monarch JSON + 语言配置 JSON）供给，运行时经 extensions.monarch RPC 装配到
 * GITTER_LIBS.monaco。禁用/卸载插件 → dispose 注册 → 该语言回退纯文本。
 *
 * 时机收敛到一个幂等 refresh()：宿主启动 / extensions.changed / monaco 库注入完成
 * （pageLoader 派发 gitter-lib-injected）各触发一次；lib 未注入时挂起等待。
 * 语言 id 与 libs/langId.ts 的扩展名映射对齐（消费方零感知）。
 */
import { call, onEvent } from "./bridge/client";

type Monaco = typeof import("monaco-editor");

interface MonarchLangDecl {
  id: string;
  extensions: string[];
  monarch: string;
  languageConfiguration: string | null;
}
interface MonarchPkg {
  pkgId: string;
  dir: string;
  langs: MonarchLangDecl[];
}

function monacoLib(): Monaco | null {
  const w = window as unknown as { GITTER_LIBS?: Record<string, unknown> };
  return (w.GITTER_LIBS?.monaco as Monaco | undefined) ?? null;
}

/** langId → 分词注册（dispose 即禁用）。语言注册（register）无注销 API 且对本场景
 * 非必需（模型按显式 languageId 创建），故只持分词的 disposable。 */
const disposables = new Map<string, import("monaco-editor").IDisposable>();
let inFlight = false;
let rerunAfterFlight = false;

async function refresh(): Promise<void> {
  if (inFlight) {
    // 并发触发不丢弃：进行中的这轮结束后补跑一次（始终以最后一次触发收口）
    rerunAfterFlight = true;
    return;
  }
  inFlight = true;
  try {
    await doRefresh();
  } finally {
    inFlight = false;
    if (rerunAfterFlight) {
      rerunAfterFlight = false;
      void refresh();
    }
  }
}

async function doRefresh(): Promise<void> {
  const mc = monacoLib();
  if (!mc) return; // 库未注入：挂起，gitter-lib-injected 事件会再触发
  const pkgs = await call<MonarchPkg[]>("extensions.monarch").catch(() => []);
  const desired = new Map<string, { def: unknown; conf: unknown; extensions: string[] }>();
  for (const pkg of pkgs) {
    for (const lang of pkg.langs) {
      if (desired.has(lang.id)) continue;
      try {
        const def = JSON.parse(await call<string>("extensions.monarchFile", { pkgId: pkg.pkgId, file: lang.monarch }));
        const conf = lang.languageConfiguration
          ? JSON.parse(await call<string>("extensions.monarchFile", { pkgId: pkg.pkgId, file: lang.languageConfiguration }))
          : null;
        desired.set(lang.id, { def, conf, extensions: lang.extensions });
      } catch (e) {
        console.warn(`[monarch] ${lang.id} 语法装载失败（该语言回退纯文本）:`, e);
      }
    }
  }
  // 注销不再启用的语言
  for (const [id, d] of [...disposables]) {
    if (!desired.has(id)) {
      d.dispose();
      disposables.delete(id);
      console.info(`[monarch] ${id} 已注销（插件禁用/卸载）`);
    }
  }
  // 注册 / 更新：已存在的语言同样 dispose 旧分词再重设——插件语法升级后 refresh 必须生效
  for (const [id, { def, conf, extensions }] of desired) {
    disposables.get(id)?.dispose();
    try {
      mc.languages.register({ id, extensions });
      disposables.set(id, mc.languages.setMonarchTokensProvider(id, def as import("monaco-editor").languages.IMonarchLanguage));
      if (conf) mc.languages.setLanguageConfiguration(id, conf);
      console.info(`[monarch] ${id} 已注册（${extensions.join(",")}）`);
    } catch (e) {
      disposables.delete(id);
      console.warn(`[monarch] ${id} 注册失败（该语言回退纯文本）:`, e);
    }
  }
}

/** 宿主 shell 装配一次：启动刷新 + 包变更 / 库注入事件挂钩。 */
export function initMonarchRegistry(): void {
  void refresh();
  onEvent("extensions.changed", () => void refresh());
  window.addEventListener("gitter-lib-injected", () => void refresh());
}
