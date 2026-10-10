/*
 * 构建期虚拟模块（build-pages.mjs 的 office-preview-runtime 插件注入 iframe 运行时代码）。
 */
declare module "virtual:officePreviewRuntime" {
  const js: string;
  export default js;
}
