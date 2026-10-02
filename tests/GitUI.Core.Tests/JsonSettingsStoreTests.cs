using System.Text;
using GitUI.Core.Settings;
using Xunit;

namespace GitUI.Core.Tests;

public sealed class JsonSettingsStoreTests : IDisposable
{
    private readonly string _dir;
    private readonly string _path;

    public JsonSettingsStoreTests()
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
    public void Load_WhenFileMissing_ReturnsDefaults()
    {
        var store = new JsonSettingsStore(_path);
        Assert.True(store.Load());

        Assert.Equal(ThemePreference.System, store.Current.Theme);
        Assert.Equal(DiffViewMode.SideBySide, store.Current.DiffMode);
        Assert.Empty(store.Current.RecentRepos);
        Assert.Null(store.Current.ExternalEditor);
    }

    [Fact]
    public void Save_ThenLoad_RoundTripsAllFields()
    {
        var store = new JsonSettingsStore(_path);
        store.Update(s =>
        {
            s.Theme = ThemePreference.Dark;
            s.DiffMode = DiffViewMode.Inline;
            s.ExternalEditor = @"C:\Program Files\VS Code\Code.exe";
            s.RecentRepos = new List<string> { @"C:\repo\alpha", @"C:\repo\beta" };
        });
        Assert.True(store.Save());

        var store2 = new JsonSettingsStore(_path);
        Assert.True(store2.Load());

        Assert.Equal(ThemePreference.Dark, store2.Current.Theme);
        Assert.Equal(DiffViewMode.Inline, store2.Current.DiffMode);
        Assert.Equal(@"C:\Program Files\VS Code\Code.exe", store2.Current.ExternalEditor);
        Assert.Equal(new List<string> { @"C:\repo\alpha", @"C:\repo\beta" }, store2.Current.RecentRepos);
    }

    [Fact]
    public void Load_WhenFileCorrupted_ReturnsDefaultsAndReportsFailure()
    {
        File.WriteAllText(_path, "{{{not json at all}}}", Encoding.UTF8);

        var store = new JsonSettingsStore(_path);
        // 文件存在但 JSON 解析失败：Load 返回 false，Current 为默认值
        Assert.False(store.Load());
        Assert.Equal(ThemePreference.System, store.Current.Theme);
    }

    [Fact]
    public void Load_WhenFileEmpty_UsesDefaults()
    {
        File.WriteAllText(_path, "  ", Encoding.UTF8);

        var store = new JsonSettingsStore(_path);
        Assert.True(store.Load());
        Assert.Equal(ThemePreference.System, store.Current.Theme);
    }

    [Fact]
    public void Load_WhenEnumOutOfRange_NormalizesToDefault()
    {
        // 主题枚举合法范围是 0-2；写入 99 应被归一化回 System
        File.WriteAllText(_path, "{\"theme\":99,\"diffMode\":99}", Encoding.UTF8);

        var store = new JsonSettingsStore(_path);
        Assert.True(store.Load());
        Assert.Equal(ThemePreference.System, store.Current.Theme);
        Assert.Equal(DiffViewMode.SideBySide, store.Current.DiffMode);
    }

    [Fact]
    public void AddRecentRepo_DeduplicatesAndKeepsOrder()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();

        store.AddRecentRepo(@"C:\repo\alpha");
        store.AddRecentRepo(@"C:\repo\beta");
        store.AddRecentRepo(@"C:\repo\gamma");

        Assert.Equal(3, store.Current.RecentRepos.Count);
        Assert.Equal(@"C:\repo\gamma", store.Current.RecentRepos[0]);
        Assert.Equal(@"C:\repo\beta", store.Current.RecentRepos[1]);
        Assert.Equal(@"C:\repo\alpha", store.Current.RecentRepos[2]);

        // 重复添加应移到顶部，不重复
        store.AddRecentRepo(@"C:\repo\alpha");
        Assert.Equal(3, store.Current.RecentRepos.Count);
        Assert.Equal(@"C:\repo\alpha", store.Current.RecentRepos[0]);
    }

    [Fact]
    public void AddRecentRepo_CapsAtFive()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();

        for (int i = 1; i <= 8; i++)
        {
            store.AddRecentRepo($@"C:\repo\{i:D2}");
        }

        Assert.Equal(5, store.Current.RecentRepos.Count);
        Assert.Equal(@"C:\repo\08", store.Current.RecentRepos[0]);
    }

    [Fact]
    public void AddRecentRepo_IgnoresNullOrWhitespace()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();

        store.AddRecentRepo("");
        store.AddRecentRepo("   ");
        store.AddRecentRepo(null!);

        Assert.Empty(store.Current.RecentRepos);
    }

    [Fact]
    public void Update_RaisesChangedEvent()
    {
        var store = new JsonSettingsStore(_path);
        store.Load();

        bool raised = false;
        store.Changed += (_, _) => raised = true;

        store.Update(s => s.Theme = ThemePreference.Light);
        Assert.True(raised);
        Assert.Equal(ThemePreference.Light, store.Current.Theme);
    }

    [Fact]
    public void Save_WhenDirectoryMissing_CreatesIt()
    {
        var nested = Path.Combine(_dir, "a", "b", "settings.json");
        var store = new JsonSettingsStore(nested);
        store.Load();

        Assert.True(store.Save());
        Assert.True(File.Exists(nested));
    }
}
