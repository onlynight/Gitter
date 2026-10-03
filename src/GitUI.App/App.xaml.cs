using System.IO;
using GitUI.Core.Settings;
using Microsoft.UI.Xaml;

namespace GitUI.App;

public partial class App : Application
{
    public App()
    {
        this.InitializeComponent();
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

        OpenNewWindow();
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
