# Git 命令手册

命令标题统一为「中文功能名 + 命令名」，每条命令包含**用途**、**常用参数**与**调用示例**；示例统一以 GitHub 仓库 `gitter-demo/todo-app` 为例。所有命令均可在终端页直接执行。

## 一、配置与仓库初始化

### 配置 git config
设置用户信息、编辑器、别名等；`--global` 写用户级配置（~/.gitconfig），缺省只作用于当前仓库。

| 参数 | 说明 |
| --- | --- |
| --global | 读写当前用户的全局配置 |
| --local | 读写当前仓库配置（默认） |
| --list | 列出配置项及其来源 |
| alias.名 "命令" | 定义命令别名，如 alias.st "status -sb" |

**示例**

```bash
git config --global user.name "wyndam"
git config --global user.email "wyndam@example.com"
git config --global alias.st "status -sb"       # 别名：git st
git config --global init.defaultBranch main     # 新仓库默认主分支名
git config --list --global
```

### 初始化仓库 git init
把当前目录初始化为 Git 仓库（生成 .git 目录）。

| 参数 | 说明 |
| --- | --- |
| 目录 | 在指定目录新建仓库 |
| -b 名 | 指定初始分支名 |
| --bare | 创建不带工作区的裸仓库（服务端用） |

**示例**

```bash
git init todo-app          # 新建 todo-app 仓库并初始化
git init -b main           # 当前目录初始化，初始分支叫 main
```

### 下载远程仓库 git clone
把 GitHub 等远端仓库完整复制到本地（自动配置 origin 远端并检出默认分支）。

| 参数 | 说明 |
| --- | --- |
| url | 仓库地址（HTTPS / SSH / 本地路径） |
| 目录 | 指定本地目录名 |
| -b 分支 | 克隆后直接检出指定分支 |
| --depth 1 | 浅克隆：只取最近一次提交 |
| --recurse-submodules | 同时拉取并初始化子模块 |

**示例**（HTTPS 与 SSH 两种写法）

```bash
git clone https://github.com/gitter-demo/todo-app.git
git clone git@github.com:gitter-demo/todo-app.git          # SSH 协议
git clone -b dev --depth 1 https://github.com/gitter-demo/todo-app.git todo-app-dev
```

## 二、日常高频命令

### 查看状态 git status
查看工作区与暂存区状态——用得最多的命令。

| 参数 | 说明 |
| --- | --- |
| -s | 短格式（两列状态码） |
| -b | 附显示分支与领先/落后 |
| --ignored | 额外列出被忽略的文件 |

**示例**

```bash
git status
git status -sb         # 分支信息 + 短格式
```

### 暂存改动 git add
把改动加入暂存区，等待提交。

| 参数 | 说明 |
| --- | --- |
| 文件… | 暂存指定文件 |
| . / -A | 暂存全部改动（含删除、重命名） |
| -p | 逐块（hunk）确认暂存 |
| -u | 只暂存已跟踪文件的改动 |

**示例**

```bash
git add src/app.ts        # 暂存单个文件
git add .                 # 暂存当前目录全部改动
git add -p                # 交互式逐块暂存
```

### 提交 git commit
把暂存区内容记录为一次新提交。

| 参数 | 说明 |
| --- | --- |
| -m "说明" | 直接指定提交信息 |
| -a | 自动暂存已跟踪文件改动后提交 |
| --amend | 修补上一次提交（追加改动 / 改信息） |
| --no-verify | 跳过 pre-commit 等钩子 |

**示例**

```bash
git commit -m "feat: add login page"
git commit -a -m "fix: typo in README"
git commit --amend -m "feat: add login page and validation"   # 修补上一提交
```

### 查看历史 git log
查看提交历史。

| 参数 | 说明 |
| --- | --- |
| --oneline | 单行显示（短 SHA + 标题） |
| --graph | ASCII 拓扑图 |
| -n | 只看最近 n 条 |
| -p 文件 | 附带该文件的 diff |
| --author / --since | 按作者 / 时间过滤 |

**示例**

```bash
git log --oneline --graph --all
git log -5
git log -p src/app.ts
git log --author="wyndam" --since="2026-01-01"
```

### 比较差异 git diff
比较工作区、暂存区与提交之间的差异。

| 参数 | 说明 |
| --- | --- |
| （无参） | 工作区 vs 暂存区 |
| --staged | 暂存区 vs HEAD |
| A..B | 两个提交 / 分支 / 标签之间 |
| --stat | 只显示改动统计 |

**示例**

```bash
git diff
git diff --staged
git diff dev..main          # dev 与 main 的差异
git diff v1.0 v1.1 --stat
```

### 分支管理 git branch
列出、创建、删除、重命名分支。

| 参数 | 说明 |
| --- | --- |
| （无参） | 列出本地分支（* 为当前） |
| -a | 含远程分支 |
| -d / -D | 删除（已合并 / 强制） |
| -m 新名 | 重命名当前分支 |

**示例**

```bash
git branch feature/login            # 创建分支
git branch -a
git branch -d feature/old
git branch -m main                  # 当前分支重命名为 main
```

### 切换与检出 git switch / git checkout
switch 专职切换分支（新语法）；checkout 兼负文件级恢复。

