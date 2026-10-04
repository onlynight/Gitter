# 主题框架方案（亮暗抽象 · 令牌中枢 · 主题包）

> 状态：设计稿（未实施）
> 日期：2026-10-04
> 关联：`extension-package-framework.md`（.gpk 包容器与生命周期）、`code-highlight-framework.md`（语法令牌消费方）、`command-palette-v2.md` §五（亮色映射表）
> 设计目标：**亮暗主题抽象出来**（消灭散落的硬编码色值）→ **主题框架**（运行时令牌中枢，包主题可注入）→ **主题可单独打包**（.gpk theme kind）

---

## 一、现状与问题

| 现状 | 问题 |
|---|---|
| `Themes/ThemeStyles.xaml`：Light/Default 两套 ThemeDictionaries（约 100 个框架键覆盖 + 4 个隐式控件样式） | 只覆盖框架控件；新语义色（Chip/Diff/语法）进不来，包主题更进不来 |
| `UiKit.cs`：`IsLight ? 深色ARGB : 亮色ARGB` 的静态画刷 | **令牌双份维护**（XAML 一份、C# 一份），且是编译期常量——运行时换主题包无法注入 |
| 各页面 `RowSelectedBrush`/`LineBrush` 等私有静态画刷 | 第三份散落色值 |
| `ApplyTheme` 启动路径不生效（settings theme=1 启动仍深色） | 已知缺陷，亮色为一等主题前必须先修 |
| DiffCanvas / TerminalCanvas 内部硬编码色 | 图形画布脱离令牌体系 |

结论：需要**一层运行时令牌中枢**，把"颜色的名字"（语义令牌）与"颜色的值"（主题包提供）解耦；亮与暗只是两个内置主题包。

## 二、总体架构

```
                    ┌────────────────────────┐
 settings.json      │   ThemeService          │
 themePreference ──▶│  (选包/应用/变更通知)     │
 themePackageId ──▶ │   │                     │
                    │   ▼                     │
 ExtensionHost ────▶│ TokenRuntime（令牌中枢） │──▶ UiKit（外观，调用点不变）
 注册的 theme kind  │   Light主题 Dark主题      │──▶ ThemeDictionaries（框架键合成）
 包提供 overrides   │   继承链解析             │──▶ DiffCanvas/TerminalCanvas
                    └────────────────────────┘
```

三层模型：

1. **原始色板（Palette）**：一串编号色（`blue600`、`gray850`…），一个主题的基础材料
2. **语义令牌（Semantic Token）**：界面真正引用的名字（`Panel`、`Accent`、`Text2`…），由色板映射而来
3. **主题（Theme）**：= 基座（dark/light）+ 稀疏覆盖。`inherits` 指向内置基座，未覆盖的令牌沿继承链取值——第三方主题通常只需覆盖 10~20 个令牌

## 三、语义令牌目录（ThemeTokens，单一事实来源）

把现在散在 UiKit / ThemeStyles / 页面私有画刷里的颜色全部收编为语义令牌（首批约 40 个）：

```
面层    Base Panel PanelSubtle Hover Selected Border BorderStrong
文字    Text Text2 Text3 OnAccent
强调    Accent AccentHover AccentPressed AccentSoft
语义    Green Red Amber
徽标    ChipBlueBg ChipBlueFg ChipPurpleBg ChipPurpleFg
Diff    DiffAddBg DiffDelBg DiffAddFg DiffDelFg DiffContextBg
编辑器  EditorBg LineNumber SelectionHighlight Syntax.*（见高亮文档 §三）
终端    TermPalette.0..15（TerminalCanvas 的 ANSI 16 色）
```

规则：

- 令牌目录**冻结新增流程**：新令牌 = 加枚举 + 两个内置主题各给值 + 文档补一行
- 控件模板/页面**只允许引用语义令牌**，不允许出现字面颜色（验收：`grep -rn "Color.FromArgb\|Colors\." src/` 仅剩 TokenRuntime 与少量测试）

## 四、运行时设计

### 4.1 TokenRuntime（令牌中枢）

```csharp
public sealed class TokenRuntime {
    public SolidColorBrush Brush(TokenKey key);      // 高频：内部缓存，主题切换时整体失效
    public Color Color(TokenKey key);
    public event Action? ThemeChanged;               // 一次性广播，各页面 Rebind
}
```

- **UiKit 变为外观**：`Ui.Panel` 实现改为 `TokenRuntime.Brush(TokenKey.Panel)`——全部调用点零改动，但值来自活动主题
- 页面私有静态画刷（`RowSelectedBrush` 等）同样改查 TokenRuntime（令牌名 `RowSelected`）
- `ActualThemeChanged`/`ThemeService.Changed` → 页面 Rebind → 重新取画刷（现有机制已具备）

### 4.2 内置主题 = 包格式自举

深、浅两个内置主题改用与外部包**完全相同的 theme.json 格式**，编译为内嵌资源、经 ExtensionHost 注册（`extension-package-framework.md` §二）。此后"内置"与"第三方"在代码里无区别。

