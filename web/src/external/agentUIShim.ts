/**
 * Agent UI 注册表宿主面适配（agent-harness-v4.md §14.6/§20.3.7）：
 * 页面源码 import 本模块（构建期随页打包，运行时全部走 window.GITTER_UI）——
 * 注册表单源在宿主（sdk.ts installUiApi 注入），页面产物不持有注册表副本。
 * 贡献方向：页面包经 registerAgentUI 注册（层级由 loader 注入的包身份决定）；
 * 消费方向：resolveTimelineRenderer / composerProviders 查询宿主注册表。
 */
import { useSyncExternalStore } from "react";
import type {
  AgentUITier, TimelineRendererDef, ComposerMentionProviderDef, TimelineCardProps, TimelineCardCtx,
} from "../agentUIRegistry";

function U(): NonNullable<Window["GITTER_UI"]> {
  const g = window.GITTER_UI;
  if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
  return g;
}

/** 注册本包的 agent UI 贡献（须在注入窗口内或宿主自举语境调用——层级取当期包身份）。 */
export function registerAgentUI(reg: {
  timelineRenderers?: TimelineRendererDef[];
  composerProviders?: ComposerMentionProviderDef[];
}): void {
  U().registerAgentUI(reg);
}

export function resolveTimelineRenderer(toolName: string | undefined, blockKind: string): TimelineRendererDef | null {
  return U().resolveTimelineRenderer(toolName, blockKind);
}

export function composerProviders(): ComposerMentionProviderDef[] {
  return U().composerProviders();
}

export function onAgentUIChanged(cb: () => void): () => void {
  return U().onAgentUIChanged(cb);
}

/** 注册表版本（React 响应式：包热插拔时消费方重渲染）。 */
export function useAgentUIVersion(): number {
  const g = U();
  return useSyncExternalStore(g.onAgentUIChanged, g.agentUIVersion);
}

export type { AgentUITier, TimelineRendererDef, ComposerMentionProviderDef, TimelineCardProps, TimelineCardCtx };
