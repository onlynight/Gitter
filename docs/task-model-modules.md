# 任务与模型模块重设计（参考 ZCode，插件化）

> 状态：设计提案 v1.0（2026-10-05），**仅设计方案，未动代码**
> **实施进度（2026-10-05）：M1/M2/T1/T2 已落地**——settings `models[]/defaultModelId/fastModelId/modelUsage` + 旧字段一次性迁移；`contributes.models/taskTypes`（zod + kinds 推导）；`agents/taskTypes.ts`（收紧校验：只能沿 auto→session→each-time、git_push 恒 each-time、tools ⊆ 全集）；`agents/tools.ts` 统一 ask 入口（策略收紧对 auto 工具生效）+ 白名单裁剪；session（档案链解析/用量记账/fork/归档/删除/setModel）；bridge `models.*` 与 `agent.task.*` 新 RPC；设置页"模型档案"节（CRUD/key/默认/fast/用量，旧 AI 节迁移后隐藏）；任务页任务型/模型选型 + 徽标切换 + 归档；内置三包（gitui.models.deepseek / gitui.models.ollama / gitui.agent-presets）。无头验收 `node dist/smoke-models-tasks.js`（27 项）。未含：T3（子代理/hooks/L3 循环）、任务卡"会话 diff"跳转
> 背景与上位：agent-harness.md v3.0（A1–A3 已落地：内置 Gitter Agent 循环 + 工具集 + 两栏任务页）跑通后，两个模块的"单档"形态成为瓶颈——模型是 settings 里**一份全局 AI 网关配置**（off/openai/anthropic 三选一 + 单端点单模型单密钥），任务是**唯一内置形态**（自由任务）。本方案参考 ZCode 的模型与会话/任务形态，按插件系统 v2（extension-system-v2.md）的信任分级重设计这两个模块
> 关系：取代 agent-harness.md §3.1 的 provider 解析与 settings 单档（迁移映射见 §3.5）；工具集对象 = tool-agent-fusion.md 操作目录；循环运行时/安全不变量（§15"决策可下放，执行不下放"）原样继承

---

## 一、ZCode 对照与差距

| ZCode 形态 | Gitter 现状 | 差距 |
|---|---|---|
| 模型注册表：多 provider 多档并存，`/model` 会话内切换（下一轮生效），主循环/子代理/后台任务可用不同模型 | settings 单档：全局一个端点+模型+密钥，任务不可选 | **模型档案化**（§二）：多档并存、任务绑定、徽标切换、缺省链、快慢分工 |
| 会话持久化/恢复/分叉 | 账本+续跑已有，无分叉/归档 | **会话管理补全**（§3.4） |
| 权限模式（default/plan/yolo…）+ hooks | 分级授权卡已有（分级写死在工具集） | **权限策略对象化到任务型**（§3.2） |
| 子代理（独立上下文跑子任务回传结论） | 无 | 预留设计位（§3.5，v1 不做） |
| 任务清单（循环内 TodoWrite） | 无 | 不做（git 任务时程短，§15 LangGraph 结论同源） |

**插件化落点**：两个模块各加一个 **L1 声明式贡献段**（`contributes.models` / `contributes.taskTypes`）——数据包先行，第三方不发代码就能发布"XX 模型接入包""任务预设包"；需要代码的只有 provider 适配器接缝（L2，§15 既有）与内置自举包（同一格式）。

---

## 二、模型模块：ModelProfile 一等公民

### 2.1 数据模型（contributes.models，L1 声明式）

```jsonc
// 例：第三方发布的 "DeepSeek 接入包"，无代码
{ "id": "deepseek-chat",                 // 包内 id，全限定 = <包id>/<id>
  "name": "DeepSeek 官方",
  "kind": "openai-compatible",           // 适配器 kind：内置 openai-compatible / anthropic 自举
  "baseURL": "https://api.deepseek.com/v1",
  "modelId": "deepseek-chat",
  "keyHint": "DeepSeek API Key",         // 仅展示；密钥永不进包（见 §五）
  "params": { "temperature": 0.3 },
  "capabilities": { "tools": true, "streaming": true, "contextTokens": 128000 },
  "tags": ["cloud", "reasoning"] }       // local/cloud · fast/reasoning —— 分工路由依据（§2.4）
```

- **用户档案**（settings.models[]）与包贡献同形状，额外多 `keyRef`（= 全限定 id，密钥存 safeStorage）与 `enabled`；
- 同 id 覆盖规则沿用 PackageStore：用户档案遮蔽包档案（用户可改 baseURL/参数，包只当模板）；
- L2 接缝（继承 §15）：`registerModelProvider(kind, factory)`——内置 `openai-compatible` / `anthropic` 两适配器自举；第三方特殊传输（非 OpenAI 形状的 API）写 L2 插件注册新 kind。manifest 引用未注册 kind → 拒载进错误账本。