| 参数 | 说明 |
| --- | --- |
| switch -c 名 | 新建并切换 |
| switch - | 回到上一个分支 |
| checkout 文件 | 丢弃该文件工作区改动 |
| checkout 提交 -- 文件 | 恢复文件到指定提交版本 |

**示例**

```bash
git switch dev
git switch -c feature/login
git switch -
git checkout src/app.ts                   # 丢弃该文件未暂存改动
git checkout 9bb416d -- src/app.ts        # 恢复到指定提交的版本
```

### 合并分支 git merge
把指定分支合并进当前分支。

| 参数 | 说明 |
| --- | --- |
| --no-ff | 强制生成合并提交 |
| --squash | 压缩为一次待提交改动 |
| --abort | 冲突时放弃合并、回到合并前 |
| --continue | 冲突解决后完成合并 |

**示例**

```bash
git switch main
git merge dev                    # 把 dev 合入 main
git merge --no-ff feature/login  # 保留合并节点
# 冲突：编辑 <<<<<<< 标记的文件 → git add → git commit
```

### 变基 git rebase
把当前分支的提交「搬到」目标分支之上，历史保持线性。

| 参数 | 说明 |
| --- | --- |
| 基点 | 变基到指定分支 / 提交 |
| -i | 交互式整理提交（合并/改序/改信息） |
| --continue / --abort | 解决冲突后继续 / 中止 |
| --onto 目标 | 指定新基底的进阶用法 |

**示例**

```bash
git switch dev
git rebase main              # dev 变基到 main 最新
git rebase -i HEAD~3         # 交互式整理最近 3 个提交
```

### 储藏改动 git stash
把未完成的改动临时入栈，腾出干净工作区。

| 参数 | 说明 |
| --- | --- |
| push -m "说明" | 带说明入栈 |
| list / pop / apply | 列出 / 恢复并出栈 / 恢复但保留 |
| -u | 连未跟踪文件一起储藏 |
| drop 条目 | 删除指定条目 |

**示例**

```bash
git stash push -m "wip: login form"
git stash list
git stash pop                # 恢复最近一条并出栈
git stash -u                 # 含新文件
```

### 撤销改动 git reset / git restore
reset 移动分支指针；restore 专职恢复文件（新语法）。

| 参数 | 说明 |
| --- | --- |
| restore 文件 | 丢弃工作区改动 |
| restore --staged 文件 | 取消暂存（保留改动） |
| reset --soft HEAD~1 | 撤销提交，改动回到暂存区 |
| reset --mixed HEAD~1 | 撤销提交，改动回到工作区（默认） |
| reset --hard HEAD~1 | 彻底丢弃（危险，不可恢复） |

**示例**

```bash
git restore src/app.ts
git restore --staged src/app.ts
git reset --soft HEAD~1      # 撤销上次提交，改完再重新提交
```

### 拉取更新 git fetch / git pull
fetch 只取回远端更新不合并；pull = fetch + merge（或 rebase）。

| 参数 | 说明 |
| --- | --- |
| --all --prune | 取全部远端并清理失效引用 |
| pull --rebase | 取回后变基而非合并 |
| 远端 分支 | 指定远端与分支 |

**示例**

```bash
git fetch --all --prune
git pull
git pull --rebase origin dev
```

### 推送 git push
推送本地提交到远端（GitHub）。

| 参数 | 说明 |
| --- | --- |
| 远端 分支 | 推到指定远端分支 |
| -u | 首推并建立上游跟踪 |
| --force-with-lease | 安全强推（远端有新提交则拒绝） |
| 远端 --delete 分支 | 删除远程分支 |

**示例**

```bash
git push -u origin main
git push origin dev
git push --force-with-lease          # 谨慎使用强推
git push origin --delete dev
```

### 打标签 git tag
打标签，常用于版本发布点。

| 参数 | 说明 |
| --- | --- |
| -a 名 -m "说明" | 附注标签（含信息与时间） |
| -d 名 | 删除本地标签 |
| -l "模式" | 按模式列出 |

**示例**

```bash
git tag -a v1.0.0 -m "first release"
git tag -l "v1.*"
git push origin v1.0.0       # push 默认不带标签，需显式推
```

### 远端管理 git remote
管理远端仓库。

| 参数 | 说明 |
| --- | --- |
| -v | 列出远端地址 |
| add 名 url | 添加远端 |
| set-url 名 url | 修改远端地址 |
| remove 名 | 移除远端 |

**示例**

```bash
git remote add origin https://github.com/gitter-demo/todo-app.git
git remote -v
git remote set-url origin git@github.com:gitter-demo/todo-app.git
```

## 三、其余命令分类详解

以下命令按「用途 → 参数 → 示例」完整收录（含底层 plumbing 命令），格式与前文一致。

### 检查与历史

#### 查看对象 git show
显示某次提交、标签或对象的详情与 diff。
**参数**：`对象` 提交/标签/SHA · `--stat` 只看改动统计 · `--name-only` 只列文件名

```bash
git show v1.0.0
git show 9bb416d --stat
```

#### 按作者汇总 git shortlog
按作者分组汇总提交，常用于统计贡献。
**参数**：`-s` 只显示计数 · `-n` 按数量排序 · `-e` 显示邮箱

