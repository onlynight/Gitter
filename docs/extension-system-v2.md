# 插件系统 v2 方案（成熟开源组件组合，非自造框架）

> 状态：✅ 完工并审计归零（2026-10-06）—— 36 条接缝全部开缝，可选后续三项收口，且完成系统性完工审计（scripts/audit-completion.py：渲染层 RPC 引用 vs 宿主注册 0 缺失 / i18n 引用 vs 词条 0 缺失 / TODO 0 残留），并补齐第二轮深度审计发现的缺口：L2/L3 信任门设置开关（allowCodePlugins / externalMcpEnabled，切换即时生效）、按 kind 启停 UI（extensions.setKindEnabled 接入设置页 chips）、L2 ctx 补齐 §16.2 承诺的 registerLoop / registerAiProvider 两动词（含注销清理 + 冒烟）、agent.stream 流式缓冲条可视化。八套冒烟 + boot 真启动全绿
> 默认内置包（2026-10-05 起随应用分发，`app/resources/packages/`，生成器 `scripts/gen-default-packages.mjs` 幂等可重现）：
> `gitui.theme.dark`/`gitui.theme.light`（v1 迁移 v2 + tokenColors 随包，旧 `resources/themes/GitUI.theme.*` 已移除）、
> `tm.one-dark-pro`/`tm.dracula`/`tm.nord`/`tm.github-light`/`tm.solarized-light`（tm-themes 策展 wrapper 包，tokenColors 原样随包）、
> `gitui.tools.git`（L1 受限命令示例：rev-list --count / fetch --prune / git gc，经 terminal.run 白名单动作）。
> 语法不设默认语法包：tm-grammars 为 GrammarService 引擎内置数据（260 语言），与扩展包分层。
> 日期：2026-10-05
> 背景：WinUI3→Web 迁移后，v1 扩展框架（extension-package-framework.md）只剩主题目录扫描；高亮退化为内置 5 语言死 JSON；生命周期/脚本宿主/命令扩展全部缺位。
> 关联：`extension-package-framework.md`（v1，数据格式延续）、`code-highlight-framework.md`（声明式引擎降级为回退层）、`theme-framework.md`（theme.json 格式兼容）、`winui3-to-web-migration.md`（§12.3 语法终局决策门，本方案即该门的裁决）、`agent-harness.md`（agent harness v3.0：**Gitter 自身即 agent 运行时**，§十五/P4.5 的完整化与任务卡宿主壳；`agent-harness-codex.md` 的"外部 CLI 宿主"方向已废止，catalog/manifest 机制封存为未来外部桥扩展点）
> 设计哲学：**每一层用现成的成熟开源件，Gitter 只写领域胶水**；数据包先行，代码插件最后；信任分级，进程内只放受信代码。

---

## 一、目标与非目标

**目标**：
1. 语法高亮接入 TextMate 生态：开箱 200+ 语言，第三方语法包可直接安装（迁移文档 §12.3 决策门的落地）
2. 统一 PackageStore：manifest 校验、.gpk 导入、按 kind 启停、卸载、错误呈现——把 v1 C# 栈 P1/P2 已验证的能力在新栈补齐
3. 行为扩展点：命令贡献点 + 配置 schema 自动设置 UI
4. AI 能力面开放：标准 MCP 双向接入，AI 后端成为可替换接缝
5. 第三方代码插件有隔离边界（进程级），权限可见

**非目标（本期不做）**：在线市场/自动更新（用 GitHub topic + 目录站替代）；兼容 VS Code 扩展 API 全集（只借贡献点模型与数据格式）；插件间显式依赖图；跨平台（沿用 Electron Windows 优先）。

## 二、信任分级（贯穿全文的架构约束）

| 级别 | 形态 | 运行位置 | 适用 kind |
|---|---|---|---|
| L0 纯数据 | JSON（主题/语法规则） | 解析即用，坏包跳过 | theme、grammar |
| L1 声明式贡献 | manifest contributes 段 | 宿主代为执行，插件无代码 | commands(受限)、configuration |
| L2 受信代码 | npm/本地 JS 模块 | **主进程内** activate/dispose | commands(完整)、ai-provider、agentLoop 内置实现（第一方/审核过的包） |
| L3 隔离代码 | 任意 JS | **utilityProcess 子进程** + RPC | 第三方 code 插件、第三方 agentLoop |
| 外部进程 | MCP server | 独立进程，stdio/HTTP | mcp-server（本质是配置引用，不装载代码） |

原则：L0/L1 不需要任何插件框架；L2 的宿主契约小到不值得引框架（见 §六）；L3 才是真正需要"沙箱+RPC"工程量的地方，放在最后。

## 三、总体架构