### 2.2 解析链与切换（ZCode /model 语义）

```
任务绑定 profileId（创建时定，任务卡模型徽标可改）
  → 任务型 defaultModelRef（contributes.taskTypes）
  → 全局默认档案（settings.defaultModelId）
  → 都没有 → 任务创建被拒（明确引导设置页，不静默降级）
```

- **切换在轮次间生效**：ModelMessage 历史与 provider 无关，换档案续聊天然成立（= ZCode 切模型下一轮生效）；
- 档案禁用/卸载后，绑定它的任务在**下一轮启动时**报错并引导重选（历史无损）；
- `capabilities.tools = false` 的档案**拒绝跑工具循环**（任务卡明确报错），声明不信任、不静默降级；`streaming=false` 自动退化为非流式（时间线整段呈现）。

### 2.3 用量记账

每轮 usage 已入会话事件；补**按档案聚合**：settings 侧只存累计数（`usage: { [profileRef]: { turns, inputTokens, outputTokens } }`），设置页档案卡展示。不上传、不清历史。

### 2.4 分工路由（主/轻模型，ZCode 主循环 vs 后台任务的同构）

一次性轻用途——任务标题生成、checkpoint 摘要润色、提交消息草稿——走 `settings.fastModelId` 指向的档案（tags 含 fast）；未设则回落任务绑定档案。路由点是**纯函数**（给定用途+档案表 → profileRef），可测。

### 2.5 兼容迁移

settings.aiProvider/aiEndpoint/aiModel/aiApiKeyProtected 四字段 → M1 做一次性只读映射：非 off 即生成首个用户档案（keyRef 解密搬移），旧字段保留不写（一个版本后删除）。privacy 三档语义不变，作用于解析链入口。

---

## 三、任务模块：任务型（TaskType）贡献点 + 会话管理

### 3.1 任务型（contributes.taskTypes，L1 声明式）

```jsonc
{ "id": "code-review",
  "name": "代码审查",
  "promptTemplate": "请审查当前 diff，指出风险：{input}",   // {input} = 用户输入
  "systemAddendum": "只分析，不修改文件。",                  // 追加到系统提示词
  "tools": ["repo_status", "repo_diff", "repo_log", "repo_read_file", "repo_list_files"],  // 裁剪（白名单）
  "permissionPolicy": { "git_stage": "each-time" },         // 覆盖（只能收紧，见校验规则）
  "defaultModelRef": "deepseek-chat" }                      // 可选，缺省走全局链
```

- 内置自举包 `gitui.agent-presets`（对齐"内置 = 同一 manifest 格式"）：**free**（自由任务 = 现形态：全工具 + 默认策略）、**code-review**（只读工具集 + 全 auto——只读本就免审）、**commit-message**（只读 + 输出约定）。三个预设以同一格式进 `app/resources/packages/`，用户可禁用可覆盖——这就是 §15"第一方循环（提交消息/审查/冲突助手）"的落点：不新写循环，**用任务型裁剪同一个循环**；
- 新建任务对话框增加两选：任务型（默认 free）、模型档案（默认 = 任务型 → 全局链）；
- 循环执行时：工具集 = 全集 ∩ taskType.tools；权限分级 = 内置基线 ⊕ taskType.permissionPolicy；系统提示词追加 systemAddendum。

### 3.2 权限策略：收紧校验（安全不变量的插件化表述）

内置基线（tools.ts 现状）：`file_write/file_patch auto；git_stage/git_commit/terminal_run session；git_push each-time`。包贡献的 permissionPolicy **只能沿 auto→session→each-time 方向收紧**，且 `git_push` 固定 each-time 不可覆盖；tools 白名单只能是全集子集。manifest zod + PackageStore 校验，违规进错误账本。——这是"决策可下放，执行不下放"在 L1 数据层的对应物：**任务型可以少给，不能多要**。

### 3.3 权限模式预设（ZCode default/yolo 的对应物）

任务创建时可选三档模式预设（内置 taskType 参数，非新机制）：**严格**（全部 each-time）/ **标准**（基线）/ **信任**（file_write+git_stage+git_commit → auto；push 仍 each-time）。模式即一组预置 permissionPolicy，随任务存账本。

### 3.4 会话管理

- **fork**：从现有任务派生新任务——复制消息历史前 N 轮到新 taskId（可选换模型档案/换 worktree：新建或复用），原任务不动。ZCode fork 语义；落点为 `agent.task.fork` RPC + 任务卡菜单项；
- **归档/删除**：账本条目加 `archived` 标志（列表过滤，可恢复）；删除 = 删账本条目 + 会话文件（worktree 不动，独立清理）；
- 续跑/退回重做已实现，不变。

### 3.5 预留设计位（v1 不做，只定接口形状）

