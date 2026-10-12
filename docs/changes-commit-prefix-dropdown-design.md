# 变更页:提交类型前缀收进图标下拉

> 状态:**已落地**(2026-10-12,web tsc 通过;视觉/交互经 web/harness/changes.html 验收——亮/暗双主题、点选插入、非空无操作、↑↓/Enter/Esc/点击外部关闭全过) · 范围:仅变更页提交框前缀行,行为语义不变
> 原型:[../design/changes-commit-prefix-dropdown-mockup.html](../design/changes-commit-prefix-dropdown-mockup.html)(交互式:点图标钮开菜单,可键盘操作,亮/暗双主题)
> 上游:无(独立小改) · 关联惯例:任务页 v3.3 同款「低频操作收进下拉」思路
> 落地备注:smoke-ui-pages 无前缀 chips 断言,无需同步;页面包产物(gitui.page.changes/page.js)随 build-pages 重建即可。
> 裁决:
> 1. **触发钮留在前缀行左端**(prefix-row 原位),不挪底部操作行、不悬浮进 textarea——改动面最小,行高不变。
> 2. **行为语义不变**:仅当消息为空时插入「前缀 + 空格」,非空不动文本(与现 chips 完全一致)。
> 3. 菜单**向上弹**——提交框贴窗口底缘,向下弹会被 textarea/操作行截断。
> 4. **不扩类型清单**:仍是现 6 项(feat/fix/docs/test/build/chore),refactor/perf/ci/style/revert 不在本期(见「不做」)。

---

## 一、背景与现状

变更页提交框上方常驻一行 6 枚前缀 chips(feat: / fix: / docs: / test: / build: / chore:),用于往空消息里插入提交类型前缀。问题:

- **常驻占一行**:低频操作(多数提交手敲或 AI 生成,前缀只是辅助)却永久占据提交框首行 ~28px;窗口窄时 6 枚 chips 折行,顶到两行。
- **视觉噪音**:一排 mono 胶囊和右侧 AI 生成钮争夺注意力,提交框头部显得杂乱(见用户截图红框)。
- **信息量低**:chips 只有裸前缀,不熟悉 Conventional Commits 的用户不知道 feat/chore 各是什么意思。

现状代码:

- `web/src/pages/ChangesPage.tsx:12` — `const PREFIXES = ["feat:", "fix:", "docs:", "test:", "build:", "chore:"]`
- `web/src/pages/ChangesPage.tsx:750-759` — `prefix-row` 渲染 6 枚 `prefix-chip` + AI 生成钮;点击 chip 仅当 `m.trim()` 为空时 `setMessage(p + " ")`
- `web/src/styles.css:1416-1424` — `.commit-box .prefix-row` / `.prefix-chip` 样式

## 二、方案

### 2.1 结构变化

```
变更前                                  变更后
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ [feat:][fix:][docs:][test:]  │      │ [◉▾]              [✦]       │ ← 图标钮 + AI 生成
│ [build:][chore:]      [✦]   │  ⟶   ├──────────────────────────────┤
├──────────────────────────────┤      │ (AI 块提示行,如有)           │
│ 提交信息(Ctrl+Enter 提交)    │      │ 提交信息(Ctrl+Enter 提交)    │
├──────────────────────────────┤      ├──────────────────────────────┤
│ 将提交 0 个文件      [✓提交] │      │ 将提交 0 个文件      [✓提交] │
└──────────────────────────────┘      └──────────────────────────────┘

                                        点 [◉▾] 向上弹菜单:
                                        ┌────────────────────────┐
                                        │ feat:          新功能  │
                                        │ fix:          缺陷修复  │
                                        │ docs:             文档  │
                                        │ test:             测试  │
                                        │ build:      构建与依赖  │
                                        │ chore:        杂项维护  │
                                        │ ────────────────────── │
                                        │ 仅空消息时插入 · Esc 关闭 │
                                        └────────────────────────┘
```

前缀行从「6 chips + AI 钮」变为「1 图标钮 + AI 钮」,**行高不变**(24px 图标钮),无净增高。

### 2.2 触发钮

- 复用 `.icon-btn`(24×24、透明底、text3、hover 变 hover 底 + text 色),与同排 AI 生成钮、顶栏 fetch/pull/push 钮同款。
- 图标:`TlIcon name="commit"`(提交节点圆环,13px,取自 taskIcons.tsx 现有图标,无需新增路径)+ 右侧 9px `chevron-down`(表示可下拉,hover 时同显)。
- tooltip:`data-tip = t("Changes_PrefixMenu")`「提交类型前缀」。
- `aria-haspopup="menu"`、`aria-expanded` 随开合切换。

