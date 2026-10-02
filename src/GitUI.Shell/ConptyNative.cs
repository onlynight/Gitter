using System.ComponentModel;
using System.Runtime.InteropServices;

namespace GitUI.Shell;

/// <summary>
/// ConPTY / 进程相关 Win32 P/Invoke（design.md §4.7.4）。
/// 原始导入全部私有，对外暴露带错误检查的包装：失败抛 <see cref="Win32Exception"/>，
/// 成功时维护 <see cref="LiveHandleCount"/> 计数（管道 +2 / 进程 +2 / 伪控制台 +1），
/// 供集成测试断言"异常退出不泄漏句柄"。
/// </summary>
internal static class ConptyNative
{
    internal const int HANDLE_FLAG_INHERIT = 0x00000001;
    internal const uint Infinite = 0xFFFFFFFF;
    internal const uint WaitTimeout = 0x00000102;
    internal const int StillActive = 0x00000103;

    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const nint PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;

    private static int _liveHandles;

    /// <summary>当前由本类申请且尚未释放的内核句柄与伪控制台总数（跨会话累计）。</summary>
    internal static int LiveHandleCount => Volatile.Read(ref _liveHandles);

    private static void Track(int delta) => Interlocked.Add(ref _liveHandles, delta);

    // ---- 管道 ----

    /// <summary>创建匿名管道（bInheritHandle = true，design.md §4.7.4 约束表）。</summary>
    internal static void CreatePipe(out IntPtr readEnd, out IntPtr writeEnd)
    {
        var sa = new SECURITY_ATTRIBUTES
        {
            nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(),
            bInheritHandle = true,
            lpSecurityDescriptor = IntPtr.Zero,
        };
        if (!CreatePipeNative(out readEnd, out writeEnd, ref sa, 0))
        {
            throw new Win32Exception();
        }

        Track(2);
    }

    /// <summary>读管道：阻塞读，返回 false 表示管道已关闭（EOF）。</summary>
    internal static bool ReadFile(IntPtr handle, byte[] buffer, out uint bytesRead)
        => ReadFileNative(handle, buffer, (uint)buffer.Length, out bytesRead, IntPtr.Zero);

    internal static void WriteFile(IntPtr handle, byte[] buffer)
    {
        if (!WriteFileNative(handle, buffer, (uint)buffer.Length, out _, IntPtr.Zero))
        {
            throw new Win32Exception();
        }
    }

    internal static void SetHandleInformation(IntPtr handle, int mask, int flags)
    {
        if (!SetHandleInformationNative(handle, mask, flags))
        {
            throw new Win32Exception();
        }
    }

    /// <summary>关闭句柄并把计数减一；句柄已为零则跳过。清理路径专用，失败不抛。</summary>
    internal static void CloseHandleQuiet(ref IntPtr handle)
    {
        var h = handle;
        handle = IntPtr.Zero;
        if (h == IntPtr.Zero)
        {
            return;
        }

        if (CloseHandleNative(h))
        {
            Track(-1);
        }
    }

    // ---- 伪控制台 ----

    internal static void CreatePseudoConsole(int columns, int rows, IntPtr hInput, IntPtr hOutput, out IntPtr hPC)
    {
        var hr = CreatePseudoConsoleNative(new COORD { X = (short)columns, Y = (short)rows }, hInput, hOutput, 0, out hPC);
        if (hr != 0)
        {
            throw new Win32Exception(hr);
        }

        Track(1);
    }

    internal static void ResizePseudoConsole(IntPtr hPC, int columns, int rows)
    {
        var hr = ResizePseudoConsoleNative(hPC, new COORD { X = (short)columns, Y = (short)rows });
        if (hr != 0)
        {
            throw new Win32Exception(hr);
        }
    }

    internal static void ClosePseudoConsoleQuiet(ref IntPtr hPC)
    {
        var h = hPC;
        hPC = IntPtr.Zero;
        if (h == IntPtr.Zero)
        {
            return;
        }

        if (ClosePseudoConsoleNative(h) == 0)
        {
            Track(-1);
        }
    }

    // ---- 进程启动（PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE）----

    internal static IntPtr AllocateProcThreadAttributeList(int attributeCount)
    {
        // 第一次调用传 NULL 只为取得所需尺寸，返回 false 是预期行为
        var size = IntPtr.Zero;
        _ = InitializeProcThreadAttributeListNative(IntPtr.Zero, attributeCount, 0, ref size);
        if (size == IntPtr.Zero)
        {
            throw new Win32Exception();
        }

        var list = Marshal.AllocHGlobal(size);
        if (!InitializeProcThreadAttributeListNative(list, attributeCount, 0, ref size))
        {
            Marshal.FreeHGlobal(list);
            throw new Win32Exception();
        }

        return list;
    }