```
┌────────────────────────── Electron 主进程 ──────────────────────────┐
│  PackageStore（统一扩展宿主，本项目唯一自写内核，目标 <500 行）        │
│   扫描 → zod 校验 → semver engines 检查 → 按 kind 注册 → 启停/错误账本 │
│      │                │                    │                │        │
│  ┌───▼────┐   ┌───────▼────────┐   ┌──────▼─────┐   ┌──────▼─────┐  │
│  │ThemeSvc│   │ GrammarSvc     │   │ CommandReg │   │ AI/MCP 接缝 │  │
│  │(现有,扩)│   │ vscode-textmate│   │ (新增Map)  │   │ @mcp/sdk   │  │
│  └────────┘   │ +oniguruma(WASM)│  └───────────┘   └────────────┘  │
│               └────────────────┘                                   │
│  PackageHost（P5，utilityProcess）：comlink RPC + 权限门            │
├──────────────────────── preload bridge（现有，不变）─────────────────┤
│  web/ 渲染层：DiffView 消费 TokenRun[]（契约不变）                    │
│  SettingsPage「扩展」卡片（列表/启停/导入/卸载/错误原因）              │
└─────────────────────────────────────────────────────────────────────┘
```

## 四、技术选型（全部为现成开源件）

| 层 | 选型 | 许可 | 角色 | 落选方案与原因 |
|---|---|---|---|---|
| 语法引擎 | **vscode-textmate** | MIT | TM 语法装载、逐行分词（StackElement 原生解决跨行块状态）、scope 产出 | Shiki：其 HTML/着色输出绕过了 Gitter"高亮器产语义、主题供颜色"的管线；取其语法与主题数据包（下两行）而非运行时 |
| Oniguruma | **vscode-oniguruma**（WASM） | MIT | 正则引擎，Electron 主进程加载无障碍 | @shikijs/engine-javascript：备选，若 WASM 在某环境不可用 |
| 语法/主题数据 | **tm-grammars / tm-themes** | MIT | 内置 200+ 语言 grammar 与 50+ 主题，随 npm 分发 | 自维护 grammar：重复造生态已验证的内容 |
| 包容器 | **fflate** | MIT | .gpk = zip 的解包/打包（zipSync/unzipSync，零原生依赖） | adm-zip：API 更简但性能弱；extract-zip：只解不压 |
| manifest 校验 | **zod** | MIT | schema v2 校验，错误信息直接进设置页错误账本 | ajv：JSON Schema 写起来啰嗦，zod 与 TS 类型一体 |
| 版本门槛 | **semver**（node-semver） | ISC | engines.gitter 区间判断，不满足禁用不删除 | 自写：semver 区间解析没必要自造 |
| MCP | **@modelcontextprotocol/sdk** | MIT | 作为 **client** 接入外部 MCP server（stdio/HTTP）；现有管道宿主（mcp.ts）继续当 server，后续再迁 SDK | 自造工具集（现状）：生态为 0 |
| 隔离进程 RPC | **comlink** | Apache-2.0 | utilityProcess + MessageChannel 上的 Promise RPC，L3 插件 API 面 | vscode-jsonrpc：更底层，裸消息要自己包；Cordis：进程内框架，管不了跨进程边界 |
| 生命周期内核（备选） | **Cordis（@cordisjs/core）** | MIT | **P5 备选**：若 L2/L3 插件出现服务依赖图、热替换、按仓库 fork 实例三类需求再引入 | 现在就引入：学习曲线与间接层对当前 3 种 kind 是过度设计（对 dsh 分析的结论延续） |
| 命令注册表 | 手写 Map（~80 行） | — | id→{title,when,run}，面板/菜单/快捷键共用 | 无值得引的库；VS Code 的 API 形态照抄即可 |

**结论**：真正自写的只有 PackageStore（扫描/校验/账本）与 CommandReg 两块薄胶水；所有难题（语法、正则、zip、校验、版本、RPC、MCP）都站在现成件上。

## 五、包格式（.gpk schemaVersion 2，向下兼容 v1）

```
com.example.rust-pack.gpk (zip, fflate)
├── manifest.json
├── grammars/rust.tmLanguage.json     # kind: grammar（TextMate JSON）
├── themes/night-owl.json             # kind: theme（见 §七，VS Code 主题格式兼容）
├── i18n/zh-CN.json                   # 可选，%key% 引用
└── preview.png
```

manifest（zod schema，校验失败 = 拒载 + 错误账本，其余包不受影响）：

