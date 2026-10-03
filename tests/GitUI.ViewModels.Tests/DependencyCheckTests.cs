using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>ViewModel 层纯度守卫：不得引用任何 UI / 图形栈 / git 实现。</summary>
public class DependencyCheckTests
{
    [Fact]
    public void ViewModels_DoNotReferenceUiOrGitAssemblies()
    {
        var refs = typeof(LogViewModel).Assembly.GetReferencedAssemblies()
            .Select(a => a.Name ?? string.Empty)
            .ToList();

        var forbidden = new[]
        {
            "Microsoft.UI", "Microsoft.Graphics", "Microsoft.WinUI", "WindowsBase",
            "PresentationFramework", "LibGit2Sharp", "GitUI.Git", "GitUI.App",
            "GitUI.Controls", "GitUI.Diff", "GitUI.Shell",
        };
        Assert.DoesNotContain(refs, r => forbidden.Any(f => r.StartsWith(f, StringComparison.OrdinalIgnoreCase)));

        Assert.Contains(refs, r => r == "GitUI.Core");
    }

    [Fact]
    public void LogFilterParser_IsPureStatic()
    {
        // 解析器可独立调用（不触发任何 UI/git 初始化）
        var f = LogFilterParser.Parse("author:x", 10, 0);
        Assert.Equal("x", f.Author);
    }
}