```bash
git shortlog -sn --since="2026-01-01"
```

#### 生成版本号 git describe
根据最近可达标签生成可读版本号（如 v1.0.0-3-g9bb416d）。
**参数**：`--tags` 含轻量标签 · `--abbrev=n` SHA 位数 · `--dirty` 附脏标记

```bash
git describe --tags --dirty      # 发布脚本里生成版本串
```

#### 行级追溯 git blame
逐行显示最后修改的提交。
**参数**：`-L 起,止` 限定行范围 · `-e` 显示邮箱 · `-w` 忽略空白改动

```bash
git blame -L 10,20 src/app.ts
```

#### 引用移动史 git reflog
记录本地 HEAD 与分支的移动历史，找回"丢失"提交的救命命令。
**参数**：`引用` 查看指定分支 · `--date=iso` 显示绝对时间

```bash
git reflog
git reset --hard HEAD@{2}        # 回到两次移动前的位置
```

#### 二分定位 git bisect
二分查找引入缺陷的提交。
**参数**：`start / bad / good` 标记区间 · `run 脚本` 自动化 · `reset` 结束

```bash
git bisect start
git bisect bad HEAD
git bisect good v1.0.0           # 自动切换提交，反复标记直到定位
git bisect reset
```

#### 内容搜索 git grep
在已跟踪内容中按模式搜索（只搜仓库内容，快）。
**参数**：`-n` 行号 · `-i` 忽略大小写 · `-e 模式` 多模式

```bash
git grep -n "TODO" -- "*.ts"
```

#### 区间对比 git range-diff
比较两段提交区间的差异（典型：变基前后）。
**参数**：`基..旧 基..新` 两个区间

```bash
git range-diff main...dev main...dev-rebased
```

#### 分支对照 git show-branch
以表格式对照各分支的提交覆盖情况。
**参数**：`-a` 含远程分支 · `分支…` 指定分支

```bash
git show-branch -a
```

#### 未合并检查 git cherry
列出当前分支有而上游没有的提交。
**参数**：`上游` 对比目标 · `-v` 显示标题

```bash
git cherry -v main
```

### 分支与整合

#### 摘取提交 git cherry-pick
把其他分支上的单个提交复制到当前分支。
**参数**：`-x` 记录来源 SHA · `-n` 只应用不提交 · `--continue / --abort` 冲突后续行/放弃

```bash
git cherry-pick 9bb416d
git cherry-pick A^..B            # 摘取 (A, B] 区间多个提交
```

#### 反向撤销 git revert
生成一条与目标提交相反的新提交来安全撤销（不改写历史，适合共享分支）。
**参数**：`-n` 只改不提交 · `-m 1` 撤销合并时选主线父提交

```bash
git revert 9bb416d
git revert -m 1 2e5be4f          # 撤销一次错误合并
```

#### 多工作树 git worktree
同一仓库检出多个工作目录并行开发。
**参数**：`add 路径 分支` 新增 · `list` 列出 · `remove` 移除

```bash
git worktree add ../todo-app-hotfix hotfix/urgent
git worktree list
```

#### 合并工具 git mergetool
调用配置的外部工具解决冲突。
**参数**：`-t 工具` 指定工具 · `--tool-help` 列出可用工具

```bash
git mergetool -t vscode
```

#### 冲突复用 git rerere
记录并自动复用已解决过的冲突方案。
**参数**：`status` 查看记录 · `forget 路径` 忘记某文件方案（需先 rerere.enabled）

```bash
git config --global rerere.enabled true
```

#### 公共祖先 git merge-base
求两个分支的最近公共祖先提交。
**参数**：`-a` 输出全部候选 · `--is-ancestor` 判断祖先关系（脚本用）

```bash
git merge-base main dev
git merge-base --is-ancestor v1.0.0 main && echo contained
```

### 远程与同步

#### 列出远端引用 git ls-remote
列出远端的分支/标签引用，不取回对象。
**参数**：`--heads` 只看分支 · `--tags` 只看标签 · `模式` 过滤

```bash
git ls-remote --heads https://github.com/gitter-demo/todo-app.git
```

#### 子模块 git submodule
在仓库里嵌套引用另一个仓库。
**参数**：`add url 路径` 添加 · `update --init` 拉取子模块 · `foreach` 遍历执行

```bash
git submodule add https://github.com/gitter-demo/lib-utils.git libs/utils
git clone --recurse-submodules https://github.com/gitter-demo/todo-app.git
git submodule update --init --recursive
```

#### 子树合并 git subtree
把别的仓库并入本仓库子目录（或拆出去），对协作者透明。
**参数**：`add --prefix=目录 url` 并入 · `pull / push` 同步 · `--squash` 不带历史

```bash
git subtree add  --prefix=libs/utils --squash https://github.com/gitter-demo/lib-utils.git main
git subtree pull --prefix=libs/utils --squash https://github.com/gitter-demo/lib-utils.git main
```

#### 拉取请求摘要 git request-pull
生成"请拉取 xx"摘要文本（含提交与 diffstat），邮件协作用。
**参数**：`基点 url 端点` 对比区间与仓库

```bash
git request-pull main https://github.com/wyndam/todo-app.git feature/login
```

### 打包与归档

