using GitUI.Core.Models;
using GitUI.Diff.Highlighting;

namespace GitUI.Diff.Render;

/// <summary>
/// 可视区描述。FirstRow 为视口顶部的行索引（不含 overscan）；HorizontalOffset 为文本列的
/// 水平滚动像素（行号槽与 hunk 头固定不滚）。
/// </summary>
public readonly record struct DiffViewport(
    double Width,
    double Height,
    int FirstRow,
    double HorizontalOffset = 0,
    DiffChangeBlock? CurrentBlock = null);

/// <summary>一次布局的产出：绘制命令列表 + 实际覆盖的行范围（含 overscan）。</summary>
public sealed record DiffFrame(IReadOnlyList<DiffDrawCommand> Commands, int FirstRow, int LastRow);

/// <summary>
/// 把 <see cref="DiffRenderModel"/> 布局为绘制命令（S3）。
/// 几何约定：
/// <list type="bullet">
///   <item>y(row) = (row - FirstRow) × LineHeight，含 overscan 的行可以为负（越出控件顶）。</item>
///   <item>行号槽宽度 = 最大行号位数 × CharWidth + 2×GutterPadding，固定不随水平滚动。</item>
///   <item>并排：左右两列均分剩余宽度，各自裁剪文本（逐 run 按等宽格精确裁剪，不依赖图形栈裁剪）。</item>
///   <item>内联：行号双槽（旧号 + 新号）+ +/- 标记列，文本占满剩余宽度。</item>
/// </list>
/// </summary>
public static class DiffLayoutEngine
{
    /// <summary>
    /// 与 <see cref="Layout"/> 相同的可见行范围计算（含 overscan，供调用方惰性求值）。
    /// First 是夹紧到 [0, rowCount-1] 后的视口首行；From/Last 为实际绘制范围。
    /// </summary>
    public static (int First, int From, int Last) VisibleRange(int rowCount, DiffMetrics metrics, DiffViewport viewport)
    {
        if (rowCount == 0) return (0, 0, -1);

        int first = Math.Clamp(viewport.FirstRow, 0, rowCount - 1);
        int visible = Math.Max(1, (int)Math.Ceiling(viewport.Height / metrics.LineHeight));
        int from = Math.Max(0, first - metrics.OverscanRows);
        int last = Math.Min(rowCount - 1, first + visible + metrics.OverscanRows);
        return (first, from, last);
    }

    public static DiffFrame Layout(DiffRenderModel model, bool sideBySide, DiffMetrics metrics, DiffViewport viewport,
        SyntaxStyleSet? syntaxStyles = null)
    {
        var (first, from, last) = VisibleRange(model.Rows.Count, metrics, viewport);
        var commands = new List<DiffDrawCommand>();
        if (from > last) return new DiffFrame(commands, from, last);

        int digitsOld = Digits(model.MaxOldNumber);
        int digitsNew = Digits(model.MaxNewNumber);

        // FirstRow 用夹紧后的 first，避免越界滚动值把整帧画到负坐标之外
        viewport = viewport with { FirstRow = first };

        if (sideBySide)
            LayoutSideBySide(model, metrics, viewport, from, last, digitsOld, digitsNew, commands, syntaxStyles);
        else
            LayoutInline(model, metrics, viewport, from, last, digitsOld, digitsNew, commands, syntaxStyles);

        return new DiffFrame(commands, from, last);
    }

