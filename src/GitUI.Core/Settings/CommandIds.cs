namespace GitUI.Core.Settings;

/// <summary>
/// 命令面板命令的稳定 id（docs/command-palette-v2.md + docs/i18n.md §五-1）。
/// 标题文案已多语言化，"最近命令"必须以 id 存储（settings.json RecentCommands），
/// 显示时查表翻译；id 集合同时供 JsonSettingsStore.Normalize 清洗历史遗留的标题文本。
/// </summary>
public static class CommandIds
{
    public const string GotoProjects = "nav.projects";
    public const string GotoLog = "nav.log";
    public const string GotoChanges = "nav.changes";
    public const string GotoBranches = "nav.branches";
    public const string GotoTerminal = "nav.terminal";
    public const string GotoSettings = "nav.settings";
    public const string RefreshPage = "repo.refresh";
    public const string NewWindow = "repo.newWindow";
    public const string SwitchProject = "repo.switchProject";
    public const string Commit = "commit.commit";
    public const string CommitPush = "commit.commitPush";
    public const string StageAll = "commit.stageAll";
    public const string UnstageAll = "commit.unstageAll";
    public const string CheckoutBranch = "branch.checkout";
    public const string CreateBranch = "branch.create";
    public const string RenameBranch = "branch.rename";
    public const string DeleteBranch = "branch.delete";
    public const string MergeBranch = "branch.merge";
    public const string RebaseBranch = "branch.rebase";
    public const string FastForward = "branch.fastForward";
    public const string Pull = "sync.pull";
    public const string PullRebase = "sync.pullRebase";
    public const string Push = "sync.push";
    public const string DiffSideBySide = "view.diffSideBySide";
    public const string DiffInline = "view.diffInline";
    public const string ThemeSystem = "view.themeSystem";
    public const string ThemeLight = "view.themeLight";
    public const string ThemeDark = "view.themeDark";
    public const string ExportSettings = "settings.export";
    public const string ImportSettings = "settings.import";

    /// <summary>全部合法 id（Normalize 清洗 RecentCommands 的白名单）。</summary>
    public static readonly IReadOnlyList<string> All = new[]
    {
        GotoProjects, GotoLog, GotoChanges, GotoBranches, GotoTerminal, GotoSettings,
        RefreshPage, NewWindow, SwitchProject,
        Commit, CommitPush, StageAll, UnstageAll,
        CheckoutBranch, CreateBranch, RenameBranch, DeleteBranch, MergeBranch, RebaseBranch, FastForward,
        Pull, PullRebase, Push,
        DiffSideBySide, DiffInline, ThemeSystem, ThemeLight, ThemeDark,
        ExportSettings, ImportSettings,
    };
}
