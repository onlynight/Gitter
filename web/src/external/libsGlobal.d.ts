/**
 * window.GITTER_LIBS 全局声明（库贡献注册点，页面包拆分方案 S1/S3）。
 * 值面由各库自管（脚本 eval 时挂载）；具体库的静态类型经 src/external/* 访问面
 * 提供（monacoLibAccess.ts），这里只保证注册点存在与可探测。
 */
interface Window {
  GITTER_LIBS?: Record<string, unknown>;
}
