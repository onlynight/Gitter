/**
 * 数据 API 版本（ui-pluginization-plan.md U3：DTO 冻结契约）：
 * web/src/bridge/types.ts 中对外契约类型（Commit/File/Changes/Branches/Diff/Theme/Task 等）
 * 属于外部页面 UI 可消费的稳定面——任何破坏性修改必须递增 DATA_API_VERSION，
 * 并重新生成 sdk/gitter-ui.d.ts（node scripts/gen-ui-sdk.mjs）。
 * v2：GITTER_UI 面扩容（context 共享上下文镜像/导航/openRepo/GITTER_KIT 全局）。
 * v3（2026-10-06，R2）：GITTER_UI = PageSurface 全量面（surface.ts 单一源）+ getState/subscribeState
 *     + runCommand + t；registerPage def 除 id 外可省；GITTER_KIT = 宿主组装的 React 单实例 + 内核组件。
 * v4（2026-10-12）：stash/discard 多选/amend/force-push/revert/cherry-pick 面——新增 StashEntryDTO、
 *     StashFileDTO、HeadCommitInfoDTO、RemoteOnlyCommitDTO；changes.commit 加 amend、changes.push 加
 *     forceWithLease/tags 参数；新增 stash.* / changes.discardFiles / changes.headInfo / changes.pushPreview /
 *     log.revert / log.cherryPick / git.revert*Continue|Abort / git.cherryPick*Continue|Abort。
 */

export const DATA_API_VERSION = 4;
