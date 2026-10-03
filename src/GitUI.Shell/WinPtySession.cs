using System.Runtime.InteropServices;
using System.Text;

namespace GitUI.Shell;

/// <summary>
/// winpty 后端（ITerminalSession 实现）：隐藏控制台 + winpty-agent 代理转发。
/// 用于 ConPTY 不可用的环境（0xC0000142，RDP/非交互会话，§11.10.5）——
/// winpty 的设计目标正是此类场景，不依赖伪控制台。
/// winpty.dll / winpty-agent.exe 随应用分发于 pty\winpty\（MIT，node-pty 同源）。
/// </summary>
public sealed class WinPtySession : ITerminalSession
{
    // winpty.h 标志
    private const ulong AGENT_FLAG_CONCEAL = 0x4;                       // 隐藏 agent 控制台
    private const ulong SPAWN_AUTO_SHUTDOWN = 0x1;                      // shell 退出时 agent 退出
    private const ulong SPAWN_EXIT_AFTER_CLIENT_SHUTDOWN = 0x2;         // 客户端退出时 shell 退出

    private readonly string _commandLine;
    private readonly string? _workingDirectory;

    private IntPtr _winpty;
    private IntPtr _coninWrite = IntPtr.Zero;
    private IntPtr _conoutRead = IntPtr.Zero;
    private IntPtr _processHandle = IntPtr.Zero;
    private Thread? _readThread;
    private volatile bool _isRunning;
    private int _cols;
    private int _rows;

    /// <summary>winpty.dll 所在目录（含 winpty.dll 与 winpty-agent.exe）。</summary>
    public static string DllDirectory { get; set; } =
        Path.Combine(AppContext.BaseDirectory, "pty", "winpty");

    /// <inheritdoc />
    public event Action<ReadOnlyMemory<byte>>? OutputReady;

    /// <inheritdoc />
    public event Action<int>? Exited;

    /// <inheritdoc />
    public bool IsRunning => _isRunning;

    /// <inheritdoc />
    public string? Title { get; private set; }

    /// <param name="commandLine">shell 命令行（如 powershell -NoLogo）。</param>
    /// <param name="workingDirectory">工作目录。</param>
    /// <param name="columns">初始列数。</param>
    /// <param name="rows">初始行数。</param>
    public WinPtySession(string commandLine, string? workingDirectory, int columns, int rows)
    {
        _commandLine = commandLine ?? throw new ArgumentNullException(nameof(commandLine));
        _workingDirectory = workingDirectory;
        _cols = columns;
        _rows = rows;
    }

    /// <inheritdoc />
    public void Start()
    {
        // winpty.dll 解析：SetDllDirectory 指向分发目录后 LoadLibrary，后续按名绑定
        Native.EnsureLoaded(DllDirectory);

        var err = IntPtr.Zero;

        // 1. 配置：隐藏 agent 窗口 + 初始尺寸
        var cfg = Native.winpty_config_new(AGENT_FLAG_CONCEAL, out err);
        WinPty.Check(cfg != IntPtr.Zero, err, "winpty_config_new");
        try
        {
            Native.winpty_config_set_initial_size(cfg, _cols, _rows);

            // 2. 启动 winpty-agent（隐藏控制台）
            _winpty = Native.winpty_open(cfg, out err);
            WinPty.Check(_winpty != IntPtr.Zero, err, "winpty_open");
        }
        finally
        {
            Native.winpty_config_free(cfg);
            if (err != IntPtr.Zero) Native.winpty_error_free(err);
        }

        // 3. 打开 conin / conout 命名管道
        _coninWrite = Native.CreateFileW(
            Marshal.PtrToStringUni(Native.winpty_conin_name(_winpty))!,
            0x40000000u /* GENERIC_WRITE */, 0, IntPtr.Zero,
            3 /* OPEN_EXISTING */, 0, IntPtr.Zero);
        if (_coninWrite == new IntPtr(-1)) throw new InvalidOperationException("winpty conin 打开失败");

        var conout = Native.CreateFileW(
            Marshal.PtrToStringUni(Native.winpty_conout_name(_winpty))!,
            0x80000000u /* GENERIC_READ */, 0, IntPtr.Zero,
            3 /* OPEN_EXISTING */, 0, IntPtr.Zero);
        if (conout == new IntPtr(-1)) throw new InvalidOperationException("winpty conout 打开失败");
        _conoutRead = conout;

        // 4. 在 winpty 上启动 shell
        SpawnShell();

        // 5. 输出读线程（专用 Thread，§4.7.4）
        _isRunning = true;
        _readThread = new Thread(() => ReadLoop(_conoutRead))
        {
            IsBackground = true,
            Name = "WinPtySession.ReadLoop",
        };
        _readThread.Start();
    }

