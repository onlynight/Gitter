using System.Runtime.InteropServices;
using System.Text;

namespace GitUI.Shell;

/// <summary>
/// 基于 ConPTY 的真实终端会话（design.md §4.7.4）。
/// 生命周期：Start() 建管道 → CreatePseudoConsole → 带 PSEUDOCONSOLE 属性启动 shell →
/// 专用 Thread 阻塞读输出 → 进程退出后上报 Exited；Dispose 按
/// ClosePseudoConsole → 关 stdin（EOF）→ 等读线程 → 兜底 TerminateProcess → 全量关句柄 收尾。
/// </summary>
public sealed class ConptySession : ITerminalSession
{
    /// <summary>默认初始列数。</summary>
    public const int DefaultColumns = 120;

    /// <summary>默认初始行数。</summary>
    public const int DefaultRows = 30;

    private const int ReadBufferSize = 8192;
    private const int ReadThreadJoinTimeoutMs = 5000;

    private readonly string _commandLine;
    private readonly string? _workingDirectory;
    private readonly IReadOnlyDictionary<string, string>? _environment;

    private IntPtr _hPC;
    private IntPtr _hInputRead;
    private IntPtr _hInputWrite;
    private IntPtr _hOutputRead;
    private IntPtr _hOutputWrite;
    private IntPtr _attributeList;
    private IntPtr _attributeValuePtr;
    private ConptyNative.PROCESS_INFORMATION _pi;
    private Thread? _readThread;

    private bool _started;
    private volatile bool _isRunning;
    private bool _disposed;

    public ConptySession(
        string commandLine,
        string? workingDirectory = null,
        IReadOnlyDictionary<string, string>? environment = null,
        int initialColumns = DefaultColumns,
        int initialRows = DefaultRows)
    {
        _commandLine = commandLine ?? throw new ArgumentNullException(nameof(commandLine));
        _workingDirectory = workingDirectory;
        _environment = environment;
        Columns = initialColumns;
        Rows = initialRows;
    }

    public event Action<ReadOnlyMemory<byte>>? OutputReady;

    public event Action<int>? Exited;

    /// <summary>伪控制台列数（最近一次 Resize 后的值）。</summary>
    public int Columns { get; private set; }

    /// <summary>伪控制台行数（最近一次 Resize 后的值）。</summary>
    public int Rows { get; private set; }

    public bool IsRunning => _isRunning;

    /// <summary>诊断用：shell 进程 ID；未启动时为 0。</summary>
    public int ProcessId => _pi.dwProcessId;

