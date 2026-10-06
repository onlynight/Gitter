import { call } from "./bridge/client";
import { beginExternalPackage, endExternalPackage } from "./sdk";

/**
 * 外部页面装载器（ui-pluginization-plan.md U1c）：
 * allowCodePlugins 开启时，从扩展包清单（contributes.pages）读取渲染层入口
 * （经典 script，非 module），逐包注入 <script src="file://…">——脚本同步调用
 * window.GITTER_UI.registerPage 完成注册。
 * 信任门：settings.allowCodePlugins（审核渠道语义，同 L2/L3）。
 */

export interface ExternalPageInfo {
  id: string; // ext.<pkg>.<pid>
  title: string;
  entryAbs: string; // 绝对路径（loader 转 file:// URL）
  packageId: string;
}

function fileUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  return norm.startsWith("file:") ? norm : `file:///${norm.replace(/^\/+/, "")}`;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`外部页面脚本加载失败: ${src}`));
    document.head.appendChild(el);
  });
}

/** App 装配时调用；返回成功注册的外部页数量（桥不可用/门关闭 = 0）。 */
export async function loadExternalPages(allowCode: boolean): Promise<number> {
  if (!allowCode) return 0;
  let list: ExternalPageInfo[] = [];
  try {
    list = await call<ExternalPageInfo[]>("extensions.pages");
  } catch {
    return 0;
  }
  let ok = 0;
  for (const p of list) {
    try {
      beginExternalPackage(p.packageId);
      await injectScript(fileUrl(p.entryAbs));
      ok++;
    } catch (e) {
      console.warn(`[pages] ${p.id} 装载失败:`, (e as Error).message);
    } finally {
      endExternalPackage();
    }
  }
  return ok;
}