- **子代理**：主循环新增工具 `task.spawn { taskType, input, modelRef? }` → 派生只读子任务（独立消息历史，同 worktree），完成时仅回传最终文本给主循环——ZCode Agent tool 对应。安全要点：子任务继承父任务**收紧后**的策略且强制全 auto 只读集；
- **Hooks**：工具调用前/后拦截（L1 声明式：manifest `contributes.hooks` 匹配工具名 → 动作仅限"追加提示/拒绝"），形状与收紧原则同 §3.2。

---

## 四、manifest schema v2 加段与 PackageStore

- `contributes` 增 `models` / `taskTypes` 两可选段（zod：models 校验 kind/baseURL/modelId/capabilities；taskTypes 校验 tools ⊆ 全集、policy 收紧方向、promptTemplate 含 {input}）；
- kinds 推导自动含 `models` / `taskTypes`（kindsOf 加两行），账本 `packages[id].kinds` 按 kind 启停沿用；禁用 models kind = 其档案从解析链消失（绑定任务下一轮报错引导）；禁用 taskTypes kind = 预设从对话框消失；
- 设置页：新增**模型档案**卡（列表/新增/编辑/删除/密钥录入/设默认/设 fast/用量展示）与**任务类型**卡（列表 + 启停，来源标内置/包）；两卡数据源 = PackageStore + settings.models，与既有扩展卡片同栈。

---

## 五、安全模型（全部继承，仅新增两条 L1 规则）

1. 密钥永不离机：包只声明 keyHint；keyRef → safeStorage；包代码（若同包含 L2 件）运行期也拿不到明文（bridge 注入在 provider 工厂内）；
2. 任务型**只能收紧不能放宽**（§3.2 校验）+ `git_push` 固定 each-time；
3. 模型能力声明不信任：tools=false 硬拒绝；
4. 其余全部继承 agent-harness.md §九（本地优先 / 人审门 / worktree 隔离 / 零 git 污染 / 降级零依赖——无任何档案时任务卡仍可手动 worktree 派活）。

---

## 六、路线（M/T 系列）

| 阶段 | 交付 | 验收 |
|---|---|---|
| **M1 档案内核** | ModelProfile 存储 + 解析链 + 旧字段一次性迁移 + provider.ts 改档案驱动 + 设置页档案 CRUD + 任务卡模型徽标切换（轮次间生效） | 双档案建任务各跑一轮；徽标切换后下一轮用量落到新档案；旧 settings 迁移不丢 key |
| **M2 模型包** | contributes.models zod 段 + 内置示例档案包（DeepSeek 官方 / Ollama 本地）+ 错误账本 | 装包填 key 即可用；kind 未注册/k capabilities 缺失拒载有因 |
| **T1 任务型** | contributes.taskTypes + 内置 gitui.agent-presets（free/review/commit-message）+ 创建对话框选型 + 工具裁剪/策略收紧生效 | 审查预设任务无法调 file_write（模型收到无此工具）；strict 模式下 git_stage 弹卡 |
| **T2 会话管理** | fork/归档/删除 + fastModelId 分工路由（标题/摘要走轻档） | fork 出的新卡历史前缀一致且原任务不受影响；fast 路由单测 |
| **T3 预留** | 子代理 task.spawn / hooks / L3 循环贡献 | 触发条件见 §3.5 与 §15 |

测试：schema 负样本与收紧校验表驱动；解析链/迁移映射/fast 路由纯函数黄金用例；假 SSE 服务器冒烟复用（按档案×任务型矩阵各跑一轮）。

---

## 七、明确不做

- 不托管密钥/不做云端模型代理（本地优先不变）；不做在线模型市场（GitHub topic + 目录站，沿 v2 §一）；
- cli 桥不进循环（一次性补全保留）；子代理 / hooks / L3 循环贡献 v1 不实现（接口形状已定，触发再启动）；
- 任务型不提供"绕过人审"的策略（push 恒 each-time）；不做跨仓库共享的任务档案；
- 模型用量不做云端统计（本地累计，随 settings 存储）。

---

## 八、与既有文档的关系

| 文档 | 关系 |
|---|---|
| agent-harness.md v3.0 §3.1 | **被取代**：provider 三分支 + settings 单档 → ModelProfile 解析链（§2.2 迁移）；其余（循环/工具/会话/UI）不变 |
| extension-system-v2.md §五/§六 | 加段实现：contributes 增 models/taskTypes；PackageStore/账本/设置页机制零改动 |
| tool-agent-fusion.md §三 | 操作目录 = taskType.tools 裁剪与权限分级的作用对象 |
| extension-system-v2.md §十五 | agentLoop 贡献（L3）与 fastModelId 分工互补；"决策可下放，执行不下放"延续为 §3.2 收紧校验 |
| ai-native-redesign.md §8.1 | IAiGateway 的 provider 分支同样被档案化取代（其一次性补全用途走 fast 路由） |