`theme.json`（theme kind 内容，稀疏覆盖示例）：

```json
{
  "id": "gitui.theme.dark",
  "name": "深色",
  "base": "dark",
  "inherits": null,
  "palette": {
    "gray900": "#1E1F22", "gray800": "#2B2D30", "gray700": "#393B40",
    "gray650": "#43454A", "blue500": "#3574F0", "textHigh": "#DFE1E5"
  },
  "tokens": {
    "Base": "gray900", "Panel": "gray800", "Hover": "gray700",
    "Selected": "gray650", "Border": "#2E3033", "BorderStrong": "gray650",
    "Accent": "blue500", "Text": "textHigh", "Text2": "#9DA0A8", "Text3": "#6F737A",
    "ChipBlueBg": "#334C7DD4", "DiffAddBg": "#143A6E41"
  },
  "syntax": {                       // 语法令牌（高亮文档 §三 消费）
    "keyword": "#569CD6", "string": "#6A9955", "comment": "#6A9955",
    "number": "#B5CEA8", "type": "#4EC9B0", "function": "#DCDCAA"
  }
}
```

亮色基座同构（值取自 `command-palette-v2.md` §五 亮色映射表 + 亮色设计稿）。

### 4.3 应用路径（两段式）

1. **C# 侧（语义令牌）**：ThemeService 解析包 → 继承链合并（基座 → 覆盖）→ TokenRuntime 换表 + 广播。UiKit/页面/画布自动跟随。
2. **XAML 侧（框架键）**：把令牌映射到**已知框架键集合**（`TextControlBackground`、`ComboBoxBackground`、`ButtonBackground`…即 ThemeStyles 现有覆盖清单），在 C# 里构建 `ResourceDictionary`（SolidColorBrush）插入 `Application.Resources.MergedDictionaries[0]`，控件模板的 `{ThemeResource …}` 自动重取。
   - **红线**：只写值、绝不注入新键或改模板结构——这是 0xC000027B 教训的边界（extension-package-framework.md §八）

### 4.4 亮暗切换与已知缺陷修复

- `ThemePreference`（System/Light/Dark）继续决定**基座**；`themePackageId` 决定基座之上的覆盖包（包自身声明 `base: dark|light`，包只能覆盖其基座声明的底色族，避免"暗包配亮系统"错乱）
- **前置缺陷修复纳入本期 Phase 0**：启动路径 `ApplyTheme` 在窗口内容挂载前调用（现仅在设置页切换路径生效）。验收 = settings theme=1 冷启动即为浅色

## 五、与各消费端的衔接

| 消费端 | 改动 |
|---|---|
| UiKit | 静态画刷 → TokenRuntime 外观；`Mono` 字体等非颜色常量保留 |
| 页面私有画刷 | 删除，改查令牌（`RowSelected`、`Section`、`Divider`） |
| ThemeStyles.xaml | 保留框架键覆盖结构作为**默认值来源**；运行时被 4.3-2 动态字典覆盖 |
| DiffCanvas | `DiffAddBg/DiffDelBg/DiffAddFg/DiffDelFg` 令牌（现为硬编码） |
| TerminalCanvas | `TermPalette.0..15` 令牌 + 随主题明暗切换 |
| 命令面板 | 已走 `Ui.*`，自动受益 |

## 六、分阶段计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 修复浅色启动不生效 | theme=1 冷启动即浅色 |
| P1 | TokenRuntime + 令牌收编（UiKit/页面/画布全部走令牌）；ThemeStyles 保留为默认值源 | `grep "IsLight ?"` 为 0；三页冒烟全绿；深浅切换 UIA 冒烟通过 |
| P2 | theme.json 格式 + ThemeService + 框架键动态字典；内置深浅改内嵌包自举 | 手改内置包 JSON 重启可见变化；亮暗冒烟通过 |
| P3 | 设置页主题选择器（列出 ExtensionHost 注册的主题包）+ 导入 .gpk | 安装一个第三方主题包（只覆盖 Accent+Panel）即时生效 |

## 七、验收标准

1. 亮暗抽象完成：源码无 `IsLight ?` 三元取色、无页面级字面色
2. 内置深/浅主题以 theme.json 包形态存在，行为与现状一致（三页冒烟 + 命令面板冒烟全绿）
3. 第三方主题包：只含 `theme.json`（≤20 个覆盖令牌）即可安装生效、禁用即回退默认、损坏不闪退
4. 语法令牌随主题（深浅两套语法配色，见高亮文档 §三）

## 八、风险

| 风险 | 对策 |
|---|---|
| 框架键动态字典在部分控件上不即时刷新 | 框架键集合来自现网已验证的覆盖清单；每次主题切换后走一遍 UIA 三页冒烟 |
| 令牌收编遗漏（某处硬编码漏网） | P1 验收用 grep 断言 + Diff/终端页人工对比截图 |
| 包主题与系统主题偏好冲突 | 包声明 `base`；`ThemePreference.System` 时按系统明暗选同基座包，不匹配的包置灰 |
