/**
 * 导航图标（自 Shell.tsx 迁入 kit，ui-full-pluginization-plan.md R2：
 * SettingsPage 等页面外置后经 GITTER_KIT 消费，不再依赖宿主 Shell 模块）。
 * SVG path 为 design-mockups 的 16×16 内联图形；字形项用 Segoe Fluent Icons（WinUI 同码位）。
 */
export function NavIcon({ glyph, svg }: { glyph?: string; svg?: string }) {
  if (svg) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d={svg} fill="currentColor" />
      </svg>
    );
  }
  return <span className="glyph">{glyph}</span>;
}
