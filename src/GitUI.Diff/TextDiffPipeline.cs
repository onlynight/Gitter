using GitUI.Core.Models;
using GitUI.Core.Services;
using CoreDiffHunk = GitUI.Core.Models.DiffHunk;

namespace GitUI.Diff;

/// <summary>字节级 diff 的选项。</summary>
public sealed record TextDiffOptions
{
    /// <summary>每个 hunk 携带的上下文行数（git -U 语义）。默认 3。</summary>
    public int ContextLines { get; init; } = 3;

    /// <summary>手动指定编码（design.md §4.4：编码可手动覆盖）。null 时自动探测。</summary>
    public TextEncodingKind? EncodingOverride { get; init; }

    /// <summary>单侧字节上限。默认 <see cref="LargeFileFilter.MaxBytes"/>。</summary>
    public long MaxBytes { get; init; } = LargeFileFilter.MaxBytes;

    /// <summary>单侧行数上限。默认 <see cref="LargeFileFilter.MaxLines"/>。</summary>
    public int MaxLines { get; init; } = LargeFileFilter.MaxLines;
}

/// <summary>
/// 字节级 diff 的结果。不可变。
/// </summary>
/// <param name="IsBinary">任一侧含 NUL（前 8000 字节），不产生文本 hunk。</param>
/// <param name="TooLarge">任一侧超过字节/行数上限，不产生文本 hunk。</param>
/// <param name="Encoding">新内容（新侧为空则旧侧）的探测编码。</param>
/// <param name="OldEndsWithNewline">旧内容末尾是否有换行符（S3 渲染 "\ No newline" 标记用）。</param>
/// <param name="NewEndsWithNewline">新内容末尾是否有换行符。</param>
/// <param name="Hunks">行级差异块。二进制/超限时为空。</param>
/// <param name="AddedLines">新增行数（hunk 汇总）。</param>
/// <param name="DeletedLines">删除行数（hunk 汇总）。</param>
public sealed record TextDiffResult(
    bool IsBinary,
    bool TooLarge,
    TextEncodingKind Encoding,
    bool OldEndsWithNewline,
    bool NewEndsWithNewline,
    IReadOnlyList<DiffHunk> Hunks,
    int AddedLines,
    int DeletedLines)
{
    /// <summary>文本 diff 是否实际产出（非二进制且未超限）。</summary>
    public bool IsTextDiff => !IsBinary && !TooLarge;
}

/// <summary>
/// 字节级 diff 管线（S2）：二进制判定 → 大文件过滤 → 编码探测/解码 → 行级引擎。
/// 整合 design.md §4.4 Diff 编辑器的"编码 / 大文件保护 / 二进制文件"三项能力，
/// 为 S3 DiffCanvas 提供唯一入口。
/// </summary>
public sealed class TextDiffPipeline
{
    private readonly IDiffEngine _engine;

    public TextDiffPipeline(IDiffEngine? engine = null)
        => _engine = engine ?? MyersDiffEngine.Instance;

    /// <param name="oldBytes">旧内容字节。null 表示旧文件不存在（新增）。</param>
    /// <param name="newBytes">新内容字节。null 表示新文件不存在（删除）。</param>
    public TextDiffResult Diff(byte[]? oldBytes, byte[]? newBytes, TextDiffOptions? options = null)
    {
        var opt = options ?? new TextDiffOptions();

        // 1. 二进制判定（任一侧）
        if (BinaryDetector.LooksBinary(oldBytes) || BinaryDetector.LooksBinary(newBytes))
        {
            return new TextDiffResult(
                IsBinary: true, TooLarge: false,
                Encoding: DetectPrimary(oldBytes, newBytes, opt),
                OldEndsWithNewline: true, NewEndsWithNewline: true,
                Hunks: Array.Empty<CoreDiffHunk>(), AddedLines: 0, DeletedLines: 0);
        }

        // 2. 大文件判定（字节级，解码前就拦住，避免无谓的解码开销）
        if (IsTooLarge(oldBytes, opt.MaxBytes) || IsTooLarge(newBytes, opt.MaxBytes))
        {
            return new TextDiffResult(
                IsBinary: false, TooLarge: true,
                Encoding: DetectPrimary(oldBytes, newBytes, opt),
                OldEndsWithNewline: true, NewEndsWithNewline: true,
                Hunks: Array.Empty<CoreDiffHunk>(), AddedLines: 0, DeletedLines: 0);
        }

        // 3. 解码（新旧两侧各自探测，允许两侧编码不同）
        string oldText = DecodeSide(oldBytes, opt);
        string newText = DecodeSide(newBytes, opt);
        var primaryEncoding = newBytes is not null
            ? opt.EncodingOverride ?? EncodingSniffer.Detect(newBytes)
            : opt.EncodingOverride ?? (oldBytes is not null ? EncodingSniffer.Detect(oldBytes) : TextEncodingKind.Utf8);

        // 4. 行数上限（解码后判定）
        if (DiffText.CountLines(oldText) > opt.MaxLines || DiffText.CountLines(newText) > opt.MaxLines)
        {
            return new TextDiffResult(
                IsBinary: false, TooLarge: true,
                Encoding: primaryEncoding,
                OldEndsWithNewline: DiffText.EndsWithNewline(oldText),
                NewEndsWithNewline: DiffText.EndsWithNewline(newText),
                Hunks: Array.Empty<CoreDiffHunk>(), AddedLines: 0, DeletedLines: 0);
        }

        // 5. 行级 diff
        var hunks = _engine.ComputeHunks(oldText, newText, new DiffOptions
        {
            ContextLines = opt.ContextLines,
        });

        int added = 0, deleted = 0;
        foreach (var h in hunks)
        {
            added += h.AddedCount;
            deleted += h.DeletedCount;
        }

        return new TextDiffResult(
            IsBinary: false, TooLarge: false,
            Encoding: primaryEncoding,
            OldEndsWithNewline: DiffText.EndsWithNewline(oldText),
            NewEndsWithNewline: DiffText.EndsWithNewline(newText),
            Hunks: hunks, AddedLines: added, DeletedLines: deleted);
    }

    private static bool IsTooLarge(byte[]? bytes, long max) => bytes is not null && bytes.LongLength > max;

    private static string DecodeSide(byte[]? bytes, TextDiffOptions opt)
    {
        if (bytes is null) return string.Empty;
        var kind = opt.EncodingOverride ?? EncodingSniffer.Detect(bytes);
        return EncodingSniffer.Decode(bytes, kind);
    }

    private static TextEncodingKind DetectPrimary(byte[]? oldBytes, byte[]? newBytes, TextDiffOptions opt)
    {
        if (opt.EncodingOverride is { } o) return o;
        if (newBytes is not null) return EncodingSniffer.Detect(newBytes);
        if (oldBytes is not null) return EncodingSniffer.Detect(oldBytes);
        return TextEncodingKind.Utf8;
    }
}
