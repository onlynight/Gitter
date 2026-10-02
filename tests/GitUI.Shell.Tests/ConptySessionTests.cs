using System.Diagnostics;
using System.Text;
using GitUI.Shell;
using Xunit;
using Xunit.Abstractions;

namespace GitUI.Shell.Tests;

/// <summary>
/// S0d：ConPTY 集成测试，覆盖 design.md §S0d 验证点——
/// echo / pwd / ls / git status / less / exit / kill -9 / resize / stdin 写入。
/// 依赖真实 bash.exe（Git for Windows）；bash 或 ConPTY 环境不可用时输出诊断并跳过，
/// 不在本机长时间挂起。句柄计数断言依赖 ConptyNative 的 LiveHandleCount
/// （internal，经 InternalsVisibleTo 暴露）。
/// </summary>
public sealed class ConptySessionTests
{
    private readonly ITestOutputHelper _output;

    public ConptySessionTests(ITestOutputHelper output)
    {
        _output = output;
    }

    /// <summary>
    /// ConPTY 环境预检（每程序集一次）：启动 <c>bash -c echo</c> 并在 8 秒内等待回显。
    /// 部分机器上 conhost 伪终端客户端初始化会整体失败（子进程秒退 0xC0000142、
    /// 无任何输出，官方参考实现同样失败）——此时跳过全部集成测试而不是挂满超时。
    /// 预检跑在专用后台线程上并受 15 秒看门狗保护：坏环境下连
    /// ClosePseudoConsole 都可能挂起，看门狗超时后直接放弃该线程。
    /// </summary>
    private static readonly Lazy<(bool Ok, string? Reason)> ConptyEnvironment = new(() =>
    {
        (bool Ok, string? Reason) result = default;
        var worker = new Thread(() => result = ProbeConpty())
        {
            IsBackground = true,
            Name = "ConptyPreflight",
        };
        worker.Start();

        if (!worker.Join(TimeSpan.FromSeconds(15)))
        {
            return (false,
                "ConPTY 环境预检 15 秒无响应（CreatePseudoConsole/ClosePseudoConsole 挂起；" +
                "本机 conhost 伪终端异常，请在正常桌面会话重试）");
        }

        return result;
    });

    private static (bool Ok, string? Reason) ProbeConpty()
    {
        if (!BashLocator.TryLocate(null, out var bash, out var err))
        {
            return (false, "bash.exe 未找到：" + err);
        }

        var text = new StringBuilder();
        using var session = new ConptySession($@"""{bash}"" -c ""echo conpty-preflight-ok""");
        session.OutputReady += data =>
        {
            lock (text) _ = text.Append(Encoding.UTF8.GetString(data.Span));
        };
        session.Start();

        var deadline = TimeSpan.FromSeconds(8);
        var sw = Stopwatch.StartNew();
        while (sw.Elapsed < deadline)
        {
            lock (text)
            {
                if (text.ToString().Contains("conpty-preflight-ok", StringComparison.Ordinal))
                {
                    return (true, null);
                }
            }

            Thread.Sleep(50);
        }

        lock (text)
        {
            return (false,
                "ConPTY 环境不可用：bash -c echo 在 8 秒内无任何输出（本机 conhost 伪终端" +
                "客户端初始化异常，官方参考实现同样失败；请在正常桌面会话重试）");
        }
    }

    /// <summary>返回 bash 路径，或在环境不可用时输出原因并让用例直接返回（软跳过）。</summary>
    private string? RequireConpty()
    {
        var (ok, reason) = ConptyEnvironment.Value;
        if (ok)
        {
            return BashLocator.TryLocate(null, out var bash, out _) ? bash : null;
        }

        _output.WriteLine("[SKIP] " + reason);
        return null;
    }

    // ---- echo：stdout 出现在 OutputReady 事件 ----

    [Fact]
    public void EchoCommand_StdoutArrivesViaOutputReady()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        using var harness = StartHarness($@"""{bash}"" -c ""echo conpty-echo-ok""");

