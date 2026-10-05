using GitUI.Core.Models;

namespace GitUI.Core.Settings;

/// <summary>
/// 应用级设置。所有字段带默认值，用于 JSON 序列化/反序列化。
/// </summary>
public sealed class AppSettings
{
    public ThemePreference Theme { get; set; } = ThemePreference.System;

    /// <summary>界面语言：system / en / zh-Hans（docs/i18n.md），默认英文；未知值 Normalize 回退 system。</summary>
    public string Language { get; set; } = LanguagePreference.English;

    /// <summary>主题包 id（theme-framework.md）；null/空 = 按基座使用内置深/浅主题包。</summary>
    public string? ThemePackageId { get; set; }

    /// <summary>被禁用的扩展包种类清单，条目 = "包id:种类"（extension-package-framework.md §四 启停）。</summary>
    public List<string> DisabledPackageKinds { get; set; } = new();

    /// <summary>最近打开的仓库路径，最多 5 个，最新在前。已由 Projects 取代写入，仅作旧配置迁移来源。</summary>
    public List<string> RecentRepos { get; set; } = new();

    /// <summary>用户显式管理的项目列表（最新添加在前），项目页数据源。</summary>
    public List<ProjectEntry> Projects { get; set; } = new();

    /// <summary>当前项目路径（须存在于 Projects 中，Normalize 强制）；null 表示未选择项目。启动时自动恢复。</summary>
    public string? CurrentProjectPath { get; set; }

    /// <summary>外部编辑器可执行文件路径，null 表示使用系统默认。</summary>
    public string? ExternalEditor { get; set; }

    /// <summary>Diff 视图默认模式：SideBySide 或 Inline。</summary>
    public DiffViewMode DiffMode { get; set; } = DiffViewMode.SideBySide;

    /// <summary>侧边栏是否收起（仅显示图标）。</summary>
    public bool SidebarCollapsed { get; set; } = false;

    /// <summary>bash.exe 手动指定路径；null/空表示自动定位（三级回退）。</summary>
    public string? BashPath { get; set; }

    /// <summary>终端字体族，默认 Cascadia Mono（缺失时回退 Consolas）。</summary>
    public string TerminalFontFamily { get; set; } = "Cascadia Mono";

    /// <summary>终端字号（逻辑像素），Normalize 约束在 [8, 32]。</summary>
    public double TerminalFontSize { get; set; } = 13;

    /// <summary>终端是否跟随当前仓库切换工作目录（Ctrl+Shift+J 切换）。</summary>
    public bool TerminalFollowRepo { get; set; } = true;

    /// <summary>终端 shell：powershell（默认，系统内置）/ cmd（系统内置）/ bash（需 Git for Windows）。</summary>
    public string TerminalShell { get; set; } = TerminalShellKind.PowerShell;

    /// <summary>命令面板最近执行的命令（命令标题作 key），最多 8 条，最新在前。空查询时置顶显示。</summary>
    public List<string> RecentCommands { get; set; } = new();

    /// <summary>Log 页两栏分割条位置（左栏占宿主宽度比例，Normalize 夹在 0.1..0.9）；null = 未调整过，保持 star 初始布局。</summary>
    public double? LogSplitterFraction { get; set; }

    /// <summary>变更页两栏分割条位置（左栏占宿主宽度比例）；null = 未调整过。</summary>
    public double? ChangesSplitterFraction { get; set; }

    // ---- 实时基座（ai-native-redesign.md §7.1）----

    /// <summary>是否监视工作区文件变化（FileSystemWatcher + 焦点轮询，驱动自动刷新）。</summary>
    public bool WatchWorktree { get; set; } = true;

    /// <summary>是否后台定时 fetch（有 remote 才生效）。</summary>
    public bool AutoFetch { get; set; } = true;

    /// <summary>后台 fetch 间隔（分钟），Normalize 夹在 [1, 120]。</summary>
    public int AutoFetchIntervalMinutes { get; set; } = 5;

    /// <summary>GUI 内置 MCP 命名管道服务（agent 桥；写操作逐次人工确认，ai-native-redesign.md §7.2）。</summary>
    public bool McpPipeEnabled { get; set; } = true;

    // ---- AI 接入（ai-native-redesign.md §八）----

    /// <summary>AI provider 配置；Kind = Off 时全部 AI 功能禁用。</summary>
    public AiSettings Ai { get; set; } = new();

