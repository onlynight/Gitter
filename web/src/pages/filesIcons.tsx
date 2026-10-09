/**
 * 文件页共享图标（files-editor-redesign-mockup.html §二）：
 * UI 图标为 16px 单色线性 SVG（currentColor）；文件类型图标按扩展名着色的
 * 单形文档（v1 内置「扩展名→颜色」映射，P3 可升级 Seti 风格全量 SVG 集）。
 */

/** 扩展名 → 类型色（中饱和，亮暗主题通用） */
const TYPE_COLOR: Record<string, string> = {
  ts: "#519ABA", tsx: "#519ABA", js: "#DDB15A", mjs: "#DDB15A", cjs: "#DDB15A", json: "#DDB15A",
  css: "#519ABA", scss: "#C879B2", less: "#519ABA",
  html: "#E37933", htm: "#E37933", vue: "#519ABA", svelte: "#E37933",
  md: "#6BABF5", markdown: "#6BABF5",
  svg: "#A074C4", xml: "#A074C4", cs: "#519ABA", py: "#519ABA",
  png: "#A074C4", jpg: "#A074C4", jpeg: "#A074C4", gif: "#A074C4", ico: "#A074C4",
  yml: "#DDB15A", yaml: "#DDB15A", toml: "#DDB15A", ini: "#8F8F8F",
  default: "#8F8F8F",
};

/** 文件类型图标（14px 文档折角形，描边=类型色）。 */
export function FileIcon({ path }: { path: string }) {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const c = TYPE_COLOR[ext] ?? TYPE_COLOR.default;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.8h5.2L12.8 5.4V14a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.6c0-.44.36-.8.8-.8z"
        stroke={c} strokeWidth="1.1" strokeLinejoin="round"
      />
      <path d="M9 2v3.4h3.4" stroke={c} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** 右向 chevron（展开态由 CSS 旋转 90°） */
export const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" {...S} strokeWidth="1.4" /></svg>
);
export const ChevronSepIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" {...S} strokeWidth="1.3" /></svg>
);
export const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11L9.5 8.4v4.1l-3 1.5V8.4z" {...S} /></svg>
);
export const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13.2 1.8v3h-3" {...S} /></svg>
);
export const CollapseAllIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 2.5h11M2.5 13.5h11" {...S} />
    <path d="m5.2 5 2.8 2.4L10.8 5" {...S} />
    <path d="m5.2 11 2.8-2.4L10.8 11" {...S} />
  </svg>
);
export const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" {...S} strokeWidth="1.3" /></svg>
);
export const SparkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5 9.4 6 14 7.4 9.4 8.8 8 13.4 6.6 8.8 2 7.4 6.6 6z" /></svg>
);
export const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2" {...S} /><path d="m10.4 10.4 3 3" {...S} /></svg>
);
export const SplitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.2" {...S} /><path d="M8 2.5v11" {...S} /></svg>
);
export const MoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.2" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="12.8" cy="8" r="1.2" /></svg>
);
export const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.2 3.2L13 5" {...S} strokeWidth="1.4" /></svg>
);
export const OpenExternalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 2.5h4.5V7M13 3 7.5 8.5" {...S} /></svg>
);
export const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="m11.3 2.1 2.6 2.6c.3.3.3.8 0 1.1L6.3 13.4 2.5 14l.6-3.8 7.1-7.1c.3-.3.8-.3 1.1 0z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    <path d="m9.9 3.6 2.5 2.5" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);
export const FilesIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.5 1.8h3.6L11.8 4.5v5.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 4.2h3.4L10 6.6v6.6a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V5c0-.44.36-.8.8-.8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);
export const FolderIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"><path d="M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.6h5.9c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z" {...S} /></svg>
);
export const DiffIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v7M4.5 2.5 2.5 4.5M4.5 2.5l2 2M11.5 13.5v-7M11.5 13.5l-2-2M11.5 13.5l2-2" {...S} /></svg>
);
export const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2" {...S} /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" {...S} /></svg>
);
export const RevealIcon = () => <FolderIcon size={13} />;
