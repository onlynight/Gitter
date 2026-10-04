using System.IO;
using System.Text;
using GitUI.Core.Settings;
using Microsoft.UI.Xaml;

namespace GitUI.App;

public partial class App : Application
{
    public App()
    {
        this.InitializeComponent();

        // S0e：全局异常日志（Git Bash 页崩溃排查，design.md §11.18）。
        // XAML UI 线程未处理异常：记录后标记 Handled，避免 fail-fast 闪退。
        this.UnhandledException += (sender, e) =>
        {
            LogCrash("XAML UnhandledException", e.Message, e.Exception);
            e.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            LogCrash("AppDomain UnhandledException", e.ExceptionObject?.ToString() ?? "null", e.ExceptionObject as Exception);
        System.Threading.Tasks.TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            LogCrash("UnobservedTaskException", e.Exception?.Message ?? "null", e.Exception);
            e.SetObserved();
        };
    }

    private static void LogCrash(string source, string message, Exception? ex)
    {
        try
        {
            var dir = Path.GetDirectoryName(DefaultSettingsPath)!;
            Directory.CreateDirectory(dir);
            var sb = new StringBuilder();
            sb.AppendLine($"==== {DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{source}] ====");
            sb.AppendLine(message);
            if (ex is not null)
            {
                sb.AppendLine(ex.ToString());
                var inner = ex.InnerException;
                while (inner is not null)
                {
                    sb.AppendLine("INNER: " + inner);
                    inner = inner.InnerException;
                }
            }
            File.AppendAllText(Path.Combine(dir, "crash.log"), sb.ToString());
        }
        catch
        {
            // 日志失败不再抛出
        }
    }

    /// <summary>全局设置存储实例。测试与诊断可直接读。</summary>
    public static ISettingsStore Settings { get; private set; } = new JsonSettingsStore(DefaultSettingsPath);

    public static string DefaultSettingsPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "GitUI",
            "settings.json");

    private static readonly List<Window> _windows = new();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // 加载设置；失败时使用默认值，不阻断启动
        Settings.Load();
        MigrateRecentReposToProjects();

        OpenNewWindow();
    }

    /// <summary>
    /// 一次性迁移：旧版本只有 RecentRepos（最近仓库，上限 5），项目页上线后把它
    /// 导入为初始项目列表。仅在项目列表为空且存在旧数据时执行一次，不删除旧字段。
    /// </summary>
    private static void MigrateRecentReposToProjects()
    {
        var s = Settings.Current;
        if (s.Projects.Count > 0 || s.RecentRepos.Count == 0) return;

        Settings.Update(s2 =>
        {
            foreach (var repo in s2.RecentRepos)
            {
                s2.Projects.Add(new GitUI.Core.Models.ProjectEntry
                {
                    Path = repo,
                    AddedAt = DateTimeOffset.Now,
                });
            }
            // 最新仓库顺带成为当前项目，保持与旧版"自动可用"体验一致
            if (s2.RecentRepos.Count > 0)
            {
                s2.CurrentProjectPath = s2.RecentRepos[0];
            }
        });
        Settings.Save();
    }

    /// <summary>打开新主窗口（S7 多窗口：每仓库一窗口，design.md §6.7）。</summary>
    public static void OpenNewWindow()
    {
        var window = new MainWindow(Settings);
        _windows.Add(window);
        window.AppWindow.Closing += (_, _) =>
        {
            _windows.Remove(window);
            if (_windows.Count == 0)
            {
                Settings.Save(); // 最后一个窗口关闭时持久化
            }
        };
        window.Activate();
    }
}
