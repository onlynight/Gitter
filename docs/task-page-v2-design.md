# 任务页 v2 设计稿 —— ZCode 交互 × Codex 信息架构

> 状态：设计提案 v2.0（2026-10-07）。**仅设计稿，未动代码**；替代 gitter-fused-preview.html 的任务页部分。
> 可视原型：`docs/task-page-v2-mockup.html`（浏览器直接打开；可点击：工具卡折叠、页签、模式循环、授权编号选项）。
> 裁决：任务页 UI 与操作逻辑**直接照抄 ZCode 与 Codex**，不做原创交互；Gitter 只保留领域语义（worktree 三元组、授权卡 payload、checkpoint 托管、验收台送审）。

## 一、照抄对照表（每一处交互的出处）

| 交互/元素 | 照抄自 | 落地形态 |
|---|---|---|
| 任务列表卡片（状态点+标题+分支+摘要） | Codex Web 任务页 | 左栏卡片，状态点脉冲色语义沿用 Gitter |
| 详情页签 [对话/改动/检查点] | Codex Web（Chat/Diff/Logs） | 改动页签=Diff Review；检查点页签=ZCode rewind 列表化 |
| 居中限宽对话流（单列块流，无气泡） | ZCode CLI | max-width 880px 居中，块间 gap 14px |
| 用户消息渲染（左侧色条引用块） | ZCode `>` blockquote | 绿条 + "▸ 你 · 时间" 小标 |
| 工具调用卡 `⏺ Name(args)` + `⎿ 结果` | ZCode 工具行 | 默认折叠一行（参数截断+耗时），点击展开完整结果；运行中 ⏺ 琥珀脉冲 + tail 4 行 |
| todo 实时清单（☐/◉/☑） | ZCode TodoWrite 渲染 | 对话流内嵌块，随 todo_write 事件整体替换 |
| 授权卡编号选项（❯ 1.是 2.记住 3.总是 4.否） | ZCode 权限提示 | ↑↓+Enter 键盘可选；选项 3 = "总是允许前缀"（写持久规则）；选项文案按 payload.kind 动态 |
| 计划卡（批准三选项） | ZCode ExitPlanMode | [1 批准并执行] [2 批准，逐项确认] [3 继续规划]——选项 2 = 批准+acceptEdits 语义预留 |
| 模式循环（Shift+Tab） | ZCode 模式切换 | ◇规划 → ●默认 → ⚡Yolo → 循环；顶栏与 composer 双 chip 同步 |
| 审批模式概念（Read Only/Agent/Full Access） | Codex CLI approvals | 映射 Gitter plan/default/yolo；`/approvals` 命令同效 |
| 上下文余量条 + "Context low · /compact" 提示 | ZCode 状态行 | composer 右下；>80% 琥珀并提示 /compact |
| turn 用量脚注 `⎡ tokens · 耗时` | ZCode/Codex 每轮 footer | turn-completed 事件渲染 |
| checkpoint 回滚（Esc×2） | ZCode rewind | 检查点页签 + 双 Esc 快捷打开；回滚=worktree reset，历史保留 |
| 排队消息显示（⏳ queued） | ZCode 排队输入 | composer 上方 amber 行 + 任务卡计数 |
| @ 文件补全 / / 命令菜单 | ZCode 输入台 | composer 内浮层；/ 菜单分组"内置 / 包命令(agent.command)" |
| 图片粘贴即附件 | ZCode/Codex 通用 | 附件条（模型不支持多模态时 toast 拒绝） |
| Diff Review（文件列表+unified diff+逐文件操作） | Codex IDE/PR review | 改动页签；[还原此文件]=回到基线（Gitter 语义） |
| 子代理嵌套折叠 | ZCode Agent 工具渲染 | 父流内折叠块，展开只读子时间线 |

**明确不抄**：ZCode 的终端 TUI 质感（按 GUI 控件落地，只取交互）；Codex 云端的环境/容器管理（Gitter 是本地 worktree 模型）；Codex best-of-N 并行草稿（不在本期）。