#### 导出归档 git archive
把指定提交/标签的内容导出为 zip/tar（不含 .git）。
**参数**：`--format=zip` 格式 · `-o 文件` 输出

```bash
git archive --format=zip -o todo-app-v1.0.0.zip v1.0.0
```

#### 离线打包 git bundle
把分支及其对象打成单文件，可当远端用（离线/U盘传输）。
**参数**：`create 文件 分支` 打包 · `verify` 校验 · `clone 包 目录` 从包克隆

```bash
git bundle create todo-app.bundle main
git clone todo-app.bundle todo-app-offline
```

#### tar 提交号 git get-tar-commit-id
从 git archive 生成的 tar 流读出提交 SHA。
**参数**：从标准输入读 tar 流，无命令行参数

```bash
cat todo-app.tar | git get-tar-commit-id
```

### 补丁与协作

#### 导出补丁 git format-patch
把提交导出为带元数据的补丁文件（邮箱格式）。
**参数**：`-n` 最近 n 条 · `A..B` 区间 · `-o 目录` 输出目录

```bash
git format-patch main -o patches/     # dev 领先 main 的全部提交
```

#### 应用补丁 git am
应用 format-patch 补丁并保留作者/信息成提交。
**参数**：`补丁…` 文件 · `-3` 三方合并兜底 · `--abort` 放弃

```bash
git am patches/0001-*.patch
```

#### 应用 diff git apply
应用普通 diff/补丁（不生成提交）。
**参数**：`--stat` 预览 · `--check` 只校验可否应用 · `-R` 反向应用

```bash
git apply --check fix.diff && git apply fix.diff
```

#### 补丁指纹 git patch-id
计算补丁的稳定指纹，用于跨分支识别同一改动。
**参数**：`--stable` 稳定算法；diff 从标准输入读

```bash
git show 9bb416d | git patch-id --stable
```

#### 邮件发送 git send-email
把补丁以邮件发出（需配置 SMTP）。
**参数**：`--to / --cc` 收件人 · `--compose` 附说明信

```bash
git send-email patches/*.patch --to dev@example.com
```

#### 邮件拆解 git mailinfo / git mailsplit
把邮箱补丁拆成信息与正文 / 拆成单文件（am 的底层件）。
**参数**：mailinfo `信息文件 正文文件`；mailsplit `-o 目录` 输出目录

```bash
git mailsplit -o mails/ < inbox.mbox
```

#### 提交尾注 git interpret-trailers
解析或添加提交信息的尾注（Signed-off-by 等）。
**参数**：`--trailer "键=值"` 添加 · `--parse` 只取尾注

```bash
git interpret-trailers --trailer "Signed-off-by: wyndam <wyndam@example.com>" msg.txt
```

### 撤销与清理

#### 清理未跟踪 git clean
删除未跟踪文件（不带 -n/-f 会拒绝执行）。
**参数**：`-n` 预览 · `-f` 执行 · `-d` 含目录 · `-x` 连被忽略文件一起

```bash
git clean -nd          # 先预览
git clean -fd          # 删除未跟踪文件与目录
```

#### 移除文件 git rm
从版本控制（和工作区）移除文件。
**参数**：`--cached` 只从索引移除（保留本地文件） · `-r` 递归目录

```bash
git rm --cached secret.local       # 停止跟踪但保留文件
git rm -r legacy/
```

#### 移动重命名 git mv
移动/重命名已跟踪文件（等同 mv + rm + add）。
**参数**：`-f` 覆盖已存在目标

```bash
git mv src/app.ts src/main.ts
```

#### 对象替换 git replace
用一个对象替换另一个（不改原历史的矫正手段）。
**参数**：`旧 新` 建替换 · `-d` 删除替换 · `--graft 提交` 改父提交

```bash
git replace 9bb416d 2e5be4f
git replace -d 9bb416d
```

### 维护与诊断

#### 对象库整理 git gc
压缩松散对象、清理不可达对象、优化包。
**参数**：`--prune=时间` 清理时限 · `--aggressive` 深度优化（慢） · `--auto` 按阈值

```bash
git gc
git gc --prune=now --aggressive       # 偶尔手动彻底清理
```

#### 完整性检查 git fsck
检查对象库完整性，找悬空对象。
**参数**：`--lost-found` 悬空对象落盘 · `--unreachable` 列不可达对象

```bash
git fsck --lost-found
```

#### 对象统计 git count-objects
统计对象数量与体积。
**参数**：`-v` 详细 · `-H` 人类可读

```bash
git count-objects -vH
```

#### 重打包 git repack
把松散对象重新打包。
**参数**：`-d` 打包后删冗余 · `-a` 全量打进一个包

```bash
git repack -ad
```

#### 清理不可达 git prune
删除全部不可达对象（gc 的一环）。
**参数**：`-n` 预览 · `--expire 时间` 只清理早于该时间的

```bash
git prune --expire 30.days.ago
```

#### 清已打包对象 git prune-packed
删除已经打进包里的松散对象。
**参数**：`-n` 预览

```bash
git prune-packed
```

#### 后台维护 git maintenance
注册/执行定期维护任务（gc、commit-graph、prefetch 等）。
**参数**：`start` 注册后台任务 · `run --task=任务` 立即执行

