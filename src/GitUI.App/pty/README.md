# 随应用分发的终端宿主二进制

本目录下的二进制随 GitUI 一起分发，用于终端（TerminalPage）的多后端支持。
全部为 MIT 许可的开源构建产物。

## winpty/（winpty 兜底后端，P3）

| 文件 | 来源 |
|---|---|
| winpty.dll | node-pty prebuilds（rprichard/winpty，MIT） |
| winpty-agent.exe | 同上 |

用途：ConPTY 不可用的环境（RDP/非交互会话下伪控制台子进程 0xC0000142，
§11.10.5/§11.18）下的兜底后端——隐藏控制台 + agent 代理转发。

## openconsole/（OpenConsole handoff 后端，预留）

| 文件 | 来源 |
|---|---|
| OpenConsole.exe | node-pty third_party/conpty（microsoft/terminal，MIT） |
| conpty.dll | 同上 |

用途：ConPTY 收件箱路径（系统 conhost pty 模式）异常环境下的首选后端
（VSCode/ZCode 同款方案）。当前代码尚未接线（需 node-pty conpty.cc 的
signal-pipe 握手协议参考，见 known-issues.md），二进制先行就位。

## 版本策略

生产环境应固定到 node-pty 官方 Release 的对应版本（当前快照取自
node-pty 1.x prebuilds / third_party conpty 1.23.251008001）。