    private static void LayoutSideBySide(
        DiffRenderModel model, DiffMetrics metrics, DiffViewport viewport,
        int from, int last, int digitsOld, int digitsNew, List<DiffDrawCommand> commands,
        SyntaxStyleSet? syntaxStyles)
    {
        double lh = metrics.LineHeight;
        double charW = metrics.CharWidth;
        double pad = metrics.GutterPadding;
        double w = viewport.Width;
        double leftGutter = digitsOld * charW + pad * 2;
        double rightGutter = digitsNew * charW + pad * 2;
        double colW = Math.Max(0, (w - leftGutter - rightGutter) / 2);
        double midX = leftGutter + colW + rightGutter;
        var block = viewport.CurrentBlock;

        for (int r = from; r <= last; r++)
        {
            var row = model.Rows[r];
            double y = (r - viewport.FirstRow) * lh;
            bool inBlock = block is { } b && r >= b.FirstRow && r <= b.LastRow;

            if (row.IsHunkHeader)
            {
                commands.Add(new FillRectCommand(0, y, w, lh, DiffColorKind.HunkHeaderBackground));
                commands.Add(new TextCommand(row.Left!.Text, pad, y, DiffColorKind.MutedForeground));
                continue;
            }

            commands.Add(new FillRectCommand(0, y, midX, lh, BgKind(row.Left)));
            commands.Add(new FillRectCommand(midX, y, Math.Max(0, w - midX), lh, BgKind(row.Right)));
            if (inBlock)
                commands.Add(new FillRectCommand(0, y, 3, lh, DiffColorKind.CurrentChangeBar));

            if (row.Left is { } l && l.OldNumber > 0)
                commands.Add(new TextCommand(
                    l.OldNumber.ToString(), leftGutter - pad - digitsOld * charW, y, DiffColorKind.LineNumberForeground));
            if (row.Right is { } rt && rt.NewNumber > 0)
                commands.Add(new TextCommand(
                    rt.NewNumber.ToString(), midX - pad - digitsNew * charW, y, DiffColorKind.LineNumberForeground));

            DrawCell(commands, row.Left, metrics, leftGutter, colW, y, viewport.HorizontalOffset, forOldSide: true, syntaxStyles);
            DrawCell(commands, row.Right, metrics, midX, colW, y, viewport.HorizontalOffset, forOldSide: false, syntaxStyles);
        }
    }

    private static void LayoutInline(
        DiffRenderModel model, DiffMetrics metrics, DiffViewport viewport,
        int from, int last, int digitsOld, int digitsNew, List<DiffDrawCommand> commands,
        SyntaxStyleSet? syntaxStyles)
    {
        double lh = metrics.LineHeight;
        double charW = metrics.CharWidth;
        double pad = metrics.GutterPadding;
        double w = viewport.Width;
        double gutterOld = digitsOld * charW + pad * 2;
        double gutterNew = digitsNew * charW + pad * 2;
        double textX = gutterOld + gutterNew;
        var block = viewport.CurrentBlock;

        for (int r = from; r <= last; r++)
        {
            var row = model.Rows[r];
            double y = (r - viewport.FirstRow) * lh;
            bool inBlock = block is { } b && r >= b.FirstRow && r <= b.LastRow;

            if (row.IsHunkHeader)
            {
                commands.Add(new FillRectCommand(0, y, w, lh, DiffColorKind.HunkHeaderBackground));
                commands.Add(new TextCommand(row.Left!.Text, pad, y, DiffColorKind.MutedForeground));
                continue;
            }

            var cell = row.Left!;
            commands.Add(new FillRectCommand(0, y, w, lh, BgKind(cell)));
            if (inBlock)
                commands.Add(new FillRectCommand(0, y, 3, lh, DiffColorKind.CurrentChangeBar));

            if (cell.OldNumber > 0)
                commands.Add(new TextCommand(
                    cell.OldNumber.ToString(), gutterOld - pad - digitsOld * charW, y, DiffColorKind.LineNumberForeground));
            if (cell.NewNumber > 0)
                commands.Add(new TextCommand(
                    cell.NewNumber.ToString(), textX - pad - digitsNew * charW, y, DiffColorKind.LineNumberForeground));

            switch (cell.Kind)
            {
                case DiffRowKind.Added or DiffRowKind.Deleted:
                    // +/- 标记列占 1 格，文本从 textX + CharWidth 起
                    commands.Add(new TextCommand(
                        cell.Kind == DiffRowKind.Added ? "+" : "-",
                        textX, y,
                        cell.Kind == DiffRowKind.Added ? DiffColorKind.AddedForeground : DiffColorKind.DeletedForeground));
                    DrawCell(commands, cell, metrics, textX + charW, w - textX - charW, y, viewport.HorizontalOffset,
                        forOldSide: cell.Kind == DiffRowKind.Deleted, syntaxStyles);
                    break;

                case DiffRowKind.NoNewlineMarker:
                    commands.Add(new TextCommand(cell.Text, textX, y, DiffColorKind.MutedForeground));
                    break;

            default:
                DrawCell(commands, cell, metrics, textX, w - textX, y, viewport.HorizontalOffset, forOldSide: true, syntaxStyles);
                break;
            }
        }
    }

