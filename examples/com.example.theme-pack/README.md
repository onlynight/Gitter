# theme-pack

L1 主题包：亮/暗双档 + `acrylic` 窗口材质。

## 演示要点

- 多主题包（`contributes.themes` 两项）→ 每项**必须有唯一 `id`** 且 `base` **一亮一暗**
  （zod `superRefine` 强制，违反则整包 error）
- `material` 在 **manifest 层优先**于主题文档层
- `tokens` 令牌名必须与 `TokenKey` 枚举一致（未知键不影响宿主，只是不生效）
- `syntax` 覆盖声明式高亮引擎的配色

## 主题文档结构

```jsonc
{
  "id": "theme-pack.dark",       // 主题文档 id（可被 settings.themePackageId 引用）
  "name": "暗夜蓝",
  "base": "dark",                // 与 manifest 的 base 对应；运行时按 fallbackBase 挑选
  "inherits": null,              // 指向另一个主题包的 id，形成继承链
  "material": "acrylic",         // 文档级材质（manifest 层优先）
  "tokens": { "Base": "#...", "Accent": "#..." },   // 8-24 位 hex（支持 #RRGGBBAA 透明）
  "syntax": { "keyword": "#..." }
}
```

## 材质

`material ∈ "none" | "mica" | "acrylic"`，是**窗口效果的唯一事实源**：

| 材质 | 效果 |
|---|---|
| `none` | 不透明（主进程把 `Base` 压平为窗口底色） |
| `mica` | Windows 11 Mica |
| `acrylic` | Windows 11 Acrylic（本示例） |

## 透明度策略（重要）

模糊窗口下 CSS 原生支持 8 位 hex。暗色档**必须暗色主导**：
亮壁纸 / 系统亮色 DWM 底下，低透明度会把暗色洗成中灰、文字失效。
参照内置 `theme.gitui.acrylic`：暗色 `Base` 约 40% 透明，亮色约 58%。

## 令牌清单

```
Base  Panel  Panel2  Hover  Selected  Border  BorderStrong
Accent  AccentHover  AccentPressed  AccentSoft  OnAccent
Text  Text2  Text3  Link  Green  Red  Amber
ChipBlueBg  ChipBlueFg  ChipPurpleBg  ChipPurpleFg
```

`Panel2` 与 `Link` **必须在基座缺省里存在**——第三方主题包不携带这两个键，
样式层依赖回退（`BUILTIN` 提供兜底）。

## 安装后

设置 → 外观 → 主题 里会出现「示例主题（暗夜蓝）」，亮/暗随系统切换。