## 二、信息架构

```
┌───────────┬──────────────────────────────────────────────┐
│ 任务列表    │ 工具条：状态chip(●+耗时) · 分支 · [送验收][新窗口]（停止在 composer） │
│ 300px     ├──────────────────────────────────────────────┤
│ Codex 卡片 │ 页签：对话 | 改动 n | 检查点 n                       │
│ 状态点     ├──────────────────────────────────────────────┤
│ 标题       │ 对话页：居中 880px 块流（§三）                        │
│ 分支·时间  │ 改动页：文件树 250px + unified diff + 逐文件操作（§五）  │
│ 摘要       │ 检查点页：cp 列表 + 回滚（§六）                        │
│           ├──────────────────────────────────────────────┤
│ [+新任务]  │ 状态行：●当前工具+耗时 · ⏳排队 n · 子代理 n/3 · 键位提示 │
│           │ Composer：菜单浮层 + 输入区 + [模式|模型|@|🖼|context|发送]│
└───────────┴──────────────────────────────────────────────┘
```

- 左栏固定 300px；对话页独占滚动；改动/检查点页签各自滚动。
- 任务卡四态点：working（绿脉冲）/ plan（紫，等待计划批准）/ done（灰）/ err（红）；第二行显示 branch（mono 青）+相对时间+排队数；第三行 lastMessage 摘要。
- 双击卡片 = 新窗口打开该 worktree；点击 = 右栏选中。

## 三、对话块模型 v3（时间线）

块类型与折叠规则（顺序即时间序，assistant 流式 md 合并规则沿用现实现）：

| 块 | 触发事件 | 折叠策略 | 渲染要点 |
|---|---|---|---|
| user | 用户输入/排队注入/技能注入 | 不折叠 | 绿条引用块；排队注入标注"工作期间补充" |
| assistant | output(assistant) | 不折叠 | markdown（html 关闭）；代码块双击复制 |
| tool | tool start/end 配对 | **默认折叠一行** | `⏺ Name(参数摘要) · 耗时`；⎿ 结果缩进（≤4 行截断）；error 红 ⏺；source 徽标 [MCP]/[插件] |
| file-change | file-change | 不折叠 | mini 卡 `path +N −M [查看]`→跳改动页签选中该文件；read-image → 图片预览 |
| todo | todo | 整体替换（只显示最新） | ☐ pending / ◉ in_progress(高亮) / ☑ done(删除线) |
| permission | permission | 不折叠，阻塞 | §四 编号选项卡 |
| question | question | 不折叠 | 同授权卡形态（选项 + 自由输入） |
| plan | plan | 不折叠，阻塞 | 紫框；批准选项同 §四 编号式 |
| checkpoint | checkpoint | 单行 | ✔ sha 摘要 · "Esc×2 回滚" 提示 |
| subtask | subtask + 子事件归组 | 折叠 | `▣ name(mode·state)`；展开=子块只读回放 |
| turn foot | turn-completed | 单行 | `⎡ turn #n · tokens · 耗时 · context %` |
| log | log | 连续 ≥3 折叠为"显示 n 条日志" | 展开平铺 |

## 四、授权卡 / 计划卡 / 提问卡：编号选项交互（照抄 ZCode）

- 选项列表垂直排布，`❯` 指示当前项；**↑↓ 移动、Enter 确认、数字直选**；鼠标点击等价。
- 授权卡选项生成规则（按 payload.kind 与 rememberable）：
  1. 是，执行一次
  2. 是，本会话不再询问（仅 rememberable）
  3. 是，总是允许前缀 `<签名前缀>`（写持久规则，仅 session 级工具）
  4. 否，告诉 agent 改用其他方式
