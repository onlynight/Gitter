# hello-command

最小的 L1 数据包：只有 `manifest.json` + `i18n/`，**没有代码入口**。
不需要 `allowCodePlugins` 即可生效。

## 演示要点

| 特性 | 位置 |
|---|---|
| `configuration` 配置项（string / boolean） | `contributes.configuration` |
| `${config.greeting}` / `${repo.branch}` 模板插值 | `commands[0].args.command` |
| `${file.path}` 右键菜单上下文插值 | `commands[2].args.path` |
| `when` 表达式（`repoOpen`、`fileSelected`、`config:verbose` 多 token AND） | `commands[].when` |
| `%key%` i18n（lang → en → 原样） | `commands[].title`、`category`、`emptyHints[].text` |
| `menus` 挂在 `changesFile` 右键菜单 | `contributes.menus` |
| `keybindings` 补 keyHint（不覆盖 manifest 显式声明） | `contributes.keybindings` |
| `emptyHints` 空态提示 | `contributes.emptyHints` |
| `confirm` 首跑确认覆盖 | `commands[1].confirm: false`（`terminal.run` 默认要确认） |

## 命令的运行时 id

宿主会自动加前缀，命令面板里看到的是：

```
ext.hello-command.greet
ext.hello-command.greet-verbose
ext.hello-command.reveal-file
```

## 关键限制

`commands[].action` 必须是宿主动作白名单之一，否则执行时抛
`不允许的宿主动作：<action>`（`detail: "ACTION_FORBIDDEN"`）：

```
terminal.run / shell.openPath / shell.reveal / repo.refresh /
agent.task.create / agent.task.resume
```

L1 命令**不能执行自定义逻辑**。要跑自己的代码请看 [`../com.example.commit-gate`](../com.example.commit-gate/)（L2）。
