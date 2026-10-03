using Xunit;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>渲染管线的纯度守卫：管线所在程序集不得引用任何 UI / 图形栈。</summary>
public class DependencyCheckTests
{
    [Fact]
    public void RenderPipeline_DoesNotReferenceUiAssemblies()
    {
        var refs = typeof(DiffRenderModel).Assembly.GetReferencedAssemblies()
            .Select(a => a.Name ?? string.Empty)
            .ToList();

        var forbidden = new[] { "Microsoft.UI", "Microsoft.Graphics", "Microsoft.WinUI", "WindowsBase", "PresentationFramework", "LibGit2Sharp", "GitUI.Git", "GitUI.App" };
        Assert.DoesNotContain(refs, r => forbidden.Any(f => r.StartsWith(f, StringComparison.OrdinalIgnoreCase)));

        // 允许的最小引用面：Core（模型/引擎接口）
        Assert.Contains(refs, r => r == "GitUI.Core");
    }

    [Fact]
    public void Palette_HasNoUiDependency()
    {
        // 调色板可独立构造（不触发任何 UI 初始化）
        var p = DiffPalette.Dark;
        Assert.NotEqual(default(RgbaColor), p[DiffColorKind.Foreground]);
    }
}