```bash
git maintenance start
git maintenance run --task=gc
```

#### 提交图 git commit-graph
生成提交图加速文件（log 等明显提速）。
**参数**：`write` 生成 · `--reachable` 覆盖全部引用 · `verify` 校验

```bash
git commit-graph write --reachable
```

#### 多包索引 git multi-pack-index
为多个包文件建统一索引，加速大仓库查找。
**参数**：`write` 生成 · `--bitmap` 附位图 · `verify` 校验

```bash
git multi-pack-index write
```

#### 引用打包 git pack-refs
把零散引用打包成单个文件。
**参数**：`--all` 含全部分支 · `--prune` 清理已打包散引用

```bash
git pack-refs --all --prune
```

#### 包校验 git verify-pack
校验包文件完整性与对象统计。
**参数**：`-v` 详细（按大小排序） · `-s` 简要

```bash
git verify-pack -v .git/objects/pack/*.idx
```

#### 诊断报告 git bugreport
收集版本与环境信息生成 bug 报告骨架。
**参数**：`-o 目录` 输出目录 · `-s 前缀` 文件名前缀

```bash
git bugreport
```

#### 本地网页 git instaweb
起一个本地网页服务浏览仓库（需 CGI 支持）。
**参数**：`--httpd=服务` 指定服务器 · `--stop` 停止

```bash
git instaweb --httpd=webrick
git instaweb --stop
```

### 服务端与协议

自建 Git 服务 / 底层传输用，日常本地开发基本接触不到。

#### Git 守护进程 git daemon
以 git:// 协议对外提供只读仓库服务。
**参数**：`--export-all` 免标记导出全部 · `--base-path=目录` 仓库根 · `--port=端口`

```bash
git daemon --base-path=/srv/git --export-all
```

#### 受限登录 shell git shell
只允许执行 git 传输命令的受限 shell（服务端账号专用）。
**参数**：`-c "命令"` 执行限定命令；交互式给出帮助

```bash
git shell -c "git-upload-pack '/gitter-demo/todo-app.git'"
```

#### HTTP 服务端 git http-backend
作为 CGI 提供 smart HTTP 协议（配 nginx/Apache）。
**参数**：经环境变量 GIT_PROJECT_ROOT / GIT_HTTP_EXPORT_ALL 配置

```bash
GIT_PROJECT_ROOT=/srv/git GIT_HTTP_EXPORT_ALL=1 git http-backend
```

#### HTTP 客户端 git http-fetch / git http-push
HTTP 协议底层拉取/推送（哑协议时代客户端，多被 smart 协议取代）。
**参数**：`提交 url` 目标与地址 · `-w` 写回引用（push）

```bash
git http-fetch 9bb416d https://github.com/gitter-demo/todo-app.git
```

#### 传输底层 git fetch-pack / send-pack / receive-pack / upload-pack
fetch/push 的底层实现对：客户端 fetch-pack/send-pack 与服务端 upload-pack/receive-pack 协商并传输打包对象。
**参数**：`--all` 全部引用 · `--thin` 精简包；服务端通常由 ssh/http 通路自动调用

```bash
git upload-pack --advertise-refs .      # 查看服务端协商引用（调试用）
git fetch-pack --all ./
```

#### 哑协议辅助 git update-server-info
为哑协议 HTTP 服务生成 info/refs 等辅助文件。
**参数**：`-f` 强制重写

```bash
git update-server-info
```

### 其他实用

#### 稀疏检出 git sparse-checkout
只检出仓库的部分目录（monorepo 提效）。
**参数**：`init` 启用 · `set 目录…` 设定集合 · `list` 列出 · `disable` 关闭

```bash
git sparse-checkout set --cone packages/web packages/sdk
```

#### 暂存同义词 git stage
git add 的完全同义词（语义化别名）。
**参数**：与 git add 完全一致

```bash
git stage src/app.ts
```

#### 读逻辑变量 git var
读取 Git 的逻辑变量（编辑器、分页器等）。
**参数**：`-l` 列出全部 · `变量` 取单个

```bash
git var GIT_EDITOR
```

#### 签名校验 git verify-commit / git verify-tag
校验提交 / 标签的 GPG 签名。
**参数**：`-v` 显示签名详情 · `--raw` 机器可读输出

```bash
git verify-commit 9bb416d
git verify-tag v1.0.0
```

#### 邮箱映射 git check-mailmap
把名字/邮箱按 mailmap 规则映射为规范身份。
**参数**：`联系人…` 待映射项

```bash
git check-mailmap "wyndam <wyndam@example.com>"
```

#### 图形界面 git gui / git citool
内置 Tcl/Tk 图形提交界面（citool = 提交后即退出）。
**参数**：`--amend` 进入修补模式

```bash
git citool
```

#### 帮助 git help
查看命令文档（等同 git 命令 --help）。
**参数**：`-g` 概念指南 · `-a` 全部命令列表 · `命令` 指定命令

```bash
git help rebase
```

### 底层命令 · 对象与引用

plumbing：脚本与工具使用的底层接口，日常交互用不到。

#### 读对象 git cat-file
输出对象内容/类型/大小。
**参数**：`-t / -s` 类型/大小 · `-p` 优雅输出

```bash
git cat-file -p HEAD^{tree}
```