    private void SpawnShell()
    {
        var err = IntPtr.Zero;
        var cfg = IntPtr.Zero;
        try
        {
            cfg = Native.winpty_spawn_config_new(
                SPAWN_AUTO_SHUTDOWN | SPAWN_EXIT_AFTER_CLIENT_SHUTDOWN,
                null, // appname：null 时由 cmdline 解析
                _commandLine,
                _workingDirectory,
                null, // env：继承
                out err);
            WinPty.Check(cfg != IntPtr.Zero, err, "winpty_spawn_config_new");

            var ok = Native.winpty_spawn(
                _winpty, cfg,
                out _processHandle, out _, out _, out err);
            if (!ok)
            {
                var msg = err != IntPtr.Zero
                    ? Marshal.PtrToStringUni(Native.winpty_error_msg(err))
                    : "winpty_spawn 失败";
                throw new InvalidOperationException(msg);
            }
        }
        finally
        {
            if (cfg != IntPtr.Zero) Native.winpty_spawn_config_free(cfg);
            if (err != IntPtr.Zero) Native.winpty_error_free(err);
        }
    }

    private void ReadLoop(IntPtr conout)
    {
        var buffer = new byte[8192];
        try
        {
            while (_isRunning)
            {
                if (!Native.ReadFile(conout, buffer, (uint)buffer.Length, out var read, IntPtr.Zero) || read == 0)
                    break;
                OutputReady?.Invoke(buffer.AsMemory(0, (int)read));
            }
        }
        catch
        {
            // 管道断开（会话退出）即结束读循环
        }
        finally
        {
            Native.CloseHandle(conout);
            _isRunning = false;
            var code = 0;
            if (_processHandle != IntPtr.Zero && ConptyNative.TryGetExitCode(_processHandle, out var c)) code = c;
            try { Exited?.Invoke(code); } catch { }
        }
    }

    /// <inheritdoc />
    public void Write(ReadOnlySpan<byte> data)
    {
        if (_coninWrite == IntPtr.Zero) return;
        var src = data.ToArray();
        Native.WriteFile(_coninWrite, src, (uint)src.Length, out var written, IntPtr.Zero);
    }

    /// <inheritdoc />
    public void Resize(int columns, int rows)
    {
        if (_winpty == IntPtr.Zero) return;
        var err = IntPtr.Zero;
        try
        {
            Native.winpty_set_size(_winpty, columns, rows, out err);
        }
        finally
        {
            if (err != IntPtr.Zero) Native.winpty_error_free(err);
        }
        _cols = columns;
        _rows = rows;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _isRunning = false;
        if (_coninWrite != IntPtr.Zero) { Native.CloseHandle(_coninWrite); _coninWrite = IntPtr.Zero; }
        if (_conoutRead != IntPtr.Zero) { Native.CloseHandle(_conoutRead); _conoutRead = IntPtr.Zero; }
        if (_processHandle != IntPtr.Zero) { Native.CloseHandle(_processHandle); _processHandle = IntPtr.Zero; }
        if (_winpty != IntPtr.Zero)
        {
            Native.winpty_free(_winpty);
            _winpty = IntPtr.Zero;
        }
    }

