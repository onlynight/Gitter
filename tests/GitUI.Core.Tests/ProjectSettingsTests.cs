using GitUI.Core.Models;
using GitUI.Core.Settings;
using Xunit;

namespace GitUI.Core.Tests;

/// <summary>项目列表（Projects / CurrentProjectPath）的归一化与持久化。</summary>
public sealed class ProjectSettingsTests : IDisposable
{
    private readonly string _dir;
    private readonly string _path;

    public ProjectSettingsTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "gitui-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
        _path = Path.Combine(_dir, "settings.json");
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
    }

    [Fact]
    public void Normalize_TrimsDedupesAndDropsEmptyPaths()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s =>
        {
            s.Projects = new List<ProjectEntry>
            {
                new() { Path = @"  C:\repo\alpha  " },
                new() { Path = "" },
                new() { Path = @"c:\REPO\ALPHA" },   // 大小写不同视为同一项目
                new() { Path = @"C:\repo\beta" },
                new() { Path = "   " },
            };
        });

        Assert.Equal(2, store.Current.Projects.Count);
        Assert.Equal(@"C:\repo\alpha", store.Current.Projects[0].Path);
        Assert.Equal(@"C:\repo\beta", store.Current.Projects[1].Path);
    }

    [Fact]
    public void Normalize_FillsMissingNameFromFolderName()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s => s.Projects = new List<ProjectEntry>
        {
            new() { Path = @"C:\dev\my-project" },
            new() { Path = @"C:\dev\other", Name = "自定义名" },
        });

        Assert.Equal("my-project", store.Current.Projects[0].Name);
        Assert.Equal("自定义名", store.Current.Projects[1].Name);
    }

    [Fact]
    public void Normalize_FillsAddedAtWhenDefault()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s => s.Projects = new List<ProjectEntry> { new() { Path = @"C:\repo\alpha" } });

        Assert.NotEqual(default, store.Current.Projects[0].AddedAt);
    }

    [Fact]
    public void Normalize_CapsAtMaxProjects()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s =>
        {
            var projects = new List<ProjectEntry>();
            for (int i = 1; i <= JsonSettingsStore.MaxProjects + 10; i++)
            {
                projects.Add(new ProjectEntry { Path = $@"C:\repo\p{i:D3}" });
            }
            s.Projects = projects;
        });

        Assert.Equal(JsonSettingsStore.MaxProjects, store.Current.Projects.Count);
        // 最新添加在前语义由 UI 维护；此处仅验证截断保留前段
        Assert.Equal(@"C:\repo\p001", store.Current.Projects[0].Path);
    }

    [Fact]
    public void Normalize_ClearsCurrentProjectPathWhenNotInList()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s =>
        {
            s.Projects = new List<ProjectEntry> { new() { Path = @"C:\repo\alpha" } };
            s.CurrentProjectPath = @"C:\repo\gone";
        });
        Assert.Null(store.Current.CurrentProjectPath);

        store.Update(s => s.CurrentProjectPath = @"c:\repo\ALPHA");
        Assert.Equal(@"C:\repo\alpha", store.Current.CurrentProjectPath);
    }

    [Fact]
    public void Save_ThenLoad_RoundTripsProjects()
    {
        var opened = new DateTimeOffset(2026, 10, 4, 8, 0, 0, TimeSpan.Zero);
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s =>
        {
            s.Projects = new List<ProjectEntry>
            {
                new() { Path = @"C:\repo\alpha", Name = "Alpha", AddedAt = opened, LastOpenedAt = opened },
                new() { Path = @"C:\repo\beta", Name = "Beta", AddedAt = opened },
            };
            s.CurrentProjectPath = @"C:\repo\alpha";
        });
        Assert.True(store.Save());

        var store2 = new JsonSettingsStore(_path);
        Assert.True(store2.Load());

        Assert.Equal(2, store2.Current.Projects.Count);
        Assert.Equal("Alpha", store2.Current.Projects[0].Name);
        Assert.Equal(opened, store2.Current.Projects[0].LastOpenedAt);
        Assert.Null(store2.Current.Projects[1].LastOpenedAt);
        Assert.Equal(@"C:\repo\alpha", store2.Current.CurrentProjectPath);
    }

    // ---- 命令面板最近命令（v2）：去重置顶由 UI 维护，Normalize 负责去空/去重/超 8 删尾 ----

    [Fact]
    public void Normalize_RecentCommands_DedupesDropsEmptyAndCapsAtEight()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s =>
        {
            s.RecentCommands = new List<string>
            {
                "新建窗口",
                "   ",
                "刷新当前页",
                "新建窗口",   // 重复：保留首次出现位置
                null!,
            };
            for (int i = 1; i <= 7; i++) s.RecentCommands.Add($"命令{i:D2}");
        });

        var result = store.Current.RecentCommands;
        Assert.Equal(8, result.Count);
        Assert.Equal("新建窗口", result[0]);
        Assert.Equal("刷新当前页", result[1]);
        Assert.DoesNotContain("命令07", result); // 去 2 空项后 9 条，超 8 删尾
        Assert.Equal(result.Count, result.Distinct().Count());
    }

    [Fact]
    public void Save_ThenLoad_RoundTripsRecentCommands()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();
        store.Update(s => s.RecentCommands = new List<string> { "提交", "Push", "转到分支" });
        Assert.True(store.Save());

        var store2 = new JsonSettingsStore(_path);
        Assert.True(store2.Load());
        Assert.Equal(new[] { "提交", "Push", "转到分支" }, store2.Current.RecentCommands);
    }
}
