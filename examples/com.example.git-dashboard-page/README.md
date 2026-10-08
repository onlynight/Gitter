# git-dashboard-page

渲染层页面示例：在侧栏新增一个独占槽位「Git 仪表盘」，展示最近提交、
响应仓库刷新、可暂存全部改动并跳转改动页。

## 演示要点

| 特性 | 位置 |
|---|---|
| 新增独占槽位（`slot` 缺省 = `id`） | `manifest.pages[0]` |
| RPC 权限域声明（`git.read` + `git.write`） | `manifest.pages[0].permissions` |
| Segoe Fluent 字形 + 16×16 SVG path 双图标形态 | `icon` / `svg` |
| 页面样式表（装载时注入、卸载时移除） | `styles: ["page.css"]` |
| 启动即装载（`lazy: false`） | `lazy` |
| 主题令牌 CSS 变量（自动跟随亮/暗与第三方主题包） | `page.css` |
| `%key%` i18n 页面标题 | `title: "%Nav_Dashboard%"` |
| `window.GITTER_KIT` 共享 React 单实例 | `page.js` 参数 |
| `GITTER_UI.registerPage(def, mount)` 注册 | `page.js` 末段 |
| caller 身份在 eval 期捕获（权限不回退的关键） | `page.js` `BOOT` |
| `useSyncExternalStore` 订阅宿主活 store | `useAppState()` |
| `pageSdk.call` RPC（权限域过滤） | `useRpc()` |
| `mount` 返回清理函数 | `root.unmount()` |
| `PageErrorBoundary` 包裹页面 | 注册处 |

## 三条硬约定

```js
// 1. React 来自 GITTER_KIT —— 自带 React 会双实例崩溃
var React = window.GITTER_KIT.React;

// 2. caller 必须在入口脚本 eval 期捕获
var BOOT = window.GITTER_UI.getActiveCaller();   // 注入窗口内可取
// 挂载时再读 loader 模块变量会永远回退缺省权限

// 3. 所有 RPC 走封装的 pageSdk.call
pageSdk.call("log.query", { limit: 8 })
```

## 槽位竞争

本示例 `slot: "dashboard"` = 新增槽位。**要替换内置页面**就声明内置槽位 id：

```jsonc
{ "id": "mylog", "slot": "log", "title": "我的 Log 页", "entry": "page.js" }
```

三级解析：**用户包 > 内置包 > 宿主内置组件**。内置提供者不可卸载、只可被替换。
停用某包的唯一页面提供者会被宿主拒绝（防槽位塌陷）。

## 页面被 keep-alive

访问过的槽位**保持挂载**，切页只切 `display:none`——终端回滚、列表勾选、
滚动位置、表单状态全部保留。真正卸载只发生在包热刷新或页面被停用。

## 权限域速查

| 调用 | 需要 |
|---|---|
| `log.query` / `changes.state` / `branches.state` | `git.read` |
| `changes.stage` / `changes.commit` | `git.write` |
| `commands.list` / `themes.list` / `settings.get` | `open`（恒放行） |
| `agent.task.create` | `agent.run` |
| `terminal.*` | `terminal` |
| 未收录的 RPC | **默认 `extensions.admin`**（默认拒绝） |

未声明的权限 → 调用被拒。缺省声明是 `["open","git.read"]`。

## ⚠️ 信任模型

页面是 **in-process** 的：RPC 权限域校验是 advisory（诚实插件有效），
恶意代码物理上可直连 `gitter.invoke` 绕过。**不要把页面包当沙箱用**——
真正的防线是 `allowCodePlugins` 审核渠道门 + 主进程人审门。

用户页面包需要 `allowCodePlugins` 开启才会出现在侧栏（内置页面包免门）。