- 卡体：kind 徽标 + 风险条（commandRisk：high 红/medium 琥珀）+ 命令 mono 块 + 文件清单（stage/commit）+ diff 摘要。
- 决定后卡片定格为已选状态（✓/✕ 灰化），不消失（审计留痕）。
- 计划卡：plan 正文 markdown + [1 批准并开始执行] [2 批准，执行时逐项确认] [3 继续规划（附修改意见输入）]；批准 1/2 均切 default（2 预留 acceptEdits 档）；修订 = ok:false + 意见。
- 授权/提问/计划卡出现时 composer 不禁用（可排队）。

## 五、改动页（独立页 · Codex Diff Review × Gitter 语义）

页面头（本页专属，无对话元素）：任务分支 · 变更统计 · [在 Changes 中打开] [全部送验收] [复制 diff]。其余：

- 左文件树 250px：状态字母 M/A/D（琥珀/绿/红）+ mono 路径 + ±统计；点击加载右侧 diff。
- 右侧：文件头（路径 + [在 Changes 中打开][还原此文件][复制]）+ unified diff（复用 DiffView，绿红底纹按行）。
- 逐文件操作语义：**还原此文件** = checkout 基线版本（Gitter 的"接受方向"与 Codex 相反——Codex 是接受 AI 改动，Gitter 默认改动已生效、人可逐文件否决）；整体接受走"送验收"（新窗口 Changes 验收台）。
- 顶部：对比基线切换（会话基线 / 某checkpoint）+ [全部送验收] [复制 diff]。

## 六、检查点页（独立页 · ZCode rewind 列表化）

页面头（本页专属）：任务分支 · 托管提交计数 · Esc×2 提示。其余：

- cp 行：`sha · 摘要 · 时间 · ±统计` + [查看该轮 diff]（右栏内嵌 diff）+ [回滚到此处]。
- 回滚 = `reset --hard <sha>`（任务 worktree，each-time 确认卡）；消息历史保留，注入 "已回滚至 cp xxx" 提醒可续跑。
- 快捷：**Esc Esc**（双击，500ms 内）从任意页签跳检查点页并高亮最近 cp。

## 七、Composer（输入台，ZCode 交互全集）

| 行为 | 触发 | 说明 |
|---|---|---|
| 发送 / 停止（合一） | 同一图标按钮 | **仅图标无文字**：idle 显示 ➤ 发送（Ctrl+Enter 同效），working 变 ⏹ 停止（点击=中断，Esc 同效）；挂起授权全部按拒绝结算。工具条不再放独立停止按钮 |
| 回滚 | Esc Esc | 打开检查点页 |
| 模式循环 | Shift+Tab / 点 chip | plan→default→yolo→…；下一轮生效 |
| / 命令菜单 | 输入 `/` | 分组：内置（数据化表）+ 包命令（`<pkg>:<slash>`）；↑↓+Enter 补全 |
| @ 提及菜单 | 输入 `@` / 注册前缀 | 文件（repo.files 模糊）+ 插件 provider 合并；选中插入路径 |
| 图片 | 粘贴/拖拽 | 附件条缩略图；多模态校验 |
| 输入历史 | ↑ / ↓ | 本地 20 条（无换行时） |
| 排队 | working 中发送 | 进 queued，"⏳ 排队 n"提示，轮边界自动注入 |
| 上下文条 | 常显 | est/budget；>80% 琥珀 +"Context low · /compact"；>92% 红 |
| 状态行 | working 中常显 | 当前工具+耗时 · 排队 n · 子代理 n/3 · 键位提示 |

## 八、键位总表

| 键 | 作用 |
|---|---|
| Ctrl+Enter | 发送 |
| Esc | 中断当前轮（拒绝挂起授权） |
| Esc Esc | 打开检查点页（回滚） |
| Shift+Tab | 权限模式循环（plan→default→yolo） |
| ↑ / ↓ | 输入历史；授权卡选项移动 |
| Enter | 授权卡/计划卡确认当前选项；菜单补全 |
| 数字 1–4 | 直选授权卡选项 |
| Ctrl+N | 新任务 |