```jsonc
{
  "schemaVersion": 2,
  "id": "com.example.rust-pack",          // 反向域名，用户包覆盖内置包
  "name": "Rust 语言包",
  "version": "1.0.0",
  "engines": { "gitter": ">=0.6.0" },     // semver 区间，不满足 → 禁用（不删除）
  "contributes": {
    "grammars": [{ "language": "rust", "extensions": [".rs"], "path": "grammars/rust.tmLanguage.json" }],
    "themes":   [{ "path": "themes/night-owl.json", "base": "dark" }],
    "commands": [{ "id": "rust.cargoCheck", "title": "%cmd.cargoCheck%", "when": "repoOpen", "action": "terminal.run", "args": ["cargo check"] }],  // L1 受限命令：action 只能引用宿主已有动作
    "configuration": [{ "key": "rust.toolchain", "type": "string", "default": "stable" }]  // → 设置页自动渲染
  }
}
```

要点：
- **kinds 由 contributes 推导**（v1 是显式 kinds 数组），包内有哪些段就是哪些 kind，粒度仍是"包内 kind"可分别启停（延续 v1 规则）
- v1 包（schemaVersion 1，无 contributes）走兼容分支：旧 theme.json 字段映射进 contributes.themes；旧 highlighters.json 忽略（被 TextMate 引擎取代）
- 内置包自举原则延续：`app/resources/packages/*` 与 `userData/packages/*` 同格式、同代码路径
- 启停账本：settings.json `packages: { [id]: { enabled, kinds: {...} } }`（v1 原设计照搬）

## 六、PackageStore（唯一自写内核）

```
app/src/services/extensions/
├── store.ts        # 扫描两根目录 → zod 校验 → semver 门槛 → 状态账本（active/disabled/error+reason）
├── gpk.ts          # fflate 导入（对话框选 .gpk → 校验 → 解压 userData/packages/<id>/）、卸载（仅用户包）
├── commands.ts     # 命令注册表（Map），命令面板/右键菜单/快捷键三方消费
└── host.ts         # L2 契约：activate(ctx) => dispose()，ctx = { registerCommand, registerAiProvider, getConfig, log }
```

- **L2 契约只有 activate/dispose 两个动词**。这 150 行就是"迷你宿主"的全部——不引 Cordis 的理由与退出条件：当出现 ①插件间服务依赖、②运行中热替换、③同一插件按仓库 fork 多实例 三个信号中任意两个时，`host.ts` 整体换成 @cordisjs/core，`activate/dispose` 契约与 Cordis 插件形状同构，迁移只动一个文件
- 设置页「扩展」卡片恢复 v1 C# 栈 UX：列表/启停开关（即时回退）/卸载/错误原因/内置标记

## 七、语法高亮子系统（本方案最大收益点）

管线（主进程，渲染层契约不变）：

```
DiffView ──bridge──▶ GrammarSvc
                      │ ① byExtension → grammar（内置 tm-grammars 或用户包）
                      │ ② vscode-textmate Registry.tokenizeLine(line, stack)   ← StackElement 跨行状态免费获得
                      │ ③ scope → 颜色：Theme.match（vscode-textmate 内置主题匹配器，
                      │    直接消费 VS Code 主题 JSON 的 tokenColors）
                      │ ④ 输出 TokenRun[]（新增 color 字段，style 字段保留为回退键）
                      ▼
                 降级链：TM 语法超时/异常 → 内置声明式引擎（highlighters.json 原样保留）
                        → plain
```

- **内置 5 语言声明式引擎不删除**，降为回退层（code-highlight-framework.md 的风险表"表达力上限"就此销账，其资产仍在兜底）
- 旧主题 theme.json 的 `syntax` 段（keyword/string/…）做一次 scope 映射（keyword→keyword.*、string→string.*…）作为无 tokenColors 时的兜底配色
- 性能预算：v1 文档标准为每行 ≤0.2ms；vscode-textmate 典型 0.1–0.5ms/行，沿用现有"可见区惰性分词 + 格级缓存"；超预算或大 diff 卡顿的预案 = 把 GrammarSvc 挪进 worker_threads（对 PackageStore 透明，桥契约不变）
- oniguruma WASM 约 +1MB 包体，Electron 场景可接受

## 八、主题子系统

- theme.json 增加可选 `tokenColors` 段（= VS Code 主题 JSON 格式，可整文件粘贴），与现有 `syntax` 段并存：有 tokenColors 走 scope 匹配，否则走旧语义键
- **VS Code 主题导入**：.gpk 里放主题 JSON 即装即用；tm-themes 内置 50+ 主题随应用分发（内置包自举）
- 现有 tokens/diff/terminal 段（应用 UI 语义令牌）不动，theme-framework.md 格式向后兼容

## 九、命令贡献点与配置 schema

- CommandReg 成为命令面板唯一数据源（替换 `CommandPalette.tsx` 硬编码数组）：内置命令以同一 manifest 贡献形态注册（自举，延续"内置=同一格式"）
- L1 受限命令：manifest 里 `action` 只能引用宿主动作（terminal.run / git.stage / …），**无代码即可写扩展包**——覆盖"一键跑 cargo check"这类 80% 需求
- L2 完整命令：activate(ctx) 里 `ctx.registerCommand(...)`，任意 JS 逻辑，进程内受信
- `configuration` 贡献 → SettingsPage 按 zod schema 描述自动渲染控件，插件零 UI 代码

