using GitUI.Diff.Highlighting;
using Xunit;

namespace GitUI.Render.Tests;

/// <summary>C# ALC 强类型插件契约（code-highlight-framework.md P4c）：装载/发现/注册/解析。</summary>
public class AssemblyHighlighterLoaderTests
{
    private static string? PluginDllPath()
    {
        // 插件工程随解决方案构建；标准输出布局从测试 bin 上溯 5 级到仓库根
        var path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..",
            "tests", "TestPlugins", "GitUI.TestHighlighterPlugin", "bin", "Debug", "net8.0",
            "GitUI.TestHighlighterPlugin.dll");
        return File.Exists(path) ? path : null;
    }

    [Fact]
    public void Loader_LoadsPluginAssembly_AndCreatesHighlighters()
    {
        var dll = PluginDllPath();
        if (dll is null)
        {
            return; // 插件未构建（跳过）
        }

        var highlighters = AssemblyHighlighterLoader.Load(dll);

        var h = Assert.Single(highlighters);
        Assert.Equal("plugin.testcs", h.Id);
        Assert.Contains(".testcs", h.Extensions);

        // 契约数据形状与声明式/脚本高亮器一致
        var r = h.TokenizeLine("todo: PLUGIN marker", LineState.None);
        Assert.Contains(r.Spans, s => s.StyleKey == "keyword" && s.Start == 6 && s.Length == 6);
    }

    [Fact]
    public void Loader_PluginRegistersIntoRegistry_AndResolves()
    {
        var dll = PluginDllPath();
        if (dll is null)
        {
            return;
        }

        var highlighters = AssemblyHighlighterLoader.Load(dll);
        foreach (var h in highlighters)
        {
            HighlighterRegistry.Register(h);
        }

        Assert.Equal("plugin.testcs", HighlighterRegistry.Resolve("x.testcs").Id);
    }
}