### 2.3 菜单

- 弹层样式对齐 kit/Select.tsx 的 `.select-pop` token:panel2 底、border-strong 边、6px 圆角、`0 8px 20px` 投影、4px 内边距;**定位向上**(`bottom: calc(100% + 6px); left: 0`),宽 218px。
- 6 个菜单项,每项 = mono 前缀(11.5px,text 色)+ 中文释义(11px,text3,右对齐):

| 前缀 | 释义 | i18n key |
|---|---|---|
| `feat:` | 新功能 | `Changes_PrefixFeat` |
| `fix:` | 缺陷修复 | `Changes_PrefixFix` |
| `docs:` | 文档 | `Changes_PrefixDocs` |
| `test:` | 测试 | `Changes_PrefixTest` |
| `build:` | 构建与依赖 | `Changes_PrefixBuild` |
| `chore:` | 杂项维护 | `Changes_PrefixChore` |

- 菜单底部细线分隔 + 一行灰字提示 `Changes_PrefixMenuHint`「仅空消息时插入 · Esc 关闭」——现 chips 对非空消息静默无操作,用户不可知,菜单里说清楚。
- `role="menu"` / `role="menuitem"`;无持久选中态(这是插入动作,不是单选值)。

### 2.4 行为(与现 chips 逐条对齐)

| 交互 | 行为 |
|---|---|
| 点菜单项 | `message.trim()` 为空 → `setMessage(pfx + " ")`;非空 → 不动文本。随后关菜单、焦点回 textarea、光标置末尾 |
| 点触发钮 | 开/关菜单(开时首项聚焦) |
| ↑ / ↓ | 高亮循环移动(焦点在触发钮或菜单项上均生效) |
| Enter | 选中当前高亮项 |
| Esc | 关菜单,焦点回触发钮 |
| 点击外部 | 关菜单 |
| AI 块提示 / 插入互斥 | 与现状一致:消息非空(AI 已生成或已手敲)时插入为无操作,不覆盖 |

不做防抖/动画(dur-fast 淡入可选,非必须);菜单开合不阻塞文件列表交互(点击外部即关)。

## 三、落地清单(评审通过后执行)

1. **`web/src/pages/ChangesPage.tsx`**
   - `PREFIXES`(L12)改为 `PREFIX_ITEMS: { pfx: string; descKey: string }[]`。
   - `prefix-row`(L751-754)6 枚 chip 替换为触发钮 + 向上弹层(组件内新增约 60 行,局部 state:open/hi;点击外部关闭用现有 document 监听模式或 ref 外点检测)。
   - 其余(AI 生成钮、textarea、commit-actions)零改动。
2. **`web/src/styles.css`**
   - 删 `.prefix-chip` 三条规则(L1418-1424);`.commit-box .prefix-row`(L1417)保留。
   - 增 `.prefix-pop` / `.pitem` / `.pop-hint`(对齐 `.select-pop` token,约 25 行)。
3. **`app/resources/Strings.tsv`** 增 8 词条:`Changes_PrefixMenu`(en "Commit type prefix" / zh "提交类型前缀")、`Changes_PrefixMenuHint`("Inserts only when the message is empty" / "仅空消息时插入 · Esc 关闭")、上表 6 个释义词条。i18n 缺词回退 key id,需与源补齐流程(参见 ef31d86)同步。
4. **冒烟**:`smoke-ui-pages.ts` 若有前缀 chip 断言需同步(渲染结构变化);手动验证亮/暗两主题下弹层对比度与投影。

## 四、不做(本期)

- **扩类型清单**(refactor:/perf:/ci:/style:/revert:):菜单有释义位,后续加只需 Strings.tsv + PREFIX_ITEMS 各一行,本期不动语义。
- **光标处插入 / 二次插入**:现语义是「仅空消息打底」,保持;若日后要支持中途改前缀,另立稿。
- **与 AI 生成钮合并成一个「更多」菜单**:两者语义不同(插入模板 vs 异步生成),合并会增加一次点击成本,不合并。
- 触发钮悬浮进 textarea 右上角(省一行的替代方案):与 focus 环、resize 手柄相互干扰,收益 < 复杂度,不采纳。