## 十、AI / MCP 扩展

- **接入外部**：`@modelcontextprotocol/sdk` client，设置页可添加外部 MCP server（stdio 命令或 HTTP URL），其工具并入 AI 会话工具面——外部生态直接变成 Gitter 的 AI 插件
- **对外提供**：现有管道宿主（mcp.ts，含人审门）保留，逐步迁到 SDK server 形态
- **AI 后端接缝**：ai.ts 的 provider 分支重构为 `ctx.registerAiProvider(name, complete)` 注册表，内置 openai/anthropic/cli 三实现成为自举注册者——第三方可在 L2 插件里加新后端（如本地 Ollama 定制传输）

## 十一、L3 隔离代码插件（P5，最后做）

- Electron `utilityProcess` + MessageChannel + comlink：插件跑在子进程，死循环/崩溃只杀子进程（v1 想用 Jint 手搓的沙箱在此被平台能力整体替代）
- API 面 = RPC 存根集合（registerCommand 的远程版、git 只读查询、AI 调用），权限清单进 manifest，越权调用在主进程门上拒绝；写操作一律复用 safety.ts 人审门
- 触发条件：L1/L2 覆盖不了、且确有第三方分发需求时再启动

## 十二、分阶段计划

| 阶段 | 内容 | 验收 | 依赖 |
|---|---|---|---|
| P1 | PackageStore（zod+semver+账本）+ .gpk 导入/卸载 + 设置页扩展卡片 + schema v2/v1 兼容 | 导入一个含主题的 .gpk 全流程可用；坏包拒载且原因可见；v1 主题包不回归 | — |
| P2 | vscode-textmate + oniguruma + tm-grammars/tm-themes 内置 + 降级链 + TokenRun.color | .rs/.go/.py diff 正确着色（含跨行块）；声明式回退路径可用；可见区分词无感知卡顿 | P1 |
| P3 | CommandReg 自举改造 + L1 受限命令 + configuration→设置页自动渲染 | 命令面板/快捷键数据源合一；装一个纯 manifest 命令包即可出现在面板 | P1 |
| P4 | MCP SDK client + 外部 server 管理 + ai provider 接缝注册表 | 接入任一公开 MCP server 其工具可被 AI 会话调用；人审门不回归 | — |
| P4.5 | 内置 AgentLoop（Vercel AI SDK，L2 自举）+ agentLoop 贡献 kind（详见 §十五） | git 任务型 agent（提交消息/审查/冲突助手）多步工具循环跑通；工具执行全经 safety.ts 人审门 | P4 |
| P5 | utilityProcess 插件宿主 + comlink RPC + 权限清单 | 第三方 demo 插件子进程内跑通注册命令，杀进程宿主无感 | P3 |

P1–P3 主线，P4 可并行，P5 按需。

## 十三、风险与对策

| 风险 | 对策 |
|---|---|
| oniguruma/TextMate 分词慢于现引擎 | 可见区惰性分词已有；降级链兜底；worker_threads 预案 |
| 语法包正则病态（ReDoS 类） | 分词放主进程时逐行 yield + 行长截断；P5 起挪子进程 |
| Cordis 判断失误（过早自写/过晚引入） | host.ts 契约与 Cordis 插件形状同构，迁移面收敛到单文件；§六列了三个量化触发信号 |
| v1 包迁移回归 | schemaVersion 兼容分支 + 现有主题包冒烟（亮暗切换、令牌快照对比沿用迁移文档验收法） |
| 第三方插件供应链 | L0/L1 无代码面；L2 仅审核渠道分发；L3 权限清单 + 人审门；不做自动更新，更新=重装 |

## 十四、与 v1 方案的对照

| v1（C# 栈，2026-10-04） | v2（本方案） |
|---|---|
| Jint 脚本宿主 + 手搓超时/内存沙箱 | utilityProcess + comlink（平台能力替代手搓沙箱）；JS 引擎不再需要另找 |
| Roslyn ALC 强类型插件（P4 预留） | 随 C# 栈废弃，不再有对应物 |
| kinds: theme/syntax + 后续 command | contributes 多段：theme/grammar/commands/configuration/aiProvider |
| 自写 zip/校验/semver | fflate/zod/semver 标准件 |
| 声明式高亮为主，脚本/C# 插件为高亮扩展路径 | TextMate 语法为主，声明式引擎降为回退 |
| 无行为扩展点 | L1 受限命令 + L2 完整命令 + 配置 schema |
| MCP 固定工具集 | 标准 SDK 双向，生态接入 |

## 十五、Agent 主循环开放（P4.5，2026-10-05 增补）