    /// <summary>S2b TerminalParser 接入 OSC 序列前无标题来源，恒为 null。</summary>
    public string? Title => null;

    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_started)
        {
            throw new InvalidOperationException("ConptySession 只能启动一次。");
        }

        _started = true;

        // 1. IO 管道（SECURITY_ATTRIBUTES.bInheritHandle = true）
        ConptyNative.CreatePipe(out _hOutputRead, out _hOutputWrite);
        ConptyNative.CreatePipe(out _hInputRead, out _hInputWrite);

        try
        {
            // conhost 侧不需要被子进程继承的两个端点，屏蔽继承减少句柄泄漏面
            ConptyNative.SetHandleInformation(_hOutputRead, ConptyNative.HANDLE_FLAG_INHERIT, 0);
            ConptyNative.SetHandleInformation(_hInputWrite, ConptyNative.HANDLE_FLAG_INHERIT, 0);

            // 2. 伪控制台：conhost 读 _hInputRead、写 _hOutputWrite
            ConptyNative.CreatePseudoConsole(Columns, Rows, _hInputRead, _hOutputWrite, out _hPC);

            // 3. PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
            _attributeList = ConptyNative.AllocateProcThreadAttributeList(1);
            _attributeValuePtr = ConptyNative.UpdatePseudoConsoleAttribute(_attributeList, _hPC);

            // 4. 启动 shell（bInheritHandles=false：ConPTY 经 attribute 传递，管道无需被子进程继承）
            var si = new ConptyNative.STARTUPINFOEX();
            si.StartupInfo.cb = Marshal.SizeOf<ConptyNative.STARTUPINFOEX>();
            si.lpAttributeList = _attributeList; // 关键：不带 attribute list 的 EXTENDED_STARTUPINFO 会让子进程继承父控制台
            var envBlock = BuildEnvironmentBlock(out var hasEnvBlock);
            // SEM_FAILCRITICALERRORS 会被子进程继承：ConPTY 子进程 DLL 初始化失败
            // （RDP 会话下 bash/cmd 0xC0000142，§11.10.5）时不再弹系统错误对话框，
            // 子进程静默失败，由 Exited 事件走应用层的会话退出提示。
            var previousErrorMode = ConptyNative.SetErrorMode(
                ConptyNative.GetErrorMode() | ConptyNative.SEM_FAILCRITICALERRORS);
            try
            {
                ConptyNative.CreateProcess(
                    _commandLine,
                    inheritHandles: false,
                    ConptyNative.BuildCreationFlags(hasEnvBlock),
                    envBlock,
                    _workingDirectory,
                    ref si,
                    out _pi);
            }
            finally
            {
                ConptyNative.SetErrorMode(previousErrorMode);
                if (hasEnvBlock)
                {
                    Marshal.FreeHGlobal(envBlock);
                }
            }

            // 5. 输出读线程必须是专用 Thread：Task 会被线程池回收导致 buffer 撕裂（design.md §4.7.4）
            _isRunning = true;
            _readThread = new Thread(ReadLoop)
            {
                IsBackground = true,
                Name = "ConptySession.ReadLoop",
            };
            _readThread.Start();
        }
        catch
        {
            _isRunning = false;
            CleanupHandles();
            throw;
        }
    }

    public void Write(ReadOnlySpan<byte> data)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (data.IsEmpty || !_isRunning || _hInputWrite == IntPtr.Zero)
        {
            return;
        }

        try
        {
            ConptyNative.WriteFile(_hInputWrite, data.ToArray());
        }
        catch (Exception ex)
        {
            // 会话恰好退出的竞争：静默降级，不打断调用方
            System.Diagnostics.Debug.WriteLine("ConptySession.Write: " + ex.Message);
        }
    }

    public void Resize(int columns, int rows)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (columns < 1 || rows < 1 || columns > short.MaxValue || rows > short.MaxValue)
        {
            return;
        }

        Columns = columns;
        Rows = rows;
        if (_hPC == IntPtr.Zero)
        {
            return;
        }

        try
        {
            ConptyNative.ResizePseudoConsole(_hPC, columns, rows);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("ConptySession.Resize: " + ex.Message);
        }
    }

    /// <summary>输出读线程：阻塞 ReadFile → OutputReady；流结束后等待进程退出并触发 Exited。</summary>
    private void ReadLoop()
    {
        var buffer = new byte[ReadBufferSize];
        try
        {
            while (ConptyNative.ReadFile(_hOutputRead, buffer, out var read) && read > 0)
            {
                OutputReady?.Invoke(buffer.AsMemory(0, (int)read));
            }
        }
        catch (Exception ex)
        {
            // Dispose 关闭管道时的竞争，属正常退出路径
            System.Diagnostics.Debug.WriteLine("ConptySession.ReadLoop: " + ex.Message);
        }

        var exitCode = -1;
        if (_pi.hProcess != IntPtr.Zero
            && ConptyNative.WaitForSingleObject(_pi.hProcess, ConptyNative.Infinite) == 0
            && ConptyNative.TryGetExitCode(_pi.hProcess, out var code))
        {
            exitCode = code;
        }

        _isRunning = false;
        Exited?.Invoke(exitCode);
    }

    /// <summary>合并父环境与附加环境变量，构造 UTF-16 环境块；无附加变量时继承父环境。</summary>
    private IntPtr BuildEnvironmentBlock(out bool allocated)
    {
        allocated = false;
        if (_environment is not { Count: > 0 })
        {
            return IntPtr.Zero;
        }

        var merged = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in Environment.GetEnvironmentVariables().Keys)
        {
            var name = (string)key;
            merged[name] = Environment.GetEnvironmentVariable(name) ?? string.Empty;
        }

        foreach (var (key, value) in _environment)
        {
            merged[key] = value;
        }

        var block = new StringBuilder();
        foreach (var (key, value) in merged)
        {
            block.Append(key).Append('=').Append(value).Append('\0');
        }

        block.Append('\0');
        allocated = true;
        return Marshal.StringToHGlobalUni(block.ToString());
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // 1. 先关伪控制台：conhost 冲刷剩余输出并关闭输出管道，读线程 ReadFile 随之返回 0
        ConptyNative.ClosePseudoConsoleQuiet(ref _hPC);

        // 2. 关输入写端：shell 的 stdin 收到 EOF，交互 shell 自然退出
        ConptyNative.CloseHandleQuiet(ref _hInputWrite);

        // 3. 等读线程上报退出码；进程赖着不走时兜底强杀
        var thread = _readThread;
        if (thread is { IsAlive: true })
        {
            if (!thread.Join(ReadThreadJoinTimeoutMs))
            {
                if (_pi.hProcess != IntPtr.Zero)
                {
                    ConptyNative.TerminateProcess(_pi.hProcess, exitCode: 1);
                }

                thread.Join(ReadThreadJoinTimeoutMs);
            }
        }

        _isRunning = false;
        CleanupHandles();
    }

    /// <summary>释放全部句柄与 attribute list；幂等，Start 失败与 Dispose 共用。</summary>
    private void CleanupHandles()
    {
        ConptyNative.ClosePseudoConsoleQuiet(ref _hPC);
        ConptyNative.CloseHandleQuiet(ref _hInputWrite);
        ConptyNative.CloseHandleQuiet(ref _hInputRead);
        ConptyNative.CloseHandleQuiet(ref _hOutputRead);
        ConptyNative.CloseHandleQuiet(ref _hOutputWrite);

        if (_pi.hProcess != IntPtr.Zero)
        {
            ConptyNative.CloseHandleQuiet(ref _pi.hProcess);
        }

        if (_pi.hThread != IntPtr.Zero)
        {
            ConptyNative.CloseHandleQuiet(ref _pi.hThread);
        }

        ConptyNative.FreeProcThreadAttributeList(ref _attributeList, _attributeValuePtr);
        _attributeValuePtr = IntPtr.Zero;
    }
}
