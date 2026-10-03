namespace GitUI.Core.Settings;

/// <summary>终端 shell 种类（design.md §4.7，S0e P1：bash 仅为可选，默认 PowerShell 消除外部依赖）。</summary>
public static class TerminalShellKind
{
    public const string PowerShell = "powershell";
    public const string Cmd = "cmd";
    public const string Bash = "bash";
}
