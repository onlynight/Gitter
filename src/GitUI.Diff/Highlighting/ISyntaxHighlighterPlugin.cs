namespace GitUI.Diff.Highlighting;

/// <summary>
/// C# 强类型高亮插件契约（code-highlight-framework.md P4c）：
/// 扩展包在 syntax/plugins/*.dll 中提供本接口实现，经可收集 AssemblyLoadContext 装载。
/// 与声明式/脚本高亮器实现同一 <see cref="ISyntaxHighlighter"/> 数据契约。
/// 加载约束：插件程序集不得包含宿主 UI 依赖；异常由注册表隔离（跳过该插件）。
/// </summary>
public interface ISyntaxHighlighterPlugin
{
    /// <summary>创建本插件提供的全部高亮器（每次装载调用一次）。</summary>
    IEnumerable<ISyntaxHighlighter> CreateHighlighters();
}
