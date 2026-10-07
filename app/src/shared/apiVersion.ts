/**
 * 数据 API 版本（ui-pluginization-plan.md U3：DTO 冻结契约）：
 * web/src/bridge/types.ts 中对外契约类型（Commit/File/Changes/Branches/Diff/Theme/Task 等）
 * 属于外部页面 UI 可消费的稳定面——任何破坏性修改必须递增 DATA_API_VERSION，
 * 并重新生成 sdk/gitter-ui.d.ts（node scripts/gen-ui-sdk.mjs）。
 * v2：GITTER_UI 面扩容（context 共享上下文镜像/导航/openRepo/GITTER_KIT 全局）。
 * v3（2026-10-06，R2）：GITTER_UI = PageSurface 全量面（surface.ts 单一源）+ getState/subscribeState
 *     + runCommand + t；registerPage def 除 id 外可省；GITTER_KIT = 宿主组装的 React 单实例 + 内核组件。
 */

export const DATA_API_VERSION = 3;
