/**
 * 文件页共享图标（files-editor-redesign-mockup.html §二）：
 * UI 图标为 16px 单色线性 SVG（currentColor）；文件类型图标按扩展名分形着色
 * （Seti 风格：形状族区分语言大类 + 类型色，P3 落地——单形文档在 14px 下
 * 缩成色块，视觉上等同无图标）。
 */
import type { ReactNode } from "react";

/** 形状族：hex=语言六边形 / braces=JSON / hash=样式 / angle=标记语言 / text=纯文本文档
 *  / term=脚本终端 / pic=图片 / gear=配置 / jsq=JS 方块 / doc=文档折角（缺省） */
type Glyph = "hex" | "braces" | "hash" | "angle" | "text" | "term" | "pic" | "gear" | "jsq" | "doc";

/** 扩展名 → 形状族 + 类型色（中饱和，亮暗主题通用） */
const EXT_ICON: Record<string, { g: Glyph; c: string }> = {
  // JavaScript 生态
  ts: { g: "hex", c: "#519ABA" }, tsx: { g: "hex", c: "#519ABA" },
  js: { g: "jsq", c: "#DDB15A" }, mjs: { g: "jsq", c: "#DDB15A" }, cjs: { g: "jsq", c: "#DDB15A" }, jsx: { g: "jsq", c: "#DDB15A" },
  json: { g: "braces", c: "#DDB15A" }, jsonc: { g: "braces", c: "#DDB15A" },
  // 样式
  css: { g: "hash", c: "#519ABA" }, scss: { g: "hash", c: "#C879B2" }, sass: { g: "hash", c: "#C879B2" }, less: { g: "hash", c: "#519ABA" },
  // 标记语言
  html: { g: "angle", c: "#E37933" }, htm: { g: "angle", c: "#E37933" }, vue: { g: "angle", c: "#519ABA" }, svelte: { g: "angle", c: "#E37933" },
  xml: { g: "angle", c: "#A074C4" }, xaml: { g: "angle", c: "#A074C4" }, csproj: { g: "angle", c: "#519ABA" },
  props: { g: "angle", c: "#8F8F8F" }, targets: { g: "angle", c: "#8F8F8F" }, config: { g: "angle", c: "#8F8F8F" },
  sln: { g: "angle", c: "#8F8F8F" },
  // 编译型语言（六边形族，语言色区分）
  cs: { g: "hex", c: "#519ABA" }, go: { g: "hex", c: "#519ABA" }, rs: { g: "hex", c: "#C879B2" },
  java: { g: "hex", c: "#C879B2" }, kt: { g: "hex", c: "#C879B2" }, swift: { g: "hex", c: "#E37933" },
  scala: { g: "hex", c: "#C879B2" }, c: { g: "hex", c: "#8F8F8F" }, h: { g: "hex", c: "#8F8F8F" },
  cpp: { g: "hex", c: "#519ABA" }, hpp: { g: "hex", c: "#519ABA" }, cc: { g: "hex", c: "#519ABA" },
  py: { g: "hex", c: "#519ABA" }, rb: { g: "hex", c: "#C85A5A" }, php: { g: "hex", c: "#8F8F8F" },
  // 脚本 / 终端
  sh: { g: "term", c: "#8F8F8F" }, bash: { g: "term", c: "#8F8F8F" }, zsh: { g: "term", c: "#8F8F8F" },
  ps1: { g: "term", c: "#519ABA" }, psm1: { g: "term", c: "#519ABA" }, psd1: { g: "term", c: "#519ABA" },
  bat: { g: "term", c: "#8F8F8F" }, cmd: { g: "term", c: "#8F8F8F" },
  // 纯文本文档
  md: { g: "text", c: "#6BABF5" }, markdown: { g: "text", c: "#6BABF5" },
  txt: { g: "text", c: "#8F8F8F" }, log: { g: "text", c: "#8F8F8F" }, gitignore: { g: "text", c: "#E37933" },
  // 配置
  yml: { g: "gear", c: "#DDB15A" }, yaml: { g: "gear", c: "#DDB15A" },
  toml: { g: "gear", c: "#DDB15A" }, ini: { g: "gear", c: "#8F8F8F" }, cfg: { g: "gear", c: "#8F8F8F" },
  properties: { g: "gear", c: "#8F8F8F" }, editorconfig: { g: "gear", c: "#8F8F8F" }, lock: { g: "gear", c: "#8F8F8F" },
  // 图片
  png: { g: "pic", c: "#A074C4" }, jpg: { g: "pic", c: "#A074C4" }, jpeg: { g: "pic", c: "#A074C4" },
  gif: { g: "pic", c: "#A074C4" }, webp: { g: "pic", c: "#A074C4" }, bmp: { g: "pic", c: "#A074C4" },
  avif: { g: "pic", c: "#A074C4" }, ico: { g: "pic", c: "#A074C4" },
};