    /// <summary>提交前安全网模式：Off 关闭 / Warn 警告（提交继续） / Block 拦截（发现阻止级问题时不提交）。</summary>
    public CommitSafetyMode SafetyNetMode { get; set; } = CommitSafetyMode.Warn;

    /// <summary>归一化设置（反序列化后调用；越界/未知值回退默认）。</summary>
    public void Normalize()
    {
        NormalizeTerminalShell();
        if (AutoFetchIntervalMinutes is < 1 or > 120) AutoFetchIntervalMinutes = 5;
        if (SafetyNetMode is not (CommitSafetyMode.Off or CommitSafetyMode.Warn or CommitSafetyMode.Block))
            SafetyNetMode = CommitSafetyMode.Warn;
        Ai.Normalize();
    }

    /// <summary>归一化终端 shell 值（未知值回退 PowerShell）。</summary>
    public void NormalizeTerminalShell()
    {
        var v = (TerminalShell ?? string.Empty).Trim().ToLowerInvariant();
        TerminalShell = v switch
        {
            TerminalShellKind.Cmd => TerminalShellKind.Cmd,
            TerminalShellKind.Bash => TerminalShellKind.Bash,
            _ => TerminalShellKind.PowerShell,
        };
    }

    public static AppSettings Default => new();
}

public enum DiffViewMode
{
    SideBySide = 0,
    Inline = 1,
}

public enum CommitSafetyMode
{
    Off = 0,
    Warn = 1,
    Block = 2,
}

/// <summary>AI 隐私分级（ai-native-redesign.md §8.2）：发送给云端 provider 的内容范围。</summary>
public enum AiPrivacyLevel
{
    /// <summary>不发送任何内容（AI 功能整体禁用，等价 ProviderKind = Off）。</summary>
    Disabled = 0,
    /// <summary>仅元数据：文件路径 + 增删行数，不含代码内容。</summary>
    MetadataOnly = 1,
    /// <summary>完整 diff（发送前过 secrets 规则，命中即阻断）。</summary>
    FullDiff = 2,
}

/// <summary>AI provider 设置（本地优先：Gitter 不托管 key）。</summary>
public sealed class AiSettings
{
    /// <summary>provider 类型：off / openai（OpenAI 兼容端点，含 Ollama）/ anthropic / cli（命令行桥）。未知值 Normalize 回退 off。</summary>
    public string ProviderKind { get; set; } = AiProviderKind.Off;

    /// <summary>OpenAI 兼容端点基础地址（如 https://api.xxx.com/v1 或 Ollama http://127.0.0.1:11434/v1）。</summary>
    public string? Endpoint { get; set; }

    /// <summary>模型名（如 deepseek-chat、qwen2.5-coder:7b）。</summary>
    public string? Model { get; set; }

    /// <summary>API key（DPAPI 保护后的 Base64；null = 未设置。CliBridge/Ollama 通常不需要）。</summary>
    public string? ApiKeyProtected { get; set; }

    /// <summary>命令行桥：可执行文件路径（prompt 经 stdin 传入，stdout 取结果）。</summary>
    public string? CliCommand { get; set; }

    /// <summary>隐私分级（云端 provider 生效；本地端点不受限）。</summary>
    public AiPrivacyLevel Privacy { get; set; } = AiPrivacyLevel.MetadataOnly;

    /// <summary>AI 生成的提交信息是否自动追加 Assisted-by trailer（ai-native-redesign.md §5.2）。</summary>
    public bool AppendTrailer { get; set; } = true;

    public bool IsEnabled => NormalizeProvider(ProviderKind) != AiProviderKind.Off;

    public void Normalize()
    {
        ProviderKind = NormalizeProvider(ProviderKind);
        if (Privacy is not (AiPrivacyLevel.Disabled or AiPrivacyLevel.MetadataOnly or AiPrivacyLevel.FullDiff))
            Privacy = AiPrivacyLevel.MetadataOnly;
    }

    public static string NormalizeProvider(string? kind) => (kind ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        AiProviderKind.OpenAi => AiProviderKind.OpenAi,
        AiProviderKind.Anthropic => AiProviderKind.Anthropic,
        AiProviderKind.Cli => AiProviderKind.Cli,
        _ => AiProviderKind.Off,
    };
}

public static class AiProviderKind
{
    public const string Off = "off";
    public const string OpenAi = "openai";
    public const string Anthropic = "anthropic";
    public const string Cli = "cli";
}
