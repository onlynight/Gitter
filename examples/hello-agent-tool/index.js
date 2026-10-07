// L2 入口示例（agent-harness-v4.md §14.4/§14.5 接缝）：
// ctx.registerAgentTool / registerPromptSection / registerContextCollector / registerCompactor
// 名称自动加 ext.<pkg>. 命名空间；返回的函数在包停用/卸载时由宿主调用。
module.exports = function activate(ctx) {
  ctx.registerAgentTool({
    id: "hello-ping",
    description: "返回 pong + 当前时间（示例 agent 工具）",
    permissionClass: "each-time",
    execute: async () => `pong @ ${new Date().toISOString()}`,
  });

  ctx.registerPromptSection({
    id: "dynamic-hint",
    slot: "context",
    order: 150,
    provide: () => "示例插件提示：本仓库的示例文件在 examples/ 目录下。",
  });

  return function dispose() {
    // 宿主 cleanup 已按包清理全部注册，这里可做额外资源释放
  };
};