> 问题：若要像 DeepSeek Harness 那样把 agent 主循环开放为可扩展点，用什么框架、放在哪一层。

**现状**：Gitter 尚无 agent 主循环——ai.ts 是一次性补全网关（complete → string），mcp.ts 是对外工具面（给外部 agent 当工具箱），两者都不构成"宿主自己的循环"。本节为绿地设计，非改造。

**安全不变量（先于选型确定）**：**决策权可下放，执行权不下放。** 循环进程/循环插件只负责"决定下一步调哪个工具"；工具执行、模型调用代理、人审门全部留在宿主侧。第三方循环拿到的只有工具结果，碰不到执行器——刷屏审批、绕过人审在架构上不可行（宿主可对审批请求限流）。

**选型**：

| 候选 | 结论 |
|---|---|
| **Vercel AI SDK**（ai npm 包，MIT） | ✅ 主选：TS 生态事实标准的工具循环（多步 tool-calling、stopWhen、流式）；provider 无关——@ai-sdk/openai-compatible 直接覆盖现有 OpenAI 兼容传输（含 DeepSeek/Ollama），`cli` 桥传输包成自定义 LanguageModelV1 provider；工具定义原生 zod（与本方案 manifest 校验同件）；内置 MCP client。同时收编 ai.ts 三个手写传输为 provider 注册 |
| LangGraph.js | 备选：需要检查点/暂停恢复/多会话时间旅行时切换。git 任务型 agent 时程短，前期是过度设计 |
| OpenAI Agents SDK (JS) | 放弃：OpenAI 中心化，与 provider 接缝目标冲突 |
| Cordis | 不解决本问题：Cordis 是生命周期内核不是循环；dsh 的 loop 插件同样是手写循环逻辑挂在 Cordis 上。我们的 host.ts 契约承担同等挂载职责 |
| 直接复用 dsh | 放弃：它是完整 agent 运行时非可嵌入循环库，且进程内全信任模型与 Gitter GUI 风险模型不符 |

**层级归属**：

- **内置默认循环 = L2**（主进程内，Vercel AI SDK 实现），经 host.ts 以 `ctx.registerAgentLoop(id, impl)` 注册，与内置命令/内置 provider 同一自举模式。第一方循环示例：提交消息生成、代码审查、冲突解决助手
- **循环外围全开放**：模型 = provider 接缝（P4）、工具 = MCP/本地（经人审门）、技能与提示词 = L0/L1 数据包
- **第三方替换循环本身 = 仅 L3**（依赖 P5 PackageHost）：循环决策跑在 utilityProcess，经 comlink 请求"宿主代理执行"（模型调用 + 工具执行），权限清单限定可用工具与模型档位
- **host.ts 契约增补一个动词**：`ctx.registerAgentLoop`——不改变"activate/dispose 两动词"的极简性评价，这是第三种注册与 registerCommand 同形

**与 dsh 路线的差异声明**：dsh"一切皆插件、loop 也是插件"成立的前提是它本身即 agent 运行时且接受进程内全信任。Gitter 的 agent 是功能而非产品本体，GUI 用户安装第三方插件的信任模型不同，故取"**开放外围、圈住内核**"折中：外围（模型/工具/技能/循环选择）全部可插拔，循环执行权永不离开宿主。若 agentLoop 生态长大，将自然命中 Cordis 触发信号（服务依赖图 + 每仓库 fork 实例），届时按 §六既定路径换内核，AgentLoop 接缝不受影响。

## 十六、插件能力扩展：贡献点全集与载体矩阵（v3 方向，2026-10-05 增补）

> 背景：P1–P3 落地后插件能力限于"换皮 + 补语言 + 快捷命令"三类 L0/L1 数据插件。本节对标 pi（包带工具/技能/提示模板并影响 agent 行为）与 DeepSeek Harness（一切皆插件）的扩展点全集，把能力面从"数据声明"扩展到"行为扩展"，同时保住 Gitter 的信任分级。
> 结论先行：**扩展性来自"扩展点 × 载体"矩阵的宽度，安全性来自载体的分级**——吸收"什么都能插"，不吸收 dsh/pi 的进程内全信任。

### 16.1 扩展点 × 载体矩阵（设计目标全景）

