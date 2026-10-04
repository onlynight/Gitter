using System.Reflection;
using System.Runtime.Loader;

namespace GitUI.Diff.Highlighting;

/// <summary>
/// C# 强类型高亮插件装载器（code-highlight-framework.md P4c）：
/// 用可收集 AssemblyLoadContext 装载 syntax/plugins/*.dll，
/// 发现 <see cref="ISyntaxHighlighterPlugin"/> 实现并创建高亮器。
/// 插件对框架程序集（GitUI.Diff/Core）的解析走 Default ALC（同版本共享）。
/// </summary>
public static class AssemblyHighlighterLoader
{
    public static IReadOnlyList<ISyntaxHighlighter> Load(string dllPath)
    {
        var context = new PluginLoadContext(Path.GetFileNameWithoutExtension(dllPath));
        var assembly = context.LoadFromAssemblyPath(Path.GetFullPath(dllPath));

        var result = new List<ISyntaxHighlighter>();
        foreach (var type in assembly.GetTypes())
        {
            if (type.IsAbstract || !typeof(ISyntaxHighlighterPlugin).IsAssignableFrom(type))
            {
                continue;
            }

            try
            {
                if (Activator.CreateInstance(type) is not ISyntaxHighlighterPlugin plugin)
                {
                    continue;
                }

                result.AddRange(plugin.CreateHighlighters());
            }
            catch
            {
                // 单个插件类型故障 → 跳过（注册表层面继续）
            }
        }

        return result;
    }

    private sealed class PluginLoadContext : AssemblyLoadContext
    {
        public PluginLoadContext(string name) : base(name, isCollectible: true)
        {
        }

        /// <summary>null = 回退 Default ALC：框架/共享依赖与宿主共享同版本。</summary>
        protected override Assembly? Load(AssemblyName name) => null;
    }
}
