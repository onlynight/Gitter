/**
 * 数据 API 版本（ui-pluginization-plan.md U3：DTO 冻结契约）：
 * web/src/bridge/types.ts 中对外契约类型（Commit/File/Changes/Branches/Diff/Theme/Task 等）
 * 属于外部页面 UI 可消费的稳定面——任何破坏性修改必须递增 DATA_API_VERSION，
 * 并重新生成 sdk/gitter-ui.d.ts（node scripts/gen-ui-sdk.mjs）。
 */

export const DATA_API_VERSION = 1;
