# tools/ide-extension

AuraLang 生态两个 VS Code 扩展的 **Gitter 语法插件包**。

本目录是**双栈共享的静态资产源**：

- `aura-vscode-extension/`、`hat-vscode-extension/` 既是 VS Code 扩展工作目录（`package.json` + `src/*.ts` + LSP 客户端，由上游 AuraLang 仓库维护），
  也是 Gitter 插件的**语法资产来源**——两者共用同一份 `syntaxes/*.tmLanguage.json`，避免双份漂移。
- 新增的 `manifest.json` 是 Gitter 侧的清单（`schemaVersion: 2` + `contributes.grammars`），
  与 VS Code 的 `package.json` **并存、互不干扰**。

## 包清单

| Gitter 包 id | 源目录 | 语言 | 扩展名 | scopeName | 上游版本 |
|---|---|---|---|---|---|
| `aura-lang.language` | `aura-vscode-extension/` | Aura（NovaOS 系统级脚本语言） | `.aura` | `source.aura` | 0.3.0 |
| `aura-lang.hat-language` | `hat-vscode-extension/` | HAT（HIR-Advanced Text，AuraLang SSA IR v3.0） | `.hat` | `source.hat` | 3.0.3 |

两个包都是 **L1 纯数据**（`contributes.grammars`，无 `entry`，无权限门控）——装上即可用，
不启 L2 代码加载（`settings.allowCodePlugins`）。

## 构建 .gpk

```powershell
cd tools/ide-extension
node build-gitter-packages.mjs
```

产出 `dist/*.gpk`：

- `aura-lang.language-0.3.0.gpk`
- `aura-lang.hat-language-3.0.3.gpk`

构建脚本会：

1. **manifest 语法路径校验**——`contributes.grammars[].path` 声明的文件必须真存在，否则 `GrammarService` 会静默降级。
2. **字节对齐检查**——把 `syntaxes/*.tmLanguage.json` 与上游 AuraLang 检出（默认 `../../..\\AuraLang/tools/ide-extension`，
   可用 `AURALANG_ROOT` 覆盖）做**行尾归一化后的字节比对**（LF/CRLF 差异是 `core.autocrlf` 造成，对 TextMate 无语义）。
   漂移不阻塞常规构建（上游检出可能已过期），但 `--check-sync` 模式下阻塞：

   ```powershell
   node build-gitter-packages.mjs --check-sync   # 只检查不产出，漂移即 exit 1
   ```

3. **宿主同源 zod 校验**——用 `app/dist/services/extensions/schema.js` 的 `normalizeManifest`
   确认可被 `PackageStore` 装载（需先 `cd app; npm run build`；`--no-verify` 跳过）。

## 安装到 Gitter

三选一：

1. **UI 导入**——Gitter → 设置 → 扩展 → 导入扩展包，选择 `.gpk` 文件。
2. **目录拷贝**——把目录（解压后的 `.gpk` 内容，或直接把本目录下的 `aura-vscode-extension/`
   / `hat-vscode-extension/` 复制）拷进 `<userData>/packages/<包 id>/`。
   Windows 通常是 `%APPDATA%/gitter/packages/aura-lang.language/`。
3. **本地目录站**——`node scripts/serve-catalog.mjs <包根>`，Gitter 用 `extensions.installFromCatalog`。

导入后设置 → 扩展 里能看到两个包，`grammar` kind 徽标为启用态。停用语法（点击 grammar 徽标）
即时下线，不影响其它 kind。

## 验证（无头冒烟）

```powershell
cd app
npm run build
node dist/smoke-gitter-exts.js
```

冒烟覆盖（`app/src/smoke-gitter-exts.ts`）：

- 两个 manifest 通过宿主同源 zod 校验，`kind` 推导为 `grammar`，默认激活（未被账本禁用）
- `contributes.grammars` 字段齐全（`language`/`scopeName`/`extensions`/`path`）
- TextMate 真实分词 `.aura`（39 runs）与 `.hat`（23 runs），非降级到声明式引擎或 plain
- 多前景色命中（scope → 主题 `tokenColors` 链路生效）
- `TokenRun` 边界覆盖整行（不丢字符）
- 未知扩展名 → `null`（降级链入口行为不变）
- `kinds.grammar=false` → 语法下线（设置页停用即时生效）

## 与 VS Code 扩展的分工

| 能力 | VS Code 扩展（`package.json` + `src/*.ts`） | Gitter 包（`manifest.json`） |
|---|---|---|
| TextMate 语法着色 | ✅ | ✅（本目录的 `.gpk`） |
| 语言识别（语言 id / 扩展名绑定） | ✅ | ✅（`contributes.grammars[].extensions`） |
| 文件图标 / 文件类型 | ✅ | ❌ Gitter 无对位贡献点 |
| 代码补全 / 跳转定义 / 悬停 | ✅（`src/client.ts` LSP 客户端） | ❌ Gitter 无对位宿主能力 |
| 诊断推送 | ✅ | ❌ |
| 代码片段 | ✅ | ❌ Gitter 无 `contributes.snippets` |
| 配色覆盖 | ✅（`colors/hat-colors.json`、`configurationDefaults`） | ❌ 但 HAT 语法 scope 名与上游 `hat-colors.json` 对齐，用户可自建 Gitter 主题包复用同一份 `tokenColors` |

**为什么语法不复制到 `app/resources/packages/`**：

- 语法资产已在 `tools/ide-extension/`，作为 VS Code 与 Gitter 的共享来源。
- 复制到 `app/resources/packages/` 会引入**双份**，需人工同步。
- Gitter 的扩展系统本就是「用户包」模型：`userData/packages/<id>/` 是官方装载根之一，
  与 `app/resources/packages/` 走同一 `PackageStore` 扫描路径，无能力差异。

如果后续决定内置化，直接加一条 `scripts/gen-default-packages.mjs` 步骤从本目录生成到
`app/resources/packages/aura-lang.language/` 即可，不需要改宿主。

## 上游同步

AuraLang 仓库更新语法后：

```powershell
# 1. 重新拷贝语法（覆盖 Gitter 侧）
xcopy /Y /V D:\Code\AuraLang\tools\ide-extension\aura-vscode-extension\syntaxes\* aura-vscode-extension\syntaxes\
xcopy /Y /V D:\Code\AuraLang\tools\ide-extension\hat-vscode-extension\syntaxes\* hat-vscode-extension\syntaxes\

# 2. 校验漂移
node build-gitter-packages.mjs --check-sync

# 3. 更新 manifest.json 的 version（对齐上游 package.json 的 version）
# 4. 重新构建
node build-gitter-packages.mjs
```

上游若有 scope 重命名，需要评估是否要调整内置主题的 `tokenColors` 覆盖
（如 `app/resources/packages/theme.tm.*`），否则可能出现「分词正常但主题不配色」。