    /// <summary>绘制一个内容格：有语法片段时按语法 run 着色（保留字级差异底），否则按字级分段/整格绘制。</summary>
    private static void DrawCell(
        List<DiffDrawCommand> commands, DiffCell? cell, DiffMetrics metrics,
        double colX, double colW, double y, double horiz, bool forOldSide,
        SyntaxStyleSet? syntaxStyles)
    {
        if (cell is null || cell.Kind is DiffRowKind.Filler) return;

        if (cell.Kind == DiffRowKind.NoNewlineMarker)
        {
            // 并排模式的标记格：绘制在所在列的行首（内联模式由调用方处理）
            commands.Add(new TextCommand(cell.Text, colX + metrics.GutterPadding, y, DiffColorKind.MutedForeground));
            return;
        }

        double colRight = colX + colW;

        if (cell.SyntaxTokens is { Count: > 0 } && syntaxStyles is not null)
        {
            EmitSyntaxRuns(commands, cell, metrics, colX, colRight, y, horiz, forOldSide, syntaxStyles);
            return;
        }

        if (cell.Words is { } words)
        {
            int col = 0;
            foreach (var seg in words)
            {
                var onSide = forOldSide ? seg.Kind != WordSegmentKind.Inserted : seg.Kind != WordSegmentKind.Deleted;
                var highlight = forOldSide
                    ? seg.Kind == WordSegmentKind.Deleted
                    : seg.Kind == WordSegmentKind.Inserted;
                if (onSide)
                {
                    EmitRun(commands, seg.Text, col, colX, colRight, y, metrics, horiz, highlight, cell.Kind);
                    col += seg.Text.Length;
                }
            }
        }
        else
        {
            EmitRun(commands, cell.Text, 0, colX, colRight, y, metrics, horiz, highlight: false, cell.Kind);
        }
    }

    /// <summary>
    /// 输出一段等宽文本，按列裁剪到 [colX, colRight]（首字符 ceil / 末字符 floor，
    /// 保证被列边界切到的字符不越过列边界压到行号槽上）。
    /// </summary>
    private static void EmitRun(
        List<DiffDrawCommand> commands, string text, int startCol,
        double colX, double colRight, double y, DiffMetrics metrics, double horiz,
        bool highlight, DiffRowKind kind)
    {
        if (text.Length == 0) return;

        double charW = metrics.CharWidth;
        double x = colX + startCol * charW - horiz;
        double end = x + text.Length * charW;
        double visLeft = Math.Max(x, colX);
        double visRight = Math.Min(end, colRight);
        if (visRight <= visLeft) return;

        int first = (int)Math.Ceiling((visLeft - x) / charW - 1e-9);
        int lastEx = (int)Math.Floor((visRight - x) / charW + 1e-9);
        first = Math.Clamp(first, 0, text.Length);
        lastEx = Math.Clamp(lastEx, first, text.Length);
        if (lastEx <= first) return;

        double drawX = x + first * charW;
        double drawW = (lastEx - first) * charW;
        var drawText = first == 0 && lastEx == text.Length ? text : text[first..lastEx];

        if (highlight)
            commands.Add(new FillRectCommand(
                drawX, y, drawW, metrics.LineHeight,
                kind == DiffRowKind.Deleted ? DiffColorKind.DeletedWordBackground : DiffColorKind.AddedWordBackground));

        commands.Add(new TextCommand(drawText, drawX, y, DiffColorKind.Foreground));
    }


