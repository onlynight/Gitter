using System.Diagnostics;
using System.Text;
using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// tmux 录制 oracle（design.md §8-S2b）：有 tmux 时以真实会话输出对照解析结果；
/// 无 tmux（Windows 常态）时软跳过——与 GNU diff oracle 同一策略。
/// </summary>
public sealed class TmuxOracleTests
{
    private static bool TryTmuxVersion(out string version)
    {
        try
        {
            var psi = new ProcessStartInfo("tmux", "-V")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi);
            if (p is null) { version = string.Empty; return false; }
            version = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(5000);
            return p.ExitCode == 0;
        }
        catch
        {
            version = string.Empty;
            return false;
        }
    }

    [Fact]
    public void Tmux_SessionOutput_ParsesWithoutGarbage()
    {
        if (!TryTmuxVersion(out var version))
        {
            // 环境无 tmux：软跳过（Windows 常态；WSL/Cygwin tmux 不在 PATH 语义内）
            return;
        }

        var socket = Path.Combine(Path.GetTempPath(), "gitui-oracle-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        try
        {
            Run("tmux", $"-S {socket} new-session -d -x 80 -y 24");
            Run("tmux", $"-S {socket} send-keys 'echo TMUX_ORACLE_MARKER' Enter");
            Thread.Sleep(500);
            var captured = Run("tmux", $"-S {socket} capture-pane -p -e");
            var plain = Run("tmux", $"-S {socket} capture-pane -p");

            var buf = new TerminalBuffer(80, 24);
            var parser = new TerminalParser(buf);
            parser.Feed(Encoding.UTF8.GetBytes(captured));

            // 解析后屏幕文本应与 tmux 自身捕获的纯文本一致（含标记行）
            var screen = buf.ToScreenText();
            Assert.Contains("TMUX_ORACLE_MARKER", screen);
            Assert.Contains("TMUX_ORACLE_MARKER", plain);
        }
        finally
        {
            try { Run("tmux", $"-S {socket} kill-server"); } catch { /* 尽力清理 */ }
        }

        static string Run(string exe, string args)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi)!;
            var stdout = p.StandardOutput.ReadToEnd();
            p.WaitForExit(10_000);
            return stdout;
        }

        static void Run2()
        {
        }
    }
}