## 九、状态与空态

- 空任务列表：左侧引导卡"＋ 新任务"+ 三条示例 prompt（可点击填入）。
- 模型未配置：顶栏 chip 变红"模型未配置 → 设置"，composer 禁用但对话历史可读。
- await-permission：状态 chip 琥珀"待确认"，授权卡滚动置顶（自动 scrollIntoView）。
- failed/interrupted：卡片红/琥珀点；composer placeholder 变"重试/继续（Esc 已重置）"。

## 十、验收清单（对照 mockup）

1. 工具卡默认折叠一行，点击展开/收起；运行中实时 tail 可见；
2. 授权卡四个编号选项 ↑↓+Enter 可选，选择后定格且结果回给 agent；
3. 计划卡三选项批准后模式 chip 变 default；
4. Shift+Tab 循环三模式，顶栏与 composer 双 chip 同步；
5. todo 块整体替换且 in_progress 高亮；
6. @ 与 / 菜单浮层正确弹出与补全；包命令以 `<pkg>:` 前缀分组出现；
7. 改动/检查点为完全独立页：切页后不出现对话工具条与 Composer，页面头操作齐备；逐文件还原与送验收可达；检查点页 Esc×2 可达且回滚带确认；
8. 上下文条 80%/92% 两档变色并提示 /compact；
9. 排队消息在 composer 上方显示计数并在轮边界注入（时间线可见"工作期间补充"）；
10. 所有块在窄窗口（<1100px）不横向溢出。

## 十一、配色规范（修订：选中一律黑白灰、双主题、两档柔和）

- **选中/聚焦系统一律黑白灰，不用蓝/青**：任务卡选中边框、composer 聚焦边框、文件树选中项、授权/计划卡选项光标 ❯、上下文用量条、发送键、菜单键名——全部走 `--sel / --sel-fg` 两个变量。
- **两档柔和原则**：选中色在各自主题下取"中间档"灰阶——暗色不用纯白（刺眼）、亮色不用纯黑（刺眼），可再按观感微调 ±10%。
- **双主题取值**：
  | 变量 | 暗色 | 亮色 |
  |---|---|---|
  | `--sel`（选中边框/聚焦框） | `#b9c0c8` 中灰（近白过刺眼，已调暗） | `#4a5158` 中深灰（近黑过刺眼，已调亮） |
  | `--sel-fg`（反色键前景，如发送键文字） | `#101216` | `#f5f6f7` |
  | 发送键 | 中灰底 + 深字 | 中深灰底 + 浅字 |
- **语义色保留**（不用于选中）：绿=用户/成功、红=错误/高危、琥珀=等待/注意/运行中、紫=工具调用/计划卡——双主题下各自加深一档保证对比度（如 green #7ee787→#1a7f37）。
- **中性灰阶**：背景/面板/边框/文字三层灰阶双主题各一套（暗 `#101216/#171a20/#2a2f38/#d7dde5`，亮 `#f5f6f7/#ffffff/#d9dde2/#17191c`）；分支名/sha 等原本的青色装饰一并收敛为中性灰。
- 主题切换：顶栏"外观：暗/亮"chip，`body.light` 类切换变量（实现期映射到既有主题框架）。

## 十二、实现映射备注（给实现者，非本期）

- 块模型直接复用现有 evMap/reduceBlocks（tool/todo/plan/subtask 块已存在），本次主要改**渲染形态**（折叠策略、编号选项、居中限宽）与 **composer**（菜单、模式循环、状态行）；
- 授权卡选项 3（总是允许前缀）= 现有持久规则引擎的"写规则"入口（agentRules + 前缀签名），无新协议；
- Esc×2/数字直选/Enter 确认为纯前端键盘处理，无新 RPC；
- 渲染器仍走 agentUIRegistry（§14.6）：本设计的十类内置渲染器即"宿主缺省提供者"，包可替换展示型块。