    /// <summary>
    /// 语法着色绘制（code-highlight-framework.md §五）：
    /// 先按字级差异画高亮底（保留字级功能），再按语法片段 + 纯文本间隙逐 run 着色。
    /// 所有 run 走等宽列裁剪（与 EmitRun 同规则）。
    /// </summary>
    private static void EmitSyntaxRuns(
        List<DiffDrawCommand> commands, DiffCell cell, DiffMetrics metrics,
        double colX, double colRight, double y, double horiz, bool forOldSide,
        SyntaxStyleSet syntaxStyles)
    {
        // 1) 字级高亮底（列范围先画，文本后画覆盖其上）
        if (cell.Words is { } words)
        {
            int col = 0;
            foreach (var seg in words)
            {
                var onSide = forOldSide ? seg.Kind != WordSegmentKind.Inserted : seg.Kind != WordSegmentKind.Deleted;
                var highlight = forOldSide ? seg.Kind == WordSegmentKind.Deleted : seg.Kind == WordSegmentKind.Inserted;
                if (onSide)
                {
                    if (highlight)
                    {
                        FillColumns(commands, col, col + seg.Text.Length, colX, colRight, y, metrics, horiz,
                            cell.Kind == DiffRowKind.Deleted
                                ? DiffColorKind.DeletedWordBackground
                                : DiffColorKind.AddedWordBackground);
                    }

                    col += seg.Text.Length;
                }
            }
        }

        // 2) 语法片段 + 纯文本间隙
        var text = cell.Text;
        int pos = 0;
        foreach (var span in cell.SyntaxTokens!.OrderBy(s => s.Start))
        {
            int start = Math.Clamp(span.Start, 0, text.Length);
            int end = Math.Clamp(span.Start + span.Length, start, text.Length);
            if (start < pos || end <= start) continue;

            if (start > pos)
            {
                EmitRun(commands, text[pos..start], pos, colX, colRight, y, metrics, horiz, highlight: false, cell.Kind);
            }

            if (syntaxStyles.TryGetColor(span.StyleKey, out var color))
            {
                EmitColoredRun(commands, text[start..end], start, colX, colRight, y, metrics, horiz, color);
            }
            else
            {
                EmitRun(commands, text[start..end], start, colX, colRight, y, metrics, horiz, highlight: false, cell.Kind);
            }

            pos = end;
        }

        if (pos < text.Length)
        {
            EmitRun(commands, text[pos..], pos, colX, colRight, y, metrics, horiz, highlight: false, cell.Kind);
        }
    }

    /// <summary>列区间 [startCol, endColEx) 的字级高亮底（含水平裁剪）。</summary>
    private static void FillColumns(
        List<DiffDrawCommand> commands, int startCol, int endColEx,
        double colX, double colRight, double y, DiffMetrics metrics, double horiz, DiffColorKind color)
    {
        if (endColEx <= startCol) return;

        double charW = metrics.CharWidth;
        double x = colX + startCol * charW - horiz;
        double end = x + (endColEx - startCol) * charW;
        double visLeft = Math.Max(x, colX);
        double visRight = Math.Min(end, colRight);
        if (visRight <= visLeft) return;

        commands.Add(new FillRectCommand(visLeft, y, visRight - visLeft, metrics.LineHeight, color));
    }

    /// <summary>带显式颜色的等宽文本 run（语法着色），裁剪规则与 EmitRun 一致。</summary>
    private static void EmitColoredRun(
        List<DiffDrawCommand> commands, string text, int startCol,
        double colX, double colRight, double y, DiffMetrics metrics, double horiz, RgbaColor color)
    {
        if (text.Length == 0) return;

        double charW = metrics.CharWidth;
        double x = colX + startCol * charW - horiz;
        double end = x + text.Length * charW;
        double visLeft = Math.Max(x, colX);
        double visRight = Math.Min(end, colRight);
        if (visRight <= visLeft) return;

        int first = (int)Math.Ceiling((visLeft - x) / charW - 1e-9);
        int lastEx = (int)Math.Floor((visRight - x) / charW + 1e-9);
        first = Math.Clamp(first, 0, text.Length);
        lastEx = Math.Clamp(lastEx, first, text.Length);
        if (lastEx <= first) return;

        double drawX = x + first * charW;
        var drawText = first == 0 && lastEx == text.Length ? text : text[first..lastEx];
        commands.Add(new TextRunCommand(drawText, drawX, y, color));
    }

    private static DiffColorKind BgKind(DiffCell? cell) => cell?.Kind switch
    {
        DiffRowKind.Added => DiffColorKind.AddedBackground,
        DiffRowKind.Deleted => DiffColorKind.DeletedBackground,
        DiffRowKind.Filler => DiffColorKind.FillerBackground,
        _ => DiffColorKind.Background,
    };

    /// <summary>行号位数（行号槽宽度用）。0 视为 1 位（空槽也保留最小宽度）。</summary>
    public static int Digits(int n)
    {
        n = Math.Max(1, n);
        int d = 0;
        while (n > 0)
        {
            d++;
            n /= 10;
        }

        return d;
    }
}
