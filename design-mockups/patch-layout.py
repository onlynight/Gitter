# patch-layout.py - add syntax run emission to DiffLayoutEngine
p = "src/GitUI.Diff/Render/DiffLayoutEngine.cs"
raw = open(p, "rb").read()
bom = raw.startswith(b"\xef\xbb\xbf")
s = raw.decode("utf-8-sig" if bom else "utf-8").replace("\r\n", "\n")

def rep(old, new, tag):
    global s
    assert old in s, "anchor missing: " + tag
    s = s.replace(old, new, 1)

rep("""    public static DiffFrame Layout(DiffRenderModel model, bool sideBySide, DiffMetrics metrics, DiffViewport viewport)
    {""",
    """    public static DiffFrame Layout(DiffRenderModel model, bool sideBySide, DiffMetrics metrics, DiffViewport viewport,
        SyntaxStyleSet? syntaxStyles = null)
    {""", "L1")

rep("""        if (sideBySide)
            LayoutSideBySide(model, metrics, viewport, from, last, digitsOld, digitsNew, commands);
        else
            LayoutInline(model, metrics, viewport, from, last, digitsOld, digitsNew, commands);""",
    """        if (sideBySide)
            LayoutSideBySide(model, metrics, viewport, from, last, digitsOld, digitsNew, commands, syntaxStyles);
        else
            LayoutInline(model, metrics, viewport, from, last, digitsOld, digitsNew, commands, syntaxStyles);""", "L2")

rep("""    private static void LayoutSideBySide(
        DiffRenderModel model, DiffMetrics metrics, DiffViewport viewport,
        int from, int last, int digitsOld, int digitsNew, List<DiffDrawCommand> commands)
    {""",
    """    private static void LayoutSideBySide(
        DiffRenderModel model, DiffMetrics metrics, DiffViewport viewport,
        int from, int last, int digitsOld, int digitsNew, List<DiffDrawCommand> commands,
        SyntaxStyleSet? syntaxStyles)
    {""", "L3")

rep("""    private static void LayoutInline(
        DiffRenderModel model, DiffMetrics metrics, DiffViewport viewport,
        int from, int last, int digitsOld, int digitsNew, List<DiffDrawCommand> commands)
    {""",
    """    private static void LayoutInline(
        DiffRenderModel model, DiffMetrics metrics, DiffViewport viewport,
        int from, int last, int digitsOld, int digitsNew, List<DiffDrawCommand> commands,
        SyntaxStyleSet? syntaxStyles)
    {""", "L4")

rep("""            DrawCell(commands, row.Left, metrics, leftGutter, colW, y, viewport.HorizontalOffset, forOldSide: true);
            DrawCell(commands, row.Right, metrics, midX, colW, y, viewport.HorizontalOffset, forOldSide: false);""",
    """            DrawCell(commands, row.Left, metrics, leftGutter, colW, y, viewport.HorizontalOffset, forOldSide: true, syntaxStyles);
            DrawCell(commands, row.Right, metrics, midX, colW, y, viewport.HorizontalOffset, forOldSide: false, syntaxStyles);""", "L5")

rep("""                    DrawCell(commands, cell, metrics, textX + charW, w - textX - charW, y, viewport.HorizontalOffset,
                        forOldSide: cell.Kind == DiffRowKind.Deleted);""",
    """                    DrawCell(commands, cell, metrics, textX + charW, w - textX - charW, y, viewport.HorizontalOffset,
                        forOldSide: cell.Kind == DiffRowKind.Deleted, syntaxStyles);""", "L6")

rep("""                default:
                    DrawCell(commands, cell, metrics, textX, w - textX, y, viewport.HorizontalOffset, forOldSide: true);
                    break;""",
    """            default:
                DrawCell(commands, cell, metrics, textX, w - textX, y, viewport.HorizontalOffset, forOldSide: true, syntaxStyles);
                break;""", "L7")

rep("""    /// <summary>绘制一个内容格：有字级分段时按段绘制（未在本侧出现的段不占列），否则整格一段。</summary>
    private static void DrawCell(
        List<DiffDrawCommand> commands, DiffCell? cell, DiffMetrics metrics,
        double colX, double colW, double y, double horiz, bool forOldSide)
    {
        if (cell is null || cell.Kind is DiffRowKind.Filler) return;
""",
    """    /// <summary>绘制一个内容格：有语法片段时按语法 run 着色（保留字级差异底），否则按字级分段/整格绘制。</summary>
    private static void DrawCell(
        List<DiffDrawCommand> commands, DiffCell? cell, DiffMetrics metrics,
        double colX, double colW, double y, double horiz, bool forOldSide,
        SyntaxStyleSet? syntaxStyles)
    {
        if (cell is null || cell.Kind is DiffRowKind.Filler) return;
""", "L8")

SYNTAX_BRANCH = '''        if (cell.SyntaxTokens is { Count: > 0 } && syntaxStyles is not null)
        {
            EmitSyntaxRuns(commands, cell, metrics, colX, colRight, y, horiz, forOldSide, syntaxStyles);
            return;
        }

'''
rep("""        if (cell.Words is { } words)
        {
            int col = 0;
            foreach (var seg in words)
            {""", SYNTAX_BRANCH + """        if (cell.Words is { } words)
        {
            int col = 0;
            foreach (var seg in words)
            {""", "L9")

HELPERS = '''
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

    private static DiffColorKind BgKind'''

rep("    private static DiffColorKind BgKind", HELPERS, "L10")

open(p, "wb").write((b"\xef\xbb\xbf" if bom else b"") + s.replace("\n", "\r\n").encode("utf-8"))
print("layout engine patched")
