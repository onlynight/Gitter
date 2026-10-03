using System.Diagnostics;
using System.Text;

namespace GitUI.Shell;

/// <summary>
/// ConPTY 环境健康预检（S0e，§11.10.5 / §11.18）：
/// 已知 RDP / 非交互会话下，ConPTY 子进程的 DLL 初始化会整体失败
/// （bash/cmd 0xC0000142，微软官方参考实现同样复现，非应用层可修复）。
/// 在启动真实 shell 前，用系统自带 cmd 走一次最小伪控制台会话探测；
/// 探测期间 SEM_FAILCRITICALERRORS 抑制失败弹窗，超时/无输出 = 环境不可用。
/// </summary>
public static class ConptyProbe
{
    /// <summary>探测标记行。</summary>
    public const string Marker = "CONPTY_PROBE_OK";

    /// <summary>
    /// 检测当前会话的伪控制台是否可用。
    /// 返回 true = 健康（收到 cmd 回显）；false = 不可用（无输出/秒退/超时）。
    /// </summary>
    public static bool IsHealthy(int timeoutMs = 5000)
    {
        // 探测期间抑制硬错误弹窗（坏环境下子进程 0xC0000142 会弹对话框）
        var previous = ConptyNative.GetErrorMode();
        ConptyNative.SetErrorMode(previous | ConptyNative.SEM_FAILCRITICALERRORS);
        try
        {
            // 坏环境下 CreatePseudoConsole/Start 本身也可能挂起（§11.10.5）：
            // 整个探测放专用线程 + 硬超时，超时即判环境不可用（挂起线程随进程退出回收）
            var result = false;
            var worker = new Thread(() => result = ProbeCore(timeoutMs))
            {
                IsBackground = true,
                Name = "ConptyProbe.Core",
            };
            worker.Start();
            if (worker.Join(timeoutMs + 3000)) return result;
            return false;
        }
        finally
        {
            ConptyNative.SetErrorMode(previous);
        }
    }

    private static bool ProbeCore(int timeoutMs)
    {
        using var session = new ConptySession(
            commandLine: "cmd /c echo " + Marker,
            initialColumns: 80,
            initialRows: 10);

        var healthy = false;
        var output = new EventWaitHandle(false, EventResetMode.ManualReset);
        void OnOutput(ReadOnlyMemory<byte> bytes)
        {
            if (healthy) return;
            var text = Encoding.UTF8.GetString(bytes.Span);
            if (text.Contains(Marker, StringComparison.Ordinal)) healthy = true;
            output.Set();
        }

        session.OutputReady += OnOutput;
        session.Exited += _ => { try { output.Set(); } catch { } };

        session.Start();

        // 读线程为后台 Thread；等待输出/退出/超时
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (healthy) return true;
            if (output.WaitOne(200)) break;
        }

        // 坏环境下 ClosePseudoConsole 可能挂起（§11.10.5）：清理放独立线程 + 2s 看门狗，
        // 放弃后句柄随进程退出回收（探测会话生命周期极短）
        var cleanup = new Thread(() => { try { session.Dispose(); } catch { } })
        {
            IsBackground = true,
            Name = "ConptyProbe.Cleanup",
        };
        cleanup.Start();
        if (!cleanup.Join(2000)) cleanup.Interrupt();
        return healthy;
    }
}
