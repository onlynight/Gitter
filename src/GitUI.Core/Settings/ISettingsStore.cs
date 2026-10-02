namespace GitUI.Core.Settings;

/// <summary>
/// 应用设置存储接口。实现方必须保证：
/// - 加载失败（文件不存在、损坏、JSON 解析错误）时返回默认设置，不抛出
/// - 保存失败不抛出，返回 false
/// - 线程安全
/// </summary>
public interface ISettingsStore
{
    AppSettings Current { get; }

    /// <summary>从磁盘加载。文件不存在或损坏时返回 true 并使用默认设置。</summary>
    bool Load();

    /// <summary>持久化当前设置。返回是否成功。</summary>
    bool Save();

    /// <summary>设置变更时触发，用于 UI 联动（如主题切换）。</summary>
    event EventHandler? Changed;
}
