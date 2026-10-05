# 插件系统 v2 方案（成熟开源组件组合，非自造框架）

> 状态：设计稿 v1（未实施）
> 日期：2026-10-05
> 背景：WinUI3→Web 迁移后，v1 扩展框架（extension-package-framework.md）只剩主题目录扫描；高亮退化为内置 5 语言死 JSON；生命周期/脚本宿主/命令扩展全部缺位。
> 关联：`extension-package-framework.md`（v1，数据格式延续）、`code-highlight-framework.md`（声明式引擎降级为回退层）、`theme-framework.md`（theme.json 格式兼容）、`winui3-to-web-migration.md`（§12.3 语法终局决策门，本方案即该门的裁决）
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
| L2 受信代码 | npm/本地 JS 模块 | **主进程内** activate/dispose | commands(完整)、ai-provider（第一方/审核过的包） |
| L3 隔离代码 | 任意 JS | **utilityProcess 子进程** + RPC | 第三方 code 插件 |
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
