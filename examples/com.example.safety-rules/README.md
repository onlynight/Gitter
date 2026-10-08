# safety-rules

L1 安全类贡献：三个「只能加严」的机制 + 固定文件上下文注入。

## 四类贡献

### `safetyRules` —— 提交前内容扫描

| 项 | 说明 |
|---|---|
| 档位 | **恒为 warning**（否决权保留给内置规则 + 人审门） |
| `flags` | `g` 会被强制剥离（避免 `lastIndex` 状态泄漏），`i/m/s/y` 放行 |
| `fileExts` | 缺省 = 全部文本文件；带前导点会被规范化为 `.ts` 小写 |
| 非法正则 | 跳过该条规则，不影响其它规则与宿主存活 |

运行时 id：`pkg.safety-rules.no-secret` 等。

### `commandRiskRules` —— 终端命令风险分级

`risk ∈ "high" | "medium"`，**max 语义合并（只上调不下降）**。
影响终端命令的风险判断与授权卡文案。

### `agentPermissionRules` —— Agent 工具权限规则

⚠️ **`effect` 只能是字面量 `"deny"`**——包只能加严，不能放宽。
`pattern` 为 null 时匹配该工具的全部调用。

### `contextFiles` —— 固定文件注入上下文

`capChars` 范围 100..16_000，**运行时缺省 2000**。文件不存在时静默跳过。
