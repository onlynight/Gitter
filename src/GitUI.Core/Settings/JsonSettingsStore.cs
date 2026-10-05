using System.Text.Json;
using System.Text.Json.Serialization;
using GitUI.Core.Models;

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

    /// <summary>整体替换当前设置并触发 Changed 事件，但不自动持久化（S7 设置导入）。</summary>
    public void Replace(AppSettings settings)
    {
        if (settings is null) throw new ArgumentNullException(nameof(settings));
        lock (_lock)
        {
            _current = Normalize(settings);
        }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>序列化为 JSON（与存储文件同格式，S7 设置导出用）。</summary>
    public static string ToJson(AppSettings settings)
        => JsonSerializer.Serialize(settings ?? AppSettings.Default, JsonOptions);

    /// <summary>从 JSON 反序列化；解析失败返回默认设置（S7 设置导入用，不抛出）。</summary>
    public static AppSettings FromJson(string json) => ParseOrDefault(json);

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

        s.Normalize(); // 终端 shell + 实时监视/fetch 间隔 + AI provider/隐私档（ai-native-redesign.md §八）
        s.Language = LanguageService.Normalize(s.Language);

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

        // 命令面板最近命令：存稳定 id（docs/i18n.md §五-1，标题文案已多语言化），
        // 去空、按 id 去重、超 8 删尾；历史版本的标题文本条目不匹配白名单，加载时清洗掉
        if (s.RecentCommands is null)
        {
            s.RecentCommands = new List<string>();
        }
        var knownCommands = new HashSet<string>(CommandIds.All, StringComparer.Ordinal);
        var seenCmds = new HashSet<string>(StringComparer.Ordinal);
        var recentCmds = new List<string>(8);
        foreach (var cmd in s.RecentCommands)
        {
            if (string.IsNullOrWhiteSpace(cmd)) continue;
            if (!knownCommands.Contains(cmd)) continue;
            if (seenCmds.Add(cmd) && recentCmds.Count < 8)
            {
                recentCmds.Add(cmd);
            }
        }
        s.RecentCommands = recentCmds;

        NormalizeProjects(s);

        // 分割条比例：非有限值置空（未调整），越界夹回 [0.1, 0.9]
        s.LogSplitterFraction = NormalizeFraction(s.LogSplitterFraction);
        s.ChangesSplitterFraction = NormalizeFraction(s.ChangesSplitterFraction);

        return s;
    }

    private static double? NormalizeFraction(double? f)
        => f is { } v && double.IsFinite(v) ? Math.Clamp(v, 0.1, 0.9) : null;

    /// <summary>项目列表上限（用户显式管理，软上限防配置文件失控）。</summary>
    internal const int MaxProjects = 50;

    /// <summary>
    /// 项目列表归一化：丢弃空路径、trim、按路径去重（Windows 大小写不敏感）、
    /// 空显示名补文件夹名；CurrentProjectPath 必须仍存在于列表中，否则清空。
    /// </summary>
    private static void NormalizeProjects(AppSettings s)
    {
        if (s.Projects is null)
        {
            s.Projects = new List<ProjectEntry>();
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var projects = new List<ProjectEntry>(s.Projects.Count);
        foreach (var p in s.Projects)
        {
            if (p is null) continue;
            var path = p.Path?.Trim() ?? string.Empty;
            if (path.Length == 0 || !seen.Add(path)) continue;

            p.Path = path;
            if (string.IsNullOrWhiteSpace(p.Name))
            {
                p.Name = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            }
            if (p.AddedAt == default)
            {
                p.AddedAt = DateTimeOffset.Now;
            }
            projects.Add(p);
            if (projects.Count >= MaxProjects) break;
        }
        s.Projects = projects;

        // CurrentProjectPath 对齐到列表项的规范大小写；不在列表中则清空
        var current = s.CurrentProjectPath?.Trim();
        s.CurrentProjectPath = current is null
            ? null
            : projects.FirstOrDefault(p => string.Equals(p.Path, current, StringComparison.OrdinalIgnoreCase))?.Path;
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
