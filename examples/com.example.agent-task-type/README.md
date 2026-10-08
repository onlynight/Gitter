# agent-task-type

L1 任务型（`contributes.taskTypes`）：定义 Agent 任务的可复用「任务形态」，
出现在任务页的类型选择里。附带一个 `subagentPresets` 展示子代理预设。

## 演示要点

| 特性 | 位置 |
|---|---|
| `{input}` 占位符（**必填**，zod `refine` 强制） | 所有 `promptTemplate` |
| `systemAddendum` 系统提示追加 | 三项都有 |
| `tools` 白名单（全集子集，未知名编译期剔除） | `bugfix-lite`、`docs-only`、`readonly-audit` |
| `permissionPolicy` **只能收紧** `auto → session → each-time` | `docs-only.git_commit: each-time` |
| `maxSteps` 步数上限（1..200） | 三项 |
| `readonly: true` 进一步过滤为只读工具 | `subagentPresets[0]` |
| `timeoutMs` 夹在 30_000..1_800_000 | `subagentPresets[0]` |

## 任务型 id

```
ext.agent-task-type.bugfix-lite
ext.agent-task-type.docs-only
ext.agent-task-type.readonly-audit
```

## 工具名参考（`agents/tools.ts` PERM 键）

```
repo_status    repo_diff      repo_log       repo_read_file
repo_list_files repo_glob     repo_grep      review_get_state
file_write     file_patch
git_stage      git_commit     git_push
terminal_run   terminal_poll
ask_user       todo_write     plan_submit    task
```

## 与内置的关系

内置包 `gitui.agent-presets` 提供 `free` / `code-review` / `commit-message`。
本包的类型与之并列，不会覆盖。

> ⚠️ `git_push` **恒为 `each-time`**，无法在 `permissionPolicy` 中放宽。