const DEFAULT_ICON: { g: Glyph; c: string } = { g: "doc", c: "#8F8F8F" };

/** 扩展名 → 图标定义（按最后一个点的后缀匹配；无后缀回退缺省文档）。 */
function iconForPath(path: string): { g: Glyph; c: string } {
  const base = path.split("/").pop() ?? path;
  if (base.toLowerCase() === ".gitignore") return EXT_ICON.gitignore;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return EXT_ICON[ext] ?? DEFAULT_ICON;
}

/** 形状族 → 16 viewBox 线性 path 集（stroke=c 由调用方着色；14px 下可辨形）。 */
const GLYPH_PATHS: Record<Glyph, (c: string) => ReactNode> = {
  hex: (c) => (
    <path d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5z" stroke={c} strokeWidth="1.1" strokeLinejoin="round" />
  ),
  braces: (c) => (
    <>
      <path d="M6.8 2.5c-1.7 0-1.1 4.1-2.9 5.5 1.8 1.4 1.2 5.5 2.9 5.5" stroke={c} strokeWidth="1.15" strokeLinecap="round" fill="none" />
      <path d="M9.2 2.5c1.7 0 1.1 4.1 2.9 5.5-1.8 1.4-1.2 5.5-2.9 5.5" stroke={c} strokeWidth="1.15" strokeLinecap="round" fill="none" />
    </>
  ),
  hash: (c) => (
    <>
      <path d="M6.2 2.8 5 13.2M11 2.8 9.8 13.2M2.9 6.2h10.4M2.7 10h10.4" stroke={c} strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </>
  ),
  angle: (c) => (
    <>
      <path d="M5.4 4.6 2.4 8l3 3.4M10.6 4.6 13.6 8l-3 3.4" stroke={c} strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  text: (c) => (
    <>
      <rect x="3" y="2.2" width="10" height="11.6" rx="1" stroke={c} strokeWidth="1.1" fill="none" />
      <path d="M5.4 6h5.2M5.4 8.6h5.2M5.4 11.2h3.2" stroke={c} strokeWidth="1" strokeLinecap="round" />
    </>
  ),
  term: (c) => (
    <>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.2" stroke={c} strokeWidth="1.1" fill="none" />
      <path d="m4.6 6.4 1.9 1.6-1.9 1.6M8.2 10.2h3.4" stroke={c} strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  pic: (c) => (
    <>
      <rect x="2.4" y="3" width="11.2" height="10" rx="1.2" stroke={c} strokeWidth="1.1" fill="none" />
      <circle cx="6" cy="6.3" r="1.05" stroke={c} strokeWidth="1" fill="none" />
      <path d="m4.4 11.4 2.9-2.9 1.9 1.9 1.5-1.5 2 2.3" stroke={c} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  gear: (c) => (
    <>
      <path d="M2.8 5.4h10.4M2.8 10.6h10.4" stroke={c} strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="6.1" cy="5.4" r="1.5" fill="var(--c-base, #222)" stroke={c} strokeWidth="1.1" />
      <circle cx="10.2" cy="10.6" r="1.5" fill="var(--c-base, #222)" stroke={c} strokeWidth="1.1" />
    </>
  ),
  jsq: (c) => (
    <>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2" stroke={c} strokeWidth="1.1" fill="none" />
      <path d="M6.2 5.6v3.2c0 .9-.5 1.3-1.2 1.3M9.9 5.9c-.4-.4-1.9-.6-2.3.2-.4 1 2.7.9 2.4 2.6-.3 1.1-2 1.1-2.8.5" stroke={c} strokeWidth="1" strokeLinecap="round" fill="none" />
    </>
  ),
  doc: (c) => (
    <>
      <path d="M4 1.8h5.2L12.8 5.4V14a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.6c0-.44.36-.8.8-.8z" stroke={c} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M9 2v3.4h3.4" stroke={c} strokeWidth="1.1" strokeLinejoin="round" />
    </>
  ),
};

/** 文件类型图标（14px；形状族 + 类型色，TreePane/标签条/QuickOpen 共用）。 */
export function FileIcon({ path }: { path: string }) {
  const { g, c } = iconForPath(path);
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {GLYPH_PATHS[g](c)}
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
/** 上一处/下一处修改跳转（编辑器面包屑） */
export const ChevronUpIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10 8 5.5 12.5 10" {...S} strokeWidth={1.3} /></svg>
);
export const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" {...S} strokeWidth={1.3} /></svg>
);
export const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11L9.5 8.4v4.1l-3 1.5V8.4z" {...S} /></svg>
);
export const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13.2 1.8v3h-3" {...S} /></svg>
);
/** 全部折叠：两枚尖括号竖向朝中间收拢（上朝下 + 下朝上） */
export const CollapseAllIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 3 8 6.5 11.5 3" {...S} strokeWidth={1.3} />
    <path d="M4.5 13 8 9.5 11.5 13" {...S} strokeWidth={1.3} />
  </svg>
);
/** 全部展开：两枚尖括号竖向向两端张开（上朝上 + 下朝下） */
export const ExpandAllIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 6.5 8 3l3.5 3.5" {...S} strokeWidth={1.3} />
    <path d="M4.5 9.5 8 13l3.5-3.5" {...S} strokeWidth={1.3} />
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
/** 删除：垃圾桶形 */
export const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.8 4.2h10.4M6.2 4.2V2.8c0-.44.36-.8.8-.8h2c.44 0 .8.36.8.8v1.4M4.2 4.2l.6 8.6c.03.44.4.8.8.8h4.8c.4 0 .77-.36.8-.8l.6-8.6" {...S} strokeWidth="1.1" />
    <path d="M6.6 6.8v4.4M9.4 6.8v4.4" {...S} strokeWidth="1.1" />
  </svg>
);
/** 剪切：剪刀形 */
export const CutIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="4" cy="12" r="1.7" {...S} strokeWidth="1.1" />
    <circle cx="12" cy="12" r="1.7" {...S} strokeWidth="1.1" />
    <path d="M5.2 10.8 12 1.8M10.8 10.8 4 1.8" {...S} strokeWidth="1.1" />
  </svg>
);
/** 粘贴：剪贴板形 */
export const PasteIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.5 3.2H4.2c-.66 0-1.2.54-1.2 1.2v8.4c0 .66.54 1.2 1.2 1.2h7.6c.66 0 1.2-.54 1.2-1.2V4.4c0-.66-.54-1.2-1.2-1.2h-1.3" {...S} strokeWidth="1.1" />
    <rect x="5.5" y="1.8" width="5" height="2.8" rx="0.7" {...S} strokeWidth="1.1" />
  </svg>
);
/** 固定标签：图钉形（固定态替换 ×，点击取消固定） */
export const PinIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M9.5 1.8 14.2 6.5l-1.6.5-2.8 2.8-.4 3.4-1.5-1.5-3.6 2.5 2.5-3.6L5.3 9.1l3.4-.4L11.5 6z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);
/** 转到符号：大纲行形（缩进条 + 短行） */
export const OutlineIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 3.5h11M5 7h8.5M5 10.5h8.5M8 14h5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
/** 新建文件：文档折角形 + 内嵌加号 */
export const NewFileIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M4 1.8h5.2L12.8 5.4V14a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.6c0-.44.36-.8.8-.8z"
      stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
    />
    <path d="M9 2v3.4h3.4" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M8.4 7.2v4M6.4 9.2h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
/** 新建文件夹：文件夹形 + 内嵌加号 */
export const NewFolderIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.6h5.9c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z"
      stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
    />
    <path d="M8 6.8v3.6M6.2 8.6h3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