        Assert.True(harness.WaitForText("conpty-echo-ok", TimeoutLong), "未在输出中找到 echo 文本: " + harness.Text);
        Assert.True(harness.WaitForExit(TimeoutLong), "会话未在时限内退出");
        Assert.Equal(0, harness.ExitCode);
    }

    // ---- spec 原始场景：bash -c "echo $SHELL && pwd" ----

    [Fact]
    public void EchoShellAndPwd_OutputContainsWorkingDirectory()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        var cwd = CreateTempDir("pwd");
        using var harness = StartHarness($@"""{bash}"" -c ""echo $SHELL && pwd""", cwd);

        // Git Bash 的 pwd 输出 msys 形式路径（C:\x → /c/x）
        var expected = ToMsysPath(cwd);
        Assert.True(harness.WaitForText(expected, TimeoutLong),
            $"未在输出中找到工作目录 {expected}: {harness.Text}");
        Assert.True(harness.WaitForExit(TimeoutLong));
        Assert.Equal(0, harness.ExitCode);
    }

    // ---- ls ----

    [Fact]
    public void LsCommand_ListsFilesInWorkingDirectory()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        var cwd = CreateTempDir("ls");
        File.WriteAllText(Path.Combine(cwd, "gitui-ls-probe.txt"), "probe");

        using var harness = StartHarness($@"""{bash}"" -c ""ls""", cwd);

        Assert.True(harness.WaitForText("gitui-ls-probe.txt", TimeoutLong), harness.Text);
        Assert.True(harness.WaitForExit(TimeoutLong));
        Assert.Equal(0, harness.ExitCode);
    }

    // ---- git status（走 git CLI 兜底路径的底层通道验证）----

    [Fact]
    public void GitStatus_InFreshRepo_ShowsNoCommitsYet()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        var repo = CreateTempDir("repo");
        var repoFwd = repo.Replace('\\', '/');
        using var harness = StartHarness(
            $@"""{bash}"" -c ""cd '{repoFwd}' && git init . && git status""");

        Assert.True(harness.WaitForText("No commits yet", TimeoutLong), harness.Text);
        Assert.True(harness.WaitForExit(TimeoutLong));
        Assert.Equal(0, harness.ExitCode);
    }

    // ---- less：全屏程序能收到键盘输入并退出 ----

    [Fact]
    public void Less_QuitWithQ_ExitsCleanly()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        // less 需要 TERM；顺带覆盖环境块注入路径
        using var harness = StartHarness(
            $@"""{bash}"" -c ""printf 'alpha\nbeta\n' | less""",
            environment: new Dictionary<string, string> { ["TERM"] = "xterm-256color" });

        Assert.True(harness.WaitForText("beta", TimeoutLong),
            "less 未渲染分页内容: " + harness.Text);
        harness.Session.Write("q"u8);
        Assert.True(harness.WaitForExit(TimeoutLong), "less 未响应 q 退出");
        Assert.Equal(0, harness.ExitCode);
    }

    // ---- exit：退出码正确回传 ----

    [Fact]
    public void ExitCommand_ReportsExitCode()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        using var harness = StartHarness($@"""{bash}"" -c ""exit 42""");

        Assert.True(harness.WaitForExit(TimeoutLong), "会话未在时限内退出");
        Assert.Equal(42, harness.ExitCode);
    }

    // ---- kill -9：异常退出不泄漏句柄 ----

    [Fact]
    public void Kill9_AbnormalExit_ReleasesAllHandles()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        var baseline = ConptyNative.LiveHandleCount;
        var harness = StartHarness($@"""{bash}"" -c ""kill -9 $$""");

        Assert.True(harness.WaitForExit(TimeoutLong), "异常退出未被上报");
        Assert.NotNull(harness.ExitCode);
        Assert.NotEqual(0, harness.ExitCode);
        harness.Dispose();

        Assert.Equal(baseline, ConptyNative.LiveHandleCount);
    }

    // ---- resize：交互 shell 报告新列宽（tput cols 的等价验证，见 design.md §4.7.4）----

    [Fact]
    public void Resize_InteractiveShell_ReportsNewColumns()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        // 交互 bash 由 readline 维护 COLUMNS；ConPTY 下 tput cols 还需 TERM，
        // 两者同源（conhost 尺寸），用 COLUMNS 断言 resize 生效
        var harness = StartHarness($@"""{bash}"" -i");
        try
        {
            harness.Session.Resize(90, 25);
            harness.Session.Write("echo COLS=$COLUMNS\n"u8);

            Assert.True(harness.WaitForText("COLS=90", TimeoutLong),
                "resize 后 shell 未报告新列宽: " + harness.Text);
        }
        finally
        {
            harness.Session.Write("exit\n"u8);
            harness.WaitForExit(TimeoutLong);
            harness.Dispose();
        }
    }

    // ---- stdin 写入 ----

    [Fact]
    public void StdinWrite_ReachesProcessStdout()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        using var harness = StartHarness($@"""{bash}"" -c ""read line; echo GOT=$line""");
        harness.Session.Write("hello-conpty\n"u8);

        Assert.True(harness.WaitForText("GOT=hello-conpty", TimeoutLong), harness.Text);
        Assert.True(harness.WaitForExit(TimeoutLong));
    }

    // ---- 生命周期守卫 ----

    [Fact]
    public void Start_Twice_Throws()
    {
        var bash = RequireConpty();
        if (bash is null) return;

        using var session = new ConptySession($@"""{bash}"" -c ""exit 0""");
        session.Start();
        Assert.Throws<InvalidOperationException>(session.Start);
    }

    [Fact]
    public void Resize_BeforeStart_UpdatesInitialSize()
    {
        using var session = new ConptySession("irrelevant");
        session.Resize(80, 24);

        Assert.Equal(80, session.Columns);
        Assert.Equal(24, session.Rows);
        Assert.False(session.IsRunning);
    }

    [Fact]
    public void Dispose_Twice_AndWithoutStart_DoesNotLeakOrThrow()
    {
        var baseline = ConptyNative.LiveHandleCount;

        var session = new ConptySession("irrelevant");
        session.Dispose();
        session.Dispose();

        Assert.Equal(baseline, ConptyNative.LiveHandleCount);
    }

    // ---- 基础设施 ----

    private const int TimeoutLongMs = 30_000;
    private static TimeSpan TimeoutLong => TimeSpan.FromMilliseconds(TimeoutLongMs);

        private static string CreateTempDir(string tag)
    {
        var dir = Path.Combine(Path.GetTempPath(), $"gitui-conpty-{tag}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>C:\Users\x → /c/Users/x（Git Bash pwd 的 msys 形式）。</summary>
    private static string ToMsysPath(string windowsPath)
    {
        var p = windowsPath.Replace('\\', '/').TrimEnd('/');
        if (p.Length >= 2 && p[1] == ':')
        {
            p = "/" + char.ToLowerInvariant(p[0]) + p[2..];
        }

        return p;
    }

    private SessionHarness StartHarness(
        string commandLine,
        string? workingDirectory = null,
        IReadOnlyDictionary<string, string>? environment = null)
    {
        var session = new ConptySession(commandLine, workingDirectory, environment);
        session.Start();
        return new SessionHarness(session, _output);
    }

    /// <summary>线程安全地累积输出并提供带超时的等待原语。</summary>
    private sealed class SessionHarness : IDisposable
    {
        private readonly StringBuilder _text = new();
        private readonly object _gate = new();

        public ConptySession Session { get; }
        public int? ExitCode { get; private set; }
        private ManualResetEventSlim Exited { get; } = new(false);

        public SessionHarness(ConptySession session, ITestOutputHelper output)
        {
            Session = session;
            session.OutputReady += data =>
            {
                lock (_gate)
                {
                    _text.Append(Encoding.UTF8.GetString(data.Span));
                }
            };
            session.Exited += code =>
            {
                output.WriteLine($"[ConptySession] exited with {code}");
                ExitCode = code;
                Exited.Set();
            };
        }

        public string Text
        {
            get { lock (_gate) return _text.ToString(); }
        }

        public bool WaitForText(string fragment, TimeSpan timeout)
        {
            var deadline = Stopwatch.StartNew();
            while (deadline.Elapsed < timeout)
            {
                if (Text.Contains(fragment, StringComparison.Ordinal))
                {
                    return true;
                }

                Thread.Sleep(50);
            }

            return Text.Contains(fragment, StringComparison.Ordinal);
        }

        public bool WaitForExit(TimeSpan timeout) => Exited.Wait(timeout);

        public void Dispose() => Session.Dispose();
    }
}
