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

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // 加载设置；失败时使用默认值，不阻断启动
        Settings.Load();

        var mainWindow = new MainWindow(Settings);
        mainWindow.Activate();

        // 窗口关闭前保存设置
        mainWindow.AppWindow.Closing += (_, _) => Settings.Save();
    }
}
