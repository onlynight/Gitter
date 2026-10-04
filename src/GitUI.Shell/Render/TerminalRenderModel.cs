using System.Text;

namespace GitUI.Shell.Render;

/// <summary>填充矩形（背景色/选区/光标），像素坐标由画布按格尺寸换算。</summary>
public readonly record struct TermFillRect(int Col, int Row, int Cols, uint Rgba);

/// <summary>一段同属性文本 run（SGR 分组批量绘制，design.md §4.7.3）。</summary>
public sealed record TermTextRun(int Col, int Row, string Text, TermRunStyle Style);

/// <summary>run 样式（渲染引擎可直接消费的已解析颜色）。</summary>
public sealed record TermRunStyle(uint FgRgba, uint BgRgba, bool Bold, bool Italic, bool Underline);

/// <summary>
/// 终端渲染管线（S3b，纯逻辑零 UI 依赖，与 DiffCanvas 同族设计）：
/// <see cref="TerminalBuffer"/> + 视口 → 绘制命令。只产出可视区（含 scrollback 视窗）；
/// 同属性相邻格合并为 run；bg 不同的行先产 FillRect。
/// 绝对行号约定：0 = scrollback 最旧行；屏幕行 R = ScrollbackCount + R。
/// </summary>
public static class TerminalRenderModel
{
    /// <summary>RGBA（画布字节序：A<<24|R<<16|G<<8|B）。</summary>
    public static uint Rgba(byte r, byte g, byte b, byte a = 255) =>
        ((uint)a << 24) | ((uint)r << 16) | ((uint)g << 8) | b;

    /// <summary>把一行格（含续格折叠）提取为文本。</summary>
    public static string LineText(TerminalCell[] line)
    {
        var sb = new StringBuilder(line.Length);
        foreach (var cell in line)
        {
            if (cell.Char == TerminalCell.WideContinuation) continue;
            sb.Append(cell.Char);
        }
        return sb.ToString();
    }

    /// <summary>
    /// 生成可视区绘制命令。
    /// <paramref name="firstRow"/>：可视区首行绝对行号；
    /// <paramref name="rows"/>/<paramref name="cols"/>：可视区格数；
    /// <paramref name="cursorVisibleRow"/>：光标所在绝对行（-1 = 不画光标）。
    /// </summary>
    public static (IReadOnlyList<TermFillRect> Rects, IReadOnlyList<TermTextRun> Runs) Layout(
        TerminalBuffer buffer,
        TerminalPalette palette,
        int firstRow,
        int rows,
        int cols,
        int cursorVisibleRow = -1,
        (int Col, int Row, int Cols, int Rows)? selection = null)
    {
        var rects = new List<TermFillRect>();
        var runs = new List<TermTextRun>();

        // 选区背景（绝对行矩形，先行后文覆盖）
        if (selection is { } sel)
        {
            rects.Add(new TermFillRect(sel.Col, sel.Row, sel.Cols, palette.SelectionRgba));
        }

        var total = buffer.ScrollbackCount + buffer.Rows;
        var bgDefault = palette.BackgroundRgba;
        var fgDefault = palette.ForegroundRgba;

        for (var r = 0; r < rows; r++)
        {
            var abs = firstRow + r;
            if (abs < 0 || abs >= total) continue;

            var line = AbsLine(buffer, abs);
            var sb = new StringBuilder(cols);
            var runStart = -1;
            int runIdx = -1;
            uint runFg = 0, runBg = 0;
            bool runBold = false, runItalic = false, runUnderline = false;

            void Flush(int endColExclusive)
            {
                if (runStart < 0) return;
                var text = sb.ToString();
                if (text.Length > 0)
                {
                    runs.Add(new TermTextRun(runStart, r, text,
                        new TermRunStyle(runFg, runBg, runBold, runItalic, runUnderline)));
                }
                sb.Clear();
                runStart = -1;
            }

            for (var c = 0; c < cols; c++)
            {
                if (c >= line.Length) break; // scrollback 行长度可能短于当前列数（resize 后）
                var cell = line[c];
                if (cell.Char == TerminalCell.WideContinuation) continue;

                var attr = buffer.AttrByIndex(cell.AttrIndex);
                var fg = palette.ResolveForeground(attr);
                var bg = palette.ResolveBackground(attr);

                // 行背景：与默认不同的格先填
                if (bg != bgDefault)
                {
                    rects.Add(new TermFillRect(c, r, 1, bg));
                }

                // 宽字符（占两格）：独立成单字 run——若并入相邻 run，DrawText 会按字体
                // 自然步进排版，CJK 字形宽度 ≠ 两格宽，导致其后字符漂离网格
                // （输入与提示符不对齐的根因之二，提示符/路径含中文时必现）
                var isWide = c + 1 < line.Length && line[c + 1].Char == TerminalCell.WideContinuation;
                if (isWide)
                {
                    Flush(c);
                    if (bg != bgDefault)
                    {
                        rects.Add(new TermFillRect(c, r, 2, bg));
                    }
                    runs.Add(new TermTextRun(c, r, cell.Char.ToString(),
                        new TermRunStyle(fg, bg, attr.Bold, attr.Italic, attr.Underline)));
                    continue; // 下一轮循环跳过续格
                }

                if (runStart < 0)
                {
                    runStart = c;
                    runIdx = cell.AttrIndex;
                    runFg = fg;
                    runBg = bg;
                    runBold = attr.Bold;
                    runItalic = attr.Italic;
                    runUnderline = attr.Underline;
                    sb.Append(cell.Char);
                    continue;
                }

                if (cell.AttrIndex == runIdx && fg == runFg && bg == runBg)
                {
                    sb.Append(cell.Char);
                    continue;
                }

                Flush(c);
                runStart = c;
                runIdx = cell.AttrIndex;
                runFg = fg;
                runBg = bg;
                runBold = attr.Bold;
                runItalic = attr.Italic;
                runUnderline = attr.Underline;
                sb.Append(cell.Char);
            }

            Flush(cols);

            // 光标块（本行时）
            if (abs == cursorVisibleRow && buffer.CursorVisible)
            {
                rects.Add(new TermFillRect(buffer.Cursor.Col, r, 1, palette.CursorRgba));
            }
        }

        return (rects, runs);
    }

