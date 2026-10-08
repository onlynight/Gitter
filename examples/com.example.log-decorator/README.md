# log-decorator

L2 日志/预览/扫描示例：三个「观察型」钩子，全部**单点失败不扩散**。

> ⚠️ 需要 `settings.allowCodePlugins` 开启。

## 演示要点

| API | 演示 |
|---|---|
| `registerLogDecorator` | 约定式提交分类徽章（feat/fix/docs/revert/breaking） |
| `registerPreviewProvider` | SVG（html）与 Markdown（text）预览 |
| `registerScanner` | 基于 diff 的自定义扫描（可返回 `blocked`） |
| `registerPanel` | 只读 git API 面板 |
| `ctx.git` | `status()` / `log()` / `branches()` |
| `on("commit.created")` | 事件驱动刷新 |

## 单点失败语义

| 钩子 | 失败行为 |
|---|---|
| `registerLogDecorator` | 跳过该装饰器，其它装饰器继续 |
| `registerPreviewProvider` | 不报错（`path.extname` 查找，第一个匹配胜出） |
| `registerScanner` | 跳过该扫描器，其它扫描器继续 |
| `registerGate` | **抛异常视为放行**（`console.warn`，不阻塞主流程） |
| `registerPanel` | 渲染为 `（面板出错：<msg>）`，其它面板不受影响 |
| `registerCommitBlock` / `registerDiffNote` | 跳过该项 |

## 扫描器档位差异

| 来源 | 最高档位 |
|---|---|
| L1 `contributes.safetyRules` | **恒为 `warning`**（否决权保留给内置规则 + 人审） |
| L2 `registerScanner` | **可返回 `blocked`**（`allowCodePlugins` 门 = 审核渠道信任） |

## 装饰器约束

⚠️ **只读，不能改 commit 本体**——只能追加 `decorations` 数组：

```js
{ text: "feat", color: "#3FB950" }
```

## 预览提供者

按 `path.extname` **小写**匹配，**第一个匹配胜出**：

```js
ctx.registerPreviewProvider([".svg", "svg"], async (p, maxBytes) => {
  return { kind: "html", content: "...svg 字符串..." };
});
ctx.registerPreviewProvider([".md", ".markdown"], async (p) => {
  return { kind: "text", content: fs.readFileSync(p, "utf8") };
});
```

前导点会被规范化为 `.md` 小写（`normExt`）。