#### 算哈希 git hash-object
计算 blob 哈希（可写入对象库）。
**参数**：`-w` 写入对象库 · `--stdin` 从标准输入读

```bash
echo hello | git hash-object --stdin
```

#### 列索引文件 git ls-files
列出索引中的文件。
**参数**：`-s` 状态模式 · `--others` 未跟踪 · `--ignored` 被忽略

```bash
git ls-files --others --exclude-standard    # 未跟踪文件清单
```

#### 列树内容 git ls-tree
列出树对象内容（模式/类型/名称）。
**参数**：`-r` 递归 · `-t` 含树本身 · `-l` 附对象大小

```bash
git ls-tree -r v1.0.0 --name-only
```

#### 解析引用 git rev-parse
把任意引用/表达式解析为 SHA，兼查仓库信息。
**参数**：`--verify` 严格校验 · `--short` 短 SHA · `--show-toplevel` 仓库根

```bash
git rev-parse --short HEAD
git rev-parse --show-toplevel
```

#### 列提交集合 git rev-list
按条件列出可达提交集合（log 的底层件）。
**参数**：`--count` 只计数 · `--left-right` 分侧标记 · `A..B` 区间

```bash
git rev-list --count main..dev
```

#### 符号引用 git symbolic-ref
读写符号引用（如 HEAD 指向哪个分支）。
**参数**：`引用` 读取 · `引用 目标` 设置 · `--short` 显示短名

```bash
git symbolic-ref --short HEAD       # 当前分支名
git symbolic-ref HEAD refs/heads/main
```

#### 更新引用 git update-ref
安全地写一个引用（含事务与旧值校验）。
**参数**：`-d` 删除 · `--no-deref` 不解引用 · 附旧值做 CAS 校验

```bash
git update-ref refs/heads/dev 9bb416d
```

#### 遍历引用 git for-each-ref
按格式列出全部引用（分支/标签清单的底层件）。
**参数**：`--format=模板` 输出格式 · `--count=n` 条数 · `--sort=键` 排序

```bash
git for-each-ref --format="%(refname:short) %(objectname:short)" refs/heads/
```

#### 更新索引 git update-index
直接操作索引条目（注册/删除/标记忽略改动等）。
**参数**：`--add / --remove` 注册删除 · `--assume-unchanged` 忽略改动 · `--refresh` 刷新

```bash
git update-index --assume-unchanged config.local
```

#### 索引写出树 git write-tree
从当前索引写出一个树对象（返回其 SHA）。
**参数**：`--missing-ok` 允许缺失对象 · `--prefix=目录` 只写子树

```bash
TREE=$(git write-tree)
```

#### 树读入索引 git read-tree
把树对象读入索引（不含工作区）。
**参数**：`-u` 同步工作区 · `-m` 合并模式 · `--prefix=目录` 读入子路径

```bash
git read-tree --prefix=lib/ -u lib-utils-main
```

#### 造树对象 git mktree
从标准输入的 ls-tree 格式行造一个树对象。
**参数**：`-z` NUL 分隔输入 · `--missing` 允许对象缺失

```bash
git ls-tree HEAD | git mktree
```

#### 造标签对象 git mktag
按标签对象格式创建 tag 对象并校验。
**参数**：内容从标准输入读，无命令行参数

```bash
git mktag < signed-tag.txt
```

#### 造提交对象 git commit-tree
从树对象创建提交对象（commit 的底层件）。
**参数**：`-p 父` 父提交（可多次） · `-m 信息` 提交信息

```bash
git commit-tree $TREE -p HEAD -m "snapshot"
```

#### 从索引检出 git checkout-index
把索引内容批量复制到工作区（部署导出用）。
**参数**：`-a` 全部 · `--prefix=目录` 输出前缀

```bash
git checkout-index -a --prefix=/tmp/export/
```

### 底层命令 · 比较、合并与打包

#### 树间差异 git diff-tree
比较两个树对象的差异。
**参数**：`-r` 递归 · `--name-only` 只列文件 · `--stdin` 从输入读提交

```bash
git diff-tree -r --name-only 9bb416d 2e5be4f
```

#### 索引差异 git diff-index
比较树对象与索引（--cached）或工作区的差异。
**参数**：`--cached` 只比索引 · `-p` 输出补丁

```bash
git diff-index --cached HEAD
```

#### 工作区差异 git diff-files
比较索引与工作区的差异（git diff 的底层件）。
**参数**：`-p` 输出补丁

```bash
git diff-files -p
```

#### 单文件三方合并 git merge-file
把两个文件相对共同基点的改动合并进第一个文件。
**参数**：`-p` 输出而不改文件 · `--ours / --theirs` 冲突取侧

```bash
git merge-file current.txt base.txt other.txt
```

#### 索引驱动合并 git merge-index
对索引中指定状态的文件逐个调用合并脚本。
**参数**：`脚本 -a` 对全部冲突文件执行

```bash
git merge-index git-merge-one-file -a
```

#### 生成合并信息 git fmt-merge-msg
根据合并的引用列表生成默认合并提交信息。
**参数**：`--log` 附提交清单；引用行从标准输入读

```bash
git fmt-merge-msg --log < .git/FETCH_HEAD
```