    private static TerminalCell[] AbsLine(TerminalBuffer buffer, int absRow)
    {
        var sbCount = buffer.ScrollbackCount;
        if (absRow < sbCount)
        {
            return buffer.GetScrollbackLine(absRow) ?? BlankLine(buffer.Columns);
        }
        return buffer.GetScreenRowInternal(absRow - sbCount) ?? BlankLine(buffer.Columns);
    }

    private static TerminalCell[] BlankLine(int cols) => Enumerable.Repeat(TerminalCell.Blank(0), cols).ToArray();
}

/// <summary>终端调色板（浅/深两套 + SGR 解析）。</summary>
public sealed class TerminalPalette
{
    public uint BackgroundRgba { get; init; }
    public uint ForegroundRgba { get; init; }
    public uint CursorRgba { get; init; }
    public uint SelectionRgba { get; init; }

    /// <summary>16 色板（0-7 标准，8-15 亮色）。</summary>
    public required uint[] Indexed { get; init; }

    private static uint Rgba(byte r, byte g, byte b, byte a = 255)
        => ((uint)a << 24) | ((uint)r << 16) | ((uint)g << 8) | b;

    /// <summary>
    /// 主题包 terminal 段覆盖（theme-framework.md §三）：键 = background/foreground/cursor/
    /// selection 或 "0".."15"，值 = #RRGGBB/#AARRGGBB。返回应用覆盖后的副本（不改静态单例）。
    /// </summary>
    public TerminalPalette WithOverrides(IReadOnlyDictionary<string, string>? overrides)
    {
        if (overrides is null || overrides.Count == 0) return this;

        uint bg = BackgroundRgba, fg = ForegroundRgba, cur = CursorRgba, sel = SelectionRgba;
        var indexed = (uint[])Indexed.Clone();

        foreach (var (key, hex) in overrides)
        {
            string t = hex.StartsWith('#') ? hex[1..] : hex;
            if (t.Length == 8) t = t[2..]; // 丢弃 alpha
            uint v;
            try { v = 0xFF000000 | (Convert.ToUInt32(t, 16) & 0xFFFFFF); }
            catch { continue; // 无效颜色忽略
            }

            switch (key.ToLowerInvariant())
            {
                case "background": bg = v; break;
                case "foreground": fg = v; break;
                case "cursor": cur = v; break;
                case "selection": sel = v; break;
                default:
                    if (int.TryParse(key, out var idx) && idx >= 0 && idx < 16)
                    {
                        indexed[idx] = v;
                    }
                    break;
            }
        }

        return new TerminalPalette
        {
            BackgroundRgba = bg,
            ForegroundRgba = fg,
            CursorRgba = cur,
            SelectionRgba = sel,
            Indexed = indexed,
        };
    }

