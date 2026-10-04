using System.Runtime.InteropServices;
using System.Text;

namespace GitUI.App.Platform;

/// <summary>
/// 原生目录选择对话框（SHBrowseForFolder + BIF_NEWDIALOGSTYLE，带路径编辑框、可调大小）。
/// 特意不用现代 IFileOpenDialog：本机 Windows（comdlg32 10.0.26100.8875）上该对象的
/// SetOptions 在 SHCORE.dll 内必现 AccessViolation，独立控制台程序亦崩（known-issues §5.3，
/// 系统组件缺陷），且 AV 无法在 .NET 进程内安全恢复。SHBrowseForFolder 走完全不同的实现
/// 路径，实测正常。必须在 UI 线程调用（对话框对 hwndOwner 模态）；用户取消返回 null。
/// 待系统修复后可改回 IFileOpenDialog（COM vtable 版实现见 git 历史）。
/// </summary>
internal static class FolderPicker
{
    private const uint BifReturnOnlyFsDirs = 0x0001;
    private const uint BifEditBox = 0x0010;
    private const uint BifNewDialogStyle = 0x0040;

    private const uint BffmInitialized = 1;
    private const uint BffmSetSelectionW = 0x0467; // WM_USER + 102，wParam=TRUE 时 lParam 为路径字符串

    public static string? PickFolder(IntPtr owner, string title, string? initialDir = null)
    {
        var titleBuf = Marshal.StringToHGlobalUni(title);
        var initialBuf = string.IsNullOrEmpty(initialDir) ? IntPtr.Zero : Marshal.StringToHGlobalUni(initialDir);
        // 强引用保证回调委托在模态调用期间不被 GC
        BrowseCallbackProc callback = OnBrowseEvent;
        try
        {
            var displayName = Marshal.AllocHGlobal(520);
            try
            {
                var bi = new BROWSEINFOW
                {
                    hwndOwner = owner,
                    pidlRoot = IntPtr.Zero,
                    pszDisplayName = displayName,
                    lpszTitle = titleBuf,
                    ulFlags = BifReturnOnlyFsDirs | BifEditBox | BifNewDialogStyle,
                    lpfn = Marshal.GetFunctionPointerForDelegate(callback),
                    lParam = initialBuf,
                };

                var pidl = SHBrowseForFolderW(ref bi);
                if (pidl == IntPtr.Zero) return null;
                try
                {
                    var sb = new StringBuilder(1024);
                    return SHGetPathFromIDListW(pidl, sb) ? sb.ToString() : null;
                }
                finally
                {
                    CoTaskMemFree(pidl);
                }
            }
            finally
            {
                Marshal.FreeHGlobal(displayName);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(titleBuf);
            if (initialBuf != IntPtr.Zero) Marshal.FreeHGlobal(initialBuf);
        }
    }

    /// <summary>对话框初始化完成后把定位目录发送给列表（无效路径由对话框自行忽略）。</summary>
    private static int OnBrowseEvent(IntPtr hwnd, uint uMsg, IntPtr lParam, IntPtr lpData)
    {
        if (uMsg == BffmInitialized && lpData != IntPtr.Zero)
        {
            SendMessageW(hwnd, BffmSetSelectionW, (IntPtr)1, lpData);
        }
        return 0;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct BROWSEINFOW
    {
        public IntPtr hwndOwner;
        public IntPtr pidlRoot;
        public IntPtr pszDisplayName;   // 接收选中项显示名的缓冲区（应用不消费，仅占位）
        public IntPtr lpszTitle;        // 对话框顶部标签
        public uint ulFlags;
        public IntPtr lpfn;             // BrowseCallbackProc
        public IntPtr lParam;
        public int iImage;
    }

    private delegate int BrowseCallbackProc(IntPtr hwnd, uint uMsg, IntPtr lParam, IntPtr lpData);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHBrowseForFolderW(ref BROWSEINFOW bi);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool SHGetPathFromIDListW(IntPtr pidl, StringBuilder pszPath);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(IntPtr pv);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