    /// <summary>winpty 辅助：断言非空，否则抛出带错误消息的异常。</summary>
    internal static class WinPty
    {
        public static void Check(bool ok, IntPtr err, string what)
        {
            if (ok) return;
            var msg = err != IntPtr.Zero
                ? Marshal.PtrToStringUni(Native.winpty_error_msg(err))
                : null;
            throw new InvalidOperationException($"{what} 失败: {msg ?? "未知错误"}");
        }
    }

    /// <summary>winpty C API P/Invoke（签名对齐 winpty.h）。</summary>
    internal static class Native
    {
        private static int _loadAttempted;

        /// <summary>SetDllDirectory 指向分发目录并预加载 winpty.dll（后续按名绑定的 DllImport 落到该模块）。</summary>
        internal static void EnsureLoaded(string directory)
        {
            if (Interlocked.Exchange(ref _loadAttempted, 1) == 1) return;
            if (Directory.Exists(directory)) SetDllDirectoryW(directory);
            LoadLibraryW("winpty.dll");
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectoryW([MarshalAs(UnmanagedType.LPWStr)] string? path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryW([MarshalAs(UnmanagedType.LPWStr)] string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr CreateFileW(
            [MarshalAs(UnmanagedType.LPWStr)] string name,
            uint access, uint share, IntPtr security,
            uint disposition, uint flags, IntPtr template);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool WriteFile(IntPtr h, byte[] buf, uint n, out uint written, IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool ReadFile(IntPtr h, byte[] buf, uint n, out uint read, IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CloseHandle(IntPtr h);

        [DllImport("winpty.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
        internal static extern IntPtr winpty_config_new(ulong agentFlags, out IntPtr err);

        [DllImport("winpty.dll", CallingConvention = CallingConvention.StdCall)]
        internal static extern void winpty_config_free(IntPtr cfg);

        [DllImport("winpty.dll", CallingConvention = CallingConvention.StdCall)]
        internal static extern void winpty_config_set_initial_size(IntPtr cfg, int cols, int rows);

        [DllImport("winpty.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
        internal static extern IntPtr winpty_open(IntPtr cfg, out IntPtr err);

        [DllImport("winpty.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
        internal static extern IntPtr winpty_conin_name(IntPtr w);

        [DllImport("winpty.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
        internal static extern IntPtr winpty_conout_name(IntPtr w);

        [DllImport("winpty.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
        internal static extern IntPtr winpty_spawn_config_new(
            ulong spawnFlags,
            [MarshalAs(UnmanagedType.LPWStr)] string? appname,
            [MarshalAs(UnmanagedType.LPWStr)] string cmdline,
            [MarshalAs(UnmanagedType.LPWStr)] string? cwd,
            [MarshalAs(UnmanagedType.LPWStr)] string? env,
            out IntPtr err);

        [DllImport("winpty.dll", CallingConvention = CallingConvention.StdCall)]
        internal static extern void winpty_spawn_config_free(IntPtr cfg);

        [DllImport("winpty.dll", CallingConvention = CallingConvention.StdCall)]
        internal static extern bool winpty_spawn(
            IntPtr w, IntPtr cfg,
            out IntPtr processHandle, out IntPtr threadHandle,
            out uint createProcessError, out IntPtr err);

        [DllImport("winpty.dll", CallingConvention = CallingConvention.StdCall)]
        internal static extern bool winpty_set_size(IntPtr w, int cols, int rows, out IntPtr err);

        [DllImport("winpty.dll", CallingConvention = CallingConvention.StdCall)]
        internal static extern void winpty_free(IntPtr w);

        [DllImport("winpty.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
        internal static extern IntPtr winpty_error_msg(IntPtr err);

        [DllImport("winpty.dll", CallingConvention = CallingConvention.StdCall)]
        internal static extern void winpty_error_free(IntPtr err);
    }
}