    /// <summary>把伪控制台句柄挂到 attribute list。返回的值指针必须保留到列表释放前有效。</summary>
    internal static IntPtr UpdatePseudoConsoleAttribute(IntPtr attributeList, IntPtr hPC)
    {
        var valuePtr = Marshal.AllocHGlobal(IntPtr.Size);
        Marshal.WriteIntPtr(valuePtr, hPC);
        if (!UpdateProcThreadAttributeNative(
                attributeList, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, valuePtr,
                (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
        {
            Marshal.FreeHGlobal(valuePtr);
            throw new Win32Exception();
        }

        return valuePtr;
    }

    internal static void FreeProcThreadAttributeList(ref IntPtr attributeList, IntPtr valuePtr)
    {
        var list = attributeList;
        attributeList = IntPtr.Zero;
        if (list == IntPtr.Zero)
        {
            return;
        }

        DeleteProcThreadAttributeListNative(list);
        if (valuePtr != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(valuePtr);
        }

        Marshal.FreeHGlobal(list);
    }

    /// <summary>组装 dwCreationFlags：扩展启动信息 + 可选的 Unicode 环境块。</summary>
    internal static uint BuildCreationFlags(bool hasEnvironmentBlock)
        => EXTENDED_STARTUPINFO_PRESENT | (hasEnvironmentBlock ? CREATE_UNICODE_ENVIRONMENT : 0);

    internal static void CreateProcess(
        string commandLine,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environmentBlock,
        string? workingDirectory,
        ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInfo)
    {
        if (!CreateProcessWNative(
                null, commandLine, IntPtr.Zero, IntPtr.Zero, inheritHandles,
                creationFlags, environmentBlock, workingDirectory,
                ref startupInfo, out processInfo))
        {
            throw new Win32Exception();
        }

        Track(2); // hProcess + hThread
    }

    internal static uint WaitForSingleObject(IntPtr handle, uint milliseconds)
        => WaitForSingleObjectNative(handle, milliseconds);

    internal static bool TryGetExitCode(IntPtr processHandle, out int exitCode)
    {
        if (!GetExitCodeProcessNative(processHandle, out var code))
        {
            exitCode = -1;
            return false;
        }

        exitCode = unchecked((int)code);
        return true;
    }

    internal static void TerminateProcess(IntPtr processHandle, int exitCode)
        => _ = TerminateProcessNative(processHandle, (uint)exitCode);

    // ---- 结构体 ----

    [StructLayout(LayoutKind.Sequential)]
    internal struct COORD
    {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public bool bInheritHandle;
        public IntPtr lpSecurityDescriptor;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    // ---- 原始导入 ----

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "CreatePipe")]
    private static extern bool CreatePipeNative(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, uint nSize);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "ReadFile")]
    private static extern bool ReadFileNative(IntPtr hFile, [Out] byte[] lpBuffer, uint nNumberOfBytesToRead, out uint lpNumberOfBytesRead, IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "WriteFile")]
    private static extern bool WriteFileNative(IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToWrite, out uint lpNumberOfBytesWritten, IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "SetHandleInformation")]
    private static extern bool SetHandleInformationNative(IntPtr hObject, int dwMask, int dwFlags);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "CloseHandle")]
    private static extern bool CloseHandleNative(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "CreatePseudoConsole")]
    private static extern int CreatePseudoConsoleNative(COORD size, IntPtr hInput, IntPtr hOutput, uint dwFlags, out IntPtr phPC);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "ResizePseudoConsole")]
    private static extern int ResizePseudoConsoleNative(IntPtr hPC, COORD size);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "ClosePseudoConsole")]
    private static extern int ClosePseudoConsoleNative(IntPtr hPC);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "InitializeProcThreadAttributeList")]
    private static extern bool InitializeProcThreadAttributeListNative(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "UpdateProcThreadAttribute")]
    private static extern bool UpdateProcThreadAttributeNative(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "DeleteProcThreadAttributeList")]
    private static extern void DeleteProcThreadAttributeListNative(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")]
    private static extern bool CreateProcessWNative(
        string? lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "WaitForSingleObject")]
    private static extern uint WaitForSingleObjectNative(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "GetExitCodeProcess")]
    private static extern bool GetExitCodeProcessNative(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "TerminateProcess")]
    private static extern bool TerminateProcessNative(IntPtr hProcess, uint uExitCode);
}
