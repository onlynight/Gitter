using System.Text.Json;
using System.Text.Json.Serialization;

namespace GitUI.Core.Settings;

/// <summary>
/// 基于 JSON 文件的设置存储。
/// 关键约束：任何 IO/解析错误都不能抛给调用方，必须静默降级为默认设置。
/// </summary>
public sealed class JsonSettingsStore : ISettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly string _filePath;
    private readonly object _lock = new();
    private AppSettings _current;

    public JsonSettingsStore(string filePath)
    {
        _filePath = filePath ?? throw new ArgumentNullException(nameof(filePath));
        _current = AppSettings.Default;
    }

    /// <summary>当前设置。每次调用返回内部实例，调用方可修改后调用 Save()。</summary>
    public AppSettings Current
    {
        get { lock (_lock) return _current; }
    }

    public event EventHandler? Changed;

    public bool Load()
    {
        try
        {
            if (!File.Exists(_filePath))
            {
                _current = AppSettings.Default;
                return true;
            }

            var json = File.ReadAllText(_filePath);
            if (string.IsNullOrWhiteSpace(json))
            {
                _current = AppSettings.Default;
                return true;
            }

            var loaded = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
            if (loaded is null)
            {
                _current = AppSettings.Default;
                return false;
            }

            _current = Normalize(loaded);
            return true;
        }
        catch
        {
            // JSON 损坏、权限不足、磁盘故障——一律降级
            _current = AppSettings.Default;
            return false;
        }
    }

    public bool Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(_filePath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            var json = JsonSerializer.Serialize(_current, JsonOptions);
            File.WriteAllText(_filePath, json);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>设置某个值并触发 Changed 事件，但不自动持久化。</summary>
    public void Update(Action<AppSettings> mutate)
    {
        lock (_lock)
        {
            mutate(_current);
            _current = Normalize(_current);
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>修正非法值（超出范围的枚举、超长列表）到合法范围。</summary>
    internal static AppSettings Normalize(AppSettings s)
    {
        if (s.Theme < ThemePreference.System || s.Theme > ThemePreference.Dark)
        {
            s.Theme = ThemePreference.System;
        }

        if (s.DiffMode > DiffViewMode.Inline)
        {
            s.DiffMode = DiffViewMode.SideBySide;
        }

        // 终端字号：NaN/Infinity 或越界一律归一到合法范围
        s.TerminalFontSize = ClampDouble(s.TerminalFontSize, 8, 32, 13);

        if (string.IsNullOrWhiteSpace(s.TerminalFontFamily))
        {
            s.TerminalFontFamily = "Cascadia Mono";
        }

        if (string.IsNullOrWhiteSpace(s.BashPath))
        {
            s.BashPath = null;
        }

        // RecentRepos 去重并限制数量
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<string>(5);
        foreach (var repo in s.RecentRepos)
        {
            if (string.IsNullOrWhiteSpace(repo)) continue;
            if (seen.Add(repo) && list.Count < 5)
            {
                list.Add(repo);
            }
        }
        s.RecentRepos = list;

        return s;
    }

    /// <summary>把 double 归一化：非有限值取默认，越界则夹到 [min, max]。</summary>
    private static double ClampDouble(double value, double min, double max, double fallback)
    {
        if (!double.IsFinite(value))
        {
            return fallback;
        }

        return Math.Clamp(value, min, max);
    }

    /// <summary>把仓库路径加入最近列表，保持最新在前且去重。</summary>
    public void AddRecentRepo(string repoPath)
    {
        if (string.IsNullOrWhiteSpace(repoPath)) return;

        Update(s =>
        {
            var list = new List<string>(5) { repoPath };
            foreach (var existing in s.RecentRepos)
            {
                if (list.Count >= 5) break;
                if (!string.Equals(existing, repoPath, StringComparison.OrdinalIgnoreCase))
                {
                    list.Add(existing);
                }
            }
            s.RecentRepos = list;
        });
    }

    /// <summary>测试用：构造一个从指定 JSON 反序列化的实例。</summary>
    internal static AppSettings ParseOrDefault(string json)
    {
        try
        {
            var loaded = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
            return loaded is null ? AppSettings.Default : Normalize(loaded);
        }
        catch
        {
            return AppSettings.Default;
        }
    }
}
