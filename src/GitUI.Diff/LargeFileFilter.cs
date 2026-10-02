namespace GitUI.Diff;

/// <summary>
/// 大文件保护阈值（design.md §4.4）：超过任一阈值的文件不落 diff 视图，
/// 提示"以默认编辑器打开"。
/// </summary>
public static class LargeFileFilter
{
    /// <summary>单侧字节上限：5 MB。</summary>
    public const long MaxBytes = 5L * 1024 * 1024;

    /// <summary>单侧行数上限：20 000 行。</summary>
    public const int MaxLines = 20_000;

    public static bool IsTooLarge(long byteCount) => byteCount > MaxBytes;

    public static bool IsTooManyLines(int lineCount) => lineCount > MaxLines;
}