#### 属性检查 git check-attr
查询 gitattributes 规则对路径的命中。
**参数**：`-a` 全部属性 · `属性… 路径…` 指定属性与路径

```bash
git check-attr -a -- src/app.ts
```

#### 忽略检查 git check-ignore
查询 gitignore 规则是否命中路径（调试 ignore 用）。
**参数**：`-v` 显示命中的规则行

```bash
git check-ignore -v build/output.js
```

#### 打包对象 git pack-objects
按给定对象清单生成打包文件。
**参数**：`--revs` 从 rev 参数推导集合 · `--stdout` 输出到标准输出

```bash
git rev-list --objects --all | git pack-objects pack_NAME
```

#### 包索引 git index-pack
为已有包文件生成 .idx 索引。
**参数**：`-o idx` 输出 · `--stdin` 从标准输入读

```bash
git index-pack -o pack.idx pack.pack
```

#### 解包对象 git unpack-objects
把包文件解成松散对象。
**参数**：`-n` 只演练；包从标准输入读

```bash
git unpack-objects < pack.pack
```

#### 解出单对象 git unpack-file
把一个 blob 解出到临时文件并返回路径。
**参数**：`blob` 对象 SHA

```bash
git unpack-file 9bb416d
```

#### 流式导出 git fast-export
把历史导出为可脚本处理的流格式。
**参数**：`--all` 全部引用 · `--signed-tags=strip` 签名处理

```bash
git fast-export --all > repo.dump
```

#### 流式导入 git fast-import
从 fast-export 流格式导入历史（迁移工具通用后端）。
**参数**：`--quiet` 静默；流从标准输入读

```bash
git fast-import < repo.dump
```

### 版本控制桥接

#### Subversion 桥接 git svn
Subversion 仓库双向同步。
**参数**：`clone svn地址` 克隆 · `dcommit` 推回 · `rebase` 拉取

```bash
git svn clone https://example.com/svn/todo-app -T trunk
git svn rebase && git svn dcommit
```

#### Perforce 桥接 git p4
Perforce 仓库双向同步。
**参数**：`clone //depot/路径` 克隆 · `submit` 推回 · `rebase` 拉取

```bash
git p4 clone //depot/project@all
git p4 rebase && git p4 submit
```

## 四、附录：全部命令字母序索引

完整命令清单，按字母序排列供快速定位；参数与示例见对应分类章节。