| 扩展点 | L1 声明 | L2 受信代码 | L3 隔离 | MCP 外部 | 现状 |
|---|---|---|---|---|---|
| 主题 themes | ✅ | — | — | — | 已实施 |
| 语法 grammars | ✅ | — | — | — | 已实施 |
| 命令 commands | ✅(扩) | ✅ | ✅ | — | L1 仅 2 动作 |
| 配置 configuration | ✅(闭环) | ctx 读取 | ctx 读取 | — | 存而不用 |
| 快捷键/菜单 keybindings·menus | ✅(新) | — | — | — | 无 |
| i18n 词条 | ✅(新) | — | — | — | 无 |
| 模型端点 modelEndpoints | ✅(新) | ✅ provider | ✅ | ✅ | ai.ts 写死 3 传输 |
| **工具 tools** | — | ✅ | ✅ | ✅ | 无（最关键缺口）|
| **技能 skills** | ✅(新) | — | — | — | 无 |
| **事件钩子 hooks** | — | ✅ | ✅ | — | 无 |
| **视图 views/statusbar** | — | ✅(数据供给) | ✅(webview) | — | 无 |
| Agent 循环 loops | — | ✅ | ✅ | — | §十五已设计 |

### 16.2 四项核心机制

1. **contributes 贡献点全集（manifest schema v3，向后兼容 v2）**：新增声明式段 `keybindings`（映射命令 id）、`menus`（右键菜单引用命令 id + when）、`skills`（技能包：name/description/instructions + 可引用工具名，纯文本数据）、`modelEndpoints`（OpenAI 兼容端点三元组，零代码插模型）、`mcpServers`（stdio 命令或 URL 声明式引用）、`i18n`（`i18n/<lang>.json` + 标题 `%key%` 引用）。`when` 条件从单一 `repoOpen` 扩为表达式子集（`repoOpen`/`fileSelected`/`config:<key>`/`kind:<fileKind>`）。
2. **ToolRegistry——统一工具总线（本节最重要的结构）**：一张注册表 `{ name, inputSchema(zod), permission, execute }`，四个来源入注册：内置 git 工具（mcp.ts 工具面收编）、MCP server 工具（@modelcontextprotocol/sdk client）、L2 插件工具（`ctx.registerTool`）、L3 插件工具（comlink 存根）。命令面板、AI 循环、事件钩子消费同一注册表——工具是各类插件的通用语言。
3. **L2 宿主契约正式化**：`activate(ctx) ⇒ dispose()`，ctx API v1 = registerCommand / registerTool / registerAiProvider / registerLoop(P4.5 后) / on·emit 事件总线（repo.opened·closed、changes.updated、commit.created、branch.checkedOut、sync.pushed）/ ctx.git 只读 API / ctx.storage 插件隔离 KV / ctx.ui.notify。契约与 Cordis 插件形状同构（§六触发信号不变）。
4. **UI 贡献点：宿主容器 + 插件内容**：渲染层插槽注册表（statusbar 左右、侧栏面板、提交对话框区块、diff 侧栏、空状态）。L2 注册"视图元数据 + 数据供给回调"（主进程算数据，React 宿主容器渲染通用卡片）；L3 内容进沙箱 iframe（webview 模式，postMessage 桥）。宿主 Chrome 原生，插件内容装箱（VS Code/Obsidian 模式）。

### 16.3 安全不变量（扩展能力不许破的）

1. **决策/执行分离**：循环与插件"提议"，宿主执行——工具执行器只在宿主，L3 拿不到 Node。
2. **写操作一律过 safety.ts 人审门**（含 L2/L3 工具、钩子里的 git 写）。
3. **权限最小化 + 安装时明示**：manifest `permissions` 清单，设置页安装卡展示并需确认；L3 网络走域名白名单；apiKey 永不进 L3（AI 调用经宿主代理）。
4. **L1 命令首跑确认**：`terminal.run` 命令首次执行弹确认（terminal.run 本质是以用户权限预置任意 shell 命令，信任边界在包作者）。
5. **L2 只走审核渠道**分发（设置页来源标记）；任意来源默认仅 L1/L3。

### 16.4 能力实证（扩展后的插件形态）

| 插件 | 形态 | 扩展点 |
|---|---|---|
| 项目脚手架包 | L1 | commands(模板化) + configuration + i18n |
| Jira/Issue 集成 | L2 | hooks(commit.created) + statusbar + ctx.git + network |
| 提交规范门禁 | L2 | hooks(commit.created 可阻断) + ui.notify |
| Ollama/DeepSeek 本地模型包 | L1 | modelEndpoints（零代码） |
| 自定义 AI 后端 | L2 | registerAiProvider |
| 代码统计面板 | L2 | views(侧栏) + ctx.git |
| 图片 diff 增强 | L2 | views(diff 侧栏) + previewProvider |
| AI Code Review 技能包 | L1 | skills + 工具引用 |
| 外部 agent 接入 | MCP | mcpServers 声明 |
| 第三方检查器 | L3 | 隔离进程 + 权限清单（network + git.read） |

### 16.5 全环节接缝地图（每个环节都有插件植入点）

