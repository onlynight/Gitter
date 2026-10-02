namespace GitUI.Diff;

/// <summary>
/// 二进制内容判定（S2）。与 git 同一启发式：前 8000 字节中出现 NUL 即二进制。
/// </summary>
public static class BinaryDetector
{
    /// <summary>git buffer_is_binary 的扫描窗口大小。</summary>
    public const int ScanWindowSize = 8000;

    public static bool LooksBinary(ReadOnlySpan<byte> bytes)
    {
        var window = bytes.Slice(0, Math.Min(bytes.Length, ScanWindowSize));
        return window.IndexOf((byte)0) >= 0;
    }
}