| 命令 | 一句话 | 章节 |
| --- | --- | --- |
| git add | 暂存改动 | 二 |
| git am | 应用邮箱补丁为提交 | 三·补丁与协作 |
| git apply | 应用 diff / 补丁 | 三·补丁与协作 |
| git archive | 按提交导出 zip/tar 归档 | 三·打包与归档 |
| git bisect | 二分定位坏提交 | 三·检查与历史 |
| git blame | 逐行追溯修改来源 | 三·检查与历史 |
| git branch | 分支管理 | 二 |
| git bugreport | 生成诊断报告 | 三·维护与诊断 |
| git bundle | 离线打包引用与对象 | 三·打包与归档 |
| git cat-file | 读取对象内容（plumbing） | 三·对象与引用 |
| git check-attr | 查询 gitattributes 命中 | 三·比较合并与打包 |
| git check-ignore | 查询 gitignore 命中 | 三·比较合并与打包 |
| git check-mailmap | 邮箱映射查询 | 三·其他实用 |
| git checkout | 切换分支 / 恢复文件 | 二 |
| git checkout-index | 从索引批量检出 | 三·对象与引用 |
| git cherry | 列出未被上游合并的提交 | 三·检查与历史 |
| git cherry-pick | 摘取单个提交 | 三·分支与整合 |
| git citool | 图形化提交工具 | 三·其他实用 |
| git clean | 清理未跟踪文件 | 三·撤销与清理 |
| git clone | 下载远程仓库 | 一 |
| git commit | 提交暂存区 | 二 |
| git commit-graph | 生成提交图加速文件 | 三·维护与诊断 |
| git commit-tree | 底层创建提交对象 | 三·对象与引用 |
| git config | 配置 | 一 |
| git count-objects | 对象统计 | 三·维护与诊断 |
| git daemon | git:// 只读服务 | 三·服务端与协议 |
| git describe | 生成可读版本号 | 三·检查与历史 |
| git diff | 比较差异 | 二 |
| git diff-files | 工作区差异（plumbing） | 三·比较合并与打包 |
| git diff-index | 索引/树差异（plumbing） | 三·比较合并与打包 |
| git diff-tree | 树间差异（plumbing） | 三·比较合并与打包 |
| git fast-export | 历史流式导出 | 三·比较合并与打包 |
| git fast-import | 历史流式导入 | 三·比较合并与打包 |
| git fetch | 取回远端更新 | 二 |
| git fetch-pack | 底层拉取打包对象 | 三·服务端与协议 |
| git fmt-merge-msg | 生成合并提交信息 | 三·比较合并与打包 |
| git for-each-ref | 格式化列出引用 | 三·对象与引用 |
| git format-patch | 导出补丁邮件 | 三·补丁与协作 |
| git fsck | 对象库完整性检查 | 三·维护与诊断 |
| git gc | 对象库回收整理 | 三·维护与诊断 |
| git get-tar-commit-id | 从 tar 读提交号 | 三·打包与归档 |
| git grep | 仓库内容搜索 | 三·检查与历史 |
| git gui | 图形界面 | 三·其他实用 |
| git hash-object | 计算 blob 哈希 | 三·对象与引用 |
| git help | 帮助文档 | 三·其他实用 |
| git http-backend | smart HTTP 服务端 | 三·服务端与协议 |
| git http-fetch | HTTP 底层拉取 | 三·服务端与协议 |
| git http-push | HTTP 底层推送 | 三·服务端与协议 |
| git index-pack | 为包生成索引 | 三·比较合并与打包 |
| git init | 初始化仓库 | 一 |
| git instaweb | 本地网页浏览仓库 | 三·维护与诊断 |
| git interpret-trailers | 解析/添加提交尾注 | 三·补丁与协作 |
| git log | 查看历史 | 二 |
| git ls-files | 列出索引文件 | 三·对象与引用 |
| git ls-remote | 列出远端引用 | 三·远程与同步 |
| git ls-tree | 列出树对象 | 三·对象与引用 |
| git mailinfo | 拆解邮件补丁信息 | 三·补丁与协作 |
| git mailsplit | 拆分邮箱为单文件 | 三·补丁与协作 |
| git maintenance | 后台定期维护 | 三·维护与诊断 |
| git merge | 合并分支 | 二 |
| git merge-base | 求公共祖先 | 三·分支与整合 |
| git merge-file | 单文件三方合并 | 三·比较合并与打包 |
| git merge-index | 索引驱动合并 | 三·比较合并与打包 |
| git mergetool | 冲突解决工具 | 三·分支与整合 |
| git mktag | 创建标签对象 | 三·对象与引用 |
| git mktree | 创建树对象 | 三·对象与引用 |
| git multi-pack-index | 多包统一索引 | 三·维护与诊断 |
| git mv | 移动 / 重命名文件 | 三·撤销与清理 |
| git p4 | Perforce 桥接 | 三·版本控制桥接 |
| git pack-objects | 打包对象 | 三·比较合并与打包 |
| git pack-refs | 引用打包 | 三·维护与诊断 |
| git patch-id | 补丁指纹 | 三·补丁与协作 |
| git prune | 清理不可达对象 | 三·维护与诊断 |
| git prune-packed | 清已打包松散对象 | 三·维护与诊断 |
| git pull | 取回并合并 | 二 |
| git push | 推送 | 二 |
| git read-tree | 树读入索引 | 三·对象与引用 |
| git rebase | 变基 | 二 |
| git reflog | 引用移动史 | 三·检查与历史 |
| git remote | 远端管理 | 二 |
| git repack | 重打包 | 三·维护与诊断 |
| git replace | 对象替换 | 三·撤销与清理 |
| git request-pull | 拉取请求摘要 | 三·远程与同步 |
| git rerere | 复用冲突解决方案 | 三·分支与整合 |
| git reset | 重置 HEAD / 分支 | 二 |
| git restore | 恢复工作区 / 暂存 | 二 |
| git rev-list | 列出提交集合 | 三·对象与引用 |
| git rev-parse | 引用解析 | 三·对象与引用 |
| git revert | 反向提交撤销 | 三·分支与整合 |
| git rm | 移除文件 | 三·撤销与清理 |
| git send-email | 邮件发送补丁 | 三·补丁与协作 |
| git send-pack | 底层推送打包对象 | 三·服务端与协议 |
| git shell | 受限登录 shell | 三·服务端与协议 |
| git shortlog | 按作者汇总 | 三·检查与历史 |
| git show | 查看对象详情 | 三·检查与历史 |
| git show-branch | 分支提交对照 | 三·检查与历史 |
| git sparse-checkout | 稀疏检出 | 三·其他实用 |
| git stage | add 的同义词 | 三·其他实用 |
| git stash | 改动储藏 | 二 |
| git status | 查看状态 | 二 |
| git submodule | 子模块管理 | 三·远程与同步 |
| git subtree | 子目录合并 / 拆分 | 三·远程与同步 |
| git switch | 切换分支 | 二 |
| git svn | Subversion 桥接 | 三·版本控制桥接 |
| git symbolic-ref | 读写符号引用 | 三·对象与引用 |
| git tag | 标签管理 | 二 |
| git unpack-file | 解出 blob 到临时文件 | 三·比较合并与打包 |
| git unpack-objects | 解包对象 | 三·比较合并与打包 |
| git update-index | 更新索引 | 三·对象与引用 |
| git update-ref | 更新引用 | 三·对象与引用 |
| git update-server-info | 哑协议辅助文件 | 三·服务端与协议 |
| git upload-archive | 服务端归档服务 | 三·服务端与协议 |
| git upload-pack | 服务端拉取服务 | 三·服务端与协议 |
| git var | 读取逻辑变量 | 三·其他实用 |
| git verify-commit | 验证提交签名 | 三·其他实用 |
| git verify-pack | 校验包完整性 | 三·维护与诊断 |
| git verify-tag | 验证标签签名 | 三·其他实用 |
| git worktree | 多工作树 | 三·分支与整合 |
| git write-tree | 索引写出树对象 | 三·对象与引用 |