**接缝三原则**：
1. **自举强制**：接缝开启的同一阶段，内置功能必须改走该接缝（B 阶段内置 git 工具迁移进 ToolRegistry；A 阶段现有右键菜单迁到 menus 接缝）——接缝不许是摆设，每阶段冒烟必须含"内置走接缝"断言。
2. **接缝即边界**：每条接缝声明合法载体白名单 + 所需权限 + 是否过人审门；未列入的载体在该接缝上装载期即拒绝。
3. **数据先行**：能用 L1 声明表达的绝不开 L2 接缝（如安全网先做正则规则数据包，扫描器接口只留给真正需要代码的）。

| 环节 | 接缝 | 合法载体 | 开缝阶段 |
|---|---|---|---|
| 命令与导航 | commands / keybindings / menus(右键) / 命令面板 | L1 / L2 / L3 | A(L1) → C(L2) → F(L3) |
| 设置 | configuration（闭环 + `${config.x}` 模板） | L1 / ctx 读取 | A |
| 界面文案 | i18n（`%key%` 引用 + i18n/ 目录） | L1 | A |
| 终端 | terminal.run 动作 + terminalProfiles 档位包 | L1 | A |
| 提交安全网 | safetyRules 规则包（L1 正则规则）+ 自定义扫描器接口 | L1(数据) / L2(扫描器) | A(L1) → C(L2) |
| 代码高亮 | grammars / tokenColors | L1 | 已实施 |
| 外观 | themes（tokens/diff/terminal/tokenColors） | L1 | 已实施 |
| 工具 | ToolRegistry（内置自举 + MCP + L2 + L3 同一注册表） | L2 / L3 / MCP | B |
| 模型 | modelEndpoints（数据）+ aiProvider 注册表 | L1 / L2 / MCP | B |
| 外部代理 | mcpServers 声明式引用 | L1(引用) | B |
| 仓库生命周期 | 事件 repo.opened / repo.closed | L2 / L3 | C |
| 变更与提交 | 事件 changes.updated + commit.created（可否决门禁） | L2 / L3 | C |
| 分支与同步 | 事件 branch.checkedOut / sync.pushed + push 前门禁 | L2 / L3 | C |
| Log 视图 | log.decorators（提交徽章/注解，只读装饰） | L2 / L3 | C |
| 文件预览 | previewProviders（按扩展名的非文本预览） | L2 / L3 | C |
| 存储 | ctx.storage 插件隔离 KV | L2 / L3 | C |
| 通知 | ctx.ui.notify | L2 / L3 | C |
| Agent 循环 | loops + skills + 提示模板 + 会话卡（→ agent-harness.md taskTypes） | L1(Skills) / L2·L3(Loop) | D |
| UI 容器 | 插槽注册表（statusbar/侧栏面板/对话框区块/diff 侧栏/空状态）+ L3 webview | L2(数据视图) / L3(webview) | E |
| 跨载体授权 | 权限清单 + 安装明示 + 宿主代理执行 | L3（全部接缝的授权子集） | F |
| 分发 | catalog / 渠道标记 / apiVersion | 生态 | G |

### 16.6 分阶段路线（每阶段必开接缝；A→B→C 串行，D 依赖 B+C，E/F 依赖 C，G 最后）

