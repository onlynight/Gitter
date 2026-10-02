namespace GitUI.Shell;

/// <summary>
/// 终端会话抽象，供 UI 与测试共用（design.md §4.7.5）。
/// 实现方：<see cref="ConptySession"/>（真实 ConPTY）、<see cref="FakeTerminalSession"/>（测试替身）。
/// </summary>
public interface ITerminalSession : IDisposable
{
    /// <summary>启动 shell 进程。重复调用抛 <see cref="InvalidOperationException"/>。</summary>
    void Start();

    /// <summary>向 shell 的 stdin 写入字节（通常为 UTF-8 编码的按键/命令）。</summary>
    void Write(ReadOnlySpan<byte> data);

    /// <summary>
    /// shell 输出就绪。从输出读线程触发，消费方若要更新 UI 必须自行调度回 UI 线程。
    /// </summary>
    event Action<ReadOnlyMemory<byte>>? OutputReady;

    /// <summary>shell 进程退出，参数为退出码。触发后 <see cref="IsRunning"/> 为 false。</summary>
    event Action<int>? Exited;

    /// <summary>调整伪控制台尺寸（列 × 行）。会话未启动或已退出时静默忽略。</summary>
    void Resize(int columns, int rows);

    /// <summary>shell 进程是否仍在运行。</summary>
    bool IsRunning { get; }

    /// <summary>终端标题（OSC 序列解析后更新；S2b 之前可能为 null）。</summary>
    string? Title { get; }
}