    public static TerminalPalette Dark { get; } = new()
    {
        BackgroundRgba = Rgba(12, 12, 12),
        ForegroundRgba = Rgba(204, 204, 204),
        CursorRgba = Rgba(174, 175, 173, 255),
        SelectionRgba = Rgba(70, 120, 200, 110),
        Indexed = new uint[]
        {
            Rgba(0, 0, 0), Rgba(197, 15, 31), Rgba(19, 161, 14), Rgba(193, 156, 0),
            Rgba(0, 55, 218), Rgba(136, 23, 152), Rgba(58, 150, 221), Rgba(204, 204, 204),
            Rgba(118, 118, 118), Rgba(231, 72, 86), Rgba(22, 198, 12), Rgba(249, 241, 165),
            Rgba(59, 120, 255), Rgba(180, 0, 158), Rgba(97, 214, 214), Rgba(242, 242, 242),
        },
    };

    public static TerminalPalette Light { get; } = new()
    {
        BackgroundRgba = Rgba(250, 250, 250),
        ForegroundRgba = Rgba(30, 30, 30),
        CursorRgba = Rgba(43, 107, 228, 255),
        SelectionRgba = Rgba(70, 120, 200, 110),
        Indexed = new uint[]
        {
            Rgba(12, 12, 12), Rgba(197, 15, 31), Rgba(19, 161, 14), Rgba(193, 156, 0),
            Rgba(0, 55, 218), Rgba(136, 23, 152), Rgba(58, 150, 221), Rgba(200, 200, 200),
            Rgba(118, 118, 118), Rgba(231, 72, 86), Rgba(22, 198, 12), Rgba(249, 241, 165),
            Rgba(59, 120, 255), Rgba(180, 0, 158), Rgba(97, 214, 214), Rgba(242, 242, 242),
        },
    };

    /// <summary>SGR → 前景。Bold 对 0-7 索引提亮（xterm 惯例）；Reverse 与背景交换。</summary>
    public uint ResolveForeground(SgrAttribute attr)
    {
        var fg = ResolveColor(attr.Foreground, isForeground: true);
        if (attr.Bold && attr.Foreground.Kind == TerminalColorKind.Indexed && attr.Foreground.Indexed < 8)
        {
            fg = Indexed[attr.Foreground.Indexed + 8];
        }
        if (attr.Reverse)
        {
            fg = ResolveColor(attr.Background, isForeground: false);
        }
        return fg;
    }

    public uint ResolveBackground(SgrAttribute attr)
    {
        var bg = ResolveColor(attr.Background, isForeground: false);
        if (attr.Reverse)
        {
            bg = ResolveColorRawFg(attr);
        }
        return bg;
    }

    private uint ResolveColorRawFg(SgrAttribute attr)
    {
        var fg = ResolveColor(attr.Foreground, isForeground: true);
        if (attr.Bold && attr.Foreground.Kind == TerminalColorKind.Indexed && attr.Foreground.Indexed < 8)
        {
            fg = Indexed[attr.Foreground.Indexed + 8];
        }
        return fg;
    }

    private uint ResolveColor(TerminalColor color, bool isForeground)
    {
        return color.Kind switch
        {
            TerminalColorKind.Rgb => Rgba(color.R, color.G, color.B),
            TerminalColorKind.Indexed => Indexed[Math.Clamp(color.Indexed, 0, 15)],
            _ => isForeground ? ForegroundRgba : BackgroundRgba,
        };
    }
}