| 阶段 | 本阶段开的接缝 | 内容 | 验收（含"内置走接缝"自举断言） |
|---|---|---|---|
| A · L1 全开 ✅ 已实施（2026-10-05） | **8 条全部开缝**：commands(模板化+白名单扩容 shell.reveal/repo.refresh+首跑确认) / menus（内置 changesFile 两项已迁入接缝） / keybindings（useShortcuts 改 keyHint 分发） / configuration(闭环：config.* 进入模板变量) / i18n（包 i18n/<lang>.json + %key%） / when 表达式（repoOpen/fileSelected/config:<key>/!取反，宿主求值 enabled） / terminalProfiles（TerminalManager resolveProfile + terminal.profiles RPC + 设置页动态档位） / safetyRules（scanPackageRules 恒 warning，提交拦截链已合并） | 验收 = 冒烟 48 项全绿（含内置走接缝自举断言：file.openInEditor/revealInExplorer 经 when+menus 接缝、确认流、模板插值 config+repo 变量） |
| B · 工具与模型 ✅ 全部实施（2026-10-05） | ToolRegistry ✅（内置自举 + mcp.ts 协议层走注册表 + 来源标记 + 写工具人审门）；ai provider 注册表 ✅（registerAiProvider 三传输自举）；mcpServers 外部连接器 ✅（D 阶段补齐：手写 stdio 按行 JSON-RPC 客户端 mcpClient.ts，零 SDK 依赖，工具入注册表 source=mcp，信任门 settings.externalMcpEnabled）；modelEndpoints → 并行文档 task-model-modules.md models 体系覆盖，provider 注册表即运行时接缝 | 冒烟：内置工具真实仓库调用/人审门/协议层 + fixture 外部 MCP server 连接与调用全绿 |
| C · 行为接缝（L2 宿主）✅ 已实施（2026-10-05） | **7 条全部开缝**：事件总线（repo.opened/closed、commit.created、branch.checkedOut、sync.pushed/pulled，bridge 各操作点发射）✅ / commit·push 可否决门禁 ✅（runGates，只能否决不能篡改）/ log.decorators ✅（log.query 后处理只读徽章）/ previewProviders ✅（file.preview 包提供者优先）/ L2 扫描器 ✅（可 blocked，allowCode 门=审核渠道信任）/ ctx.storage ✅（每包隔离 JSON）/ ctx.ui.notify ✅（ui.notify 事件 → 渲染层 toast）。L2 宿主 = host.ts activate/dispose，manifest `entry` 字段，settings.allowCodePlugins 信任门（默认关） | 验收 = smoke-seams-bc 25 项全绿：L2 fixture 插件装载/卸载/dispose 回调/坏 entry 错误账本/事件链/门禁否决/装饰器/扫描器/插件工具/storage 落盘/runtime 命令跨 manifest 重载存活；附带修复 mcp 未知工具协议双重编码缺陷 |
| D · Agent 接缝 ✅ 完整实施（2026-10-06） | loops ✅（openai 兼容 **SSE 流式** + **Anthropic 原生 tools 协议**双循环：tool_use/tool_result content blocks；registerAgentLoop 可替换 + 双内置自举；bridge 按 provider 路由默认循环）/ skills ✅ / 提示模板 ✅ / 会话卡 → agent-harness.md 已覆盖 | 冒烟：openai 全 SSE 端到端 + anthropic tool_use/tool_result 端到端 全绿 |
| E · UI 接缝 ✅ 全部实施（2026-10-06） | statusbar ✅ / 侧栏面板 ✅ / webview 视图容器 ✅（沙箱 iframe 无脚本）/ 空状态提示 ✅ / **提交对话框区块 ✅**（registerCommitBlock → ui.commitBlocks RPC → 提交框上方提示条，只能提示不能阻断）/ **diff 侧栏注记 ✅**（registerDiffNote → diff.notes RPC → DiffView 头部注记条，按路径命中） | 冒烟：commitBlock 数据供给 + diffNote 按路径命中/未命中 全绿 |
| F · 隔离授权 ✅ 已实施（2026-10-06） | manifest `entrySandbox: "utility"` + `permissions` 清单（storage/notify/events/git.read/tools/statusbar 六能力）；L3 通道双适配器（main 注入 Electron utilityProcess / 冒烟注入 Node fork，同协议）；宿主能力代理权限强制（未授权 = permission denied）；L3 工具代理（write:gate 仍走人审）；崩溃隔离（子进程退出 → 注册面回收 + 错误账本）；子进程 SDK = l3-child.ts（init 下发 sdkDir）；apiVersion 拒载策略 ✅（HOST_API_VERSION=3，超版 disabled+原因）；设置页权限徽标 ✅ | 冒烟：seams-f 16 项全绿（装载/权限拒绝/工具跨进程 2+3=5/storage/statusbar/git.read/事件下发/崩溃隔离/deactivate 清理/apiVersion/面板） |
| G · 分发接缝 ✅ 宿主侧齐备（2026-10-06） | 脚手架模板 ✅ + apiVersion 冻结 ✅ + **gen-catalog.mjs ✅**（扫描包根 → 宿主同源 zod 校验 → sha256 checksum → catalog.json，错误包入账本）；目录站聚合/渠道标记为外部基建（catalog.json 即其输入契约） | 冒烟：catalog 生成（ok+error 双路径）全绿 |

合计 32 条接缝：A(8) + B(3) + C(7) + D(4) + E(6) + F(1 横切) + G(3)，另有已实施 4 条（themes/grammars/commands-L1 基础/configuration 存储）。

### 16.7 风险

| 风险 | 对策 |
|---|---|
| 渲染层插槽系统是最大新增前端工程（E） | 先做 statusbar + 侧栏两插槽验证模式再铺开 |
| ctx API 冻结压力 | `gitui.apiVersion` 显式版本 + 弃用周期 |
| 事件风暴（changes.updated 高频） | 宿主侧 100ms 合并节流（复用 syncProgress 经验） |
| Cordis 误判 | 触发信号维持 §六原判，ctx 契约保持同构 |
| L2 审核渠道运营成本 | 信任模型的持续成本，G 阶段目录站自动校验降低人工 |
| safetyRules 规则包误报/恶意拦截提交 | L1 规则默认 warn 档只有提示权；block 档仅内置规则集可设（数据插件不给否决权，否决权保留给 C 阶段 L2 扫描器 + 人审） |
| 接缝数量膨胀（32 条）的维护面 | 每条接缝一张契约卡（载体白名单/权限/门三字段）；自举断言进冒烟防接缝腐化；年检裁撤零使用接缝 |
