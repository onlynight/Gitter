using System.Text;

namespace GitUI.Shell;

/// <summary>
/// ITerminalSession 测试替身（design.md §4.7.5）。不启动任何进程，
/// 供 UI 层单测与 S0b 阶段的占位面板使用：SimulateOutput / SimulateExit
/// 手工驱动事件，Written 记录全部写入字节供断言。
/// </summary>
public sealed class FakeTerminalSession : ITerminalSession
{
    private readonly object _lock = new();
    private readonly List<byte> _written = new();

    public bool IsRunning { get; private set; }

    /// <summary>Start() 被调用的次数，用于断言 UI 只启动一次。</summary>
    public int StartCount { get; private set; }

    /// <summary>Resize() 收到的最后一次 (columns, rows)；未调用过为 null。</summary>
    public (int Columns, int Rows)? LastResize { get; private set; }

    /// <summary>可编程设置的标题（模拟 OSC 标题序列的最终效果）。</summary>
    public string? Title { get; set; }

    /// <summary>为 true 时，Write 的每个字节同时回显到 OutputReady（模拟终端回显）。</summary>
    public bool EchoInput { get; set; }

    public int DisposeCount { get; private set; }

    public event Action<ReadOnlyMemory<byte>>? OutputReady;

    public event Action<int>? Exited;

    public void Start()
    {
        lock (_lock)
        {
            if (IsRunning)
            {
                throw new InvalidOperationException("FakeTerminalSession 已经启动。");
            }

            IsRunning = true;
            StartCount++;
        }
    }

    public void Write(ReadOnlySpan<byte> data)
    {
        lock (_lock)
        {
            _written.AddRange(data.ToArray());
        }

        if (EchoInput && data.Length > 0)
        {
            OutputReady?.Invoke(data.ToArray());
        }
    }

    public void Resize(int columns, int rows)
    {
        LastResize = (columns, rows);
    }

    /// <summary>向消费方注入一段假输出（如 UTF-8 编码的命令回显）。</summary>
    public void SimulateOutput(ReadOnlySpan<byte> data)
    {
        if (data.Length > 0)
        {
            OutputReady?.Invoke(data.ToArray());
        }
    }

    /// <summary>向消费方注入一段假输出（字符串按 UTF-8 编码）。</summary>
    public void SimulateOutput(string text)
    {
        SimulateOutput(Encoding.UTF8.GetBytes(text));
    }

    /// <summary>触发 Exited 事件并结束会话。</summary>
    public void SimulateExit(int exitCode)
    {
        lock (_lock)
        {
            IsRunning = false;
        }

        Exited?.Invoke(exitCode);
    }

    /// <summary>累计写入的全部字节，供断言（如 S0e 阶段验证 cd 命令注入）。</summary>
    public byte[] GetWrittenBytes()
    {
        lock (_lock)
        {
            return _written.ToArray();
        }
    }

    public string GetWrittenText() => Encoding.UTF8.GetString(GetWrittenBytes());

    public void Dispose()
    {
        DisposeCount++;
        lock (_lock)
        {
            IsRunning = false;
        }
    }
}
