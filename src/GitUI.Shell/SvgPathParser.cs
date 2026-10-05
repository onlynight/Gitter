namespace GitUI.Shell;

/// <summary>SVG path 子路径：绝对坐标段序列（起点 = <see cref="StartX"/>/<see cref="StartY"/>）。</summary>
public sealed record SvgSubPath(
    double StartX, double StartY, bool IsClosed, IReadOnlyList<SvgSegment> Segments);

/// <summary>
/// 绝对化段：Line 只有终点；Arc 为 SVG 弧参数（rx/ry/旋转角/大弧标志/顺扫标志）+ 终点。
/// </summary>
public readonly record struct SvgSegment(
    bool IsArc, double EndX, double EndY,
    double RadiusX = 0, double RadiusY = 0, double Rotation = 0, bool LargeArc = false, bool Sweep = false);

/// <summary>解析结果：有序子路径。</summary>
public sealed record SvgPathData(IReadOnlyList<SvgSubPath> SubPaths);

/// <summary>
/// SVG path d 属性 → 绝对坐标段数据（纯逻辑，headless 可测）。
/// 支持 M/m L/l H/h V/v A/a Z/z 与参数重复续写（含旗标与负号/小数点黏连的数字切分，
/// 如 "0-3.25"、".1.1"）。设计稿图标（design-mockups 内联 SVG）仅用到该子集。
/// 不支持 C/S/Q/T 曲线、字符集变换——遇到即抛 <see cref="FormatException"/>（调用方兜底）。
/// </summary>
public static class SvgPathParser
{
    public static SvgPathData Parse(string path)
    {
        var tokens = Tokenize(path);
        var i = 0;
        double cx = 0, cy = 0;      // 当前点
        double sx = 0, sy = 0;      // 子路径起点
        var subPaths = new List<SvgSubPath>();
        List<SvgSegment>? segments = null;
        bool closed = false;
        char cmd = '\0';

        void EndSubPath()
        {
            if (segments is not null)
                subPaths.Add(new SvgSubPath(sx, sy, closed, segments));
            segments = null;
            closed = false;
        }

        void StartSubPath(double x, double y)
        {
            EndSubPath();
            cx = x;
            cy = y;
            sx = cx;
            sy = cy;
            segments = new List<SvgSegment>();
        }

        while (i < tokens.Count)
        {
            if (tokens[i] is char c)
            {
                cmd = c; // 大小写有语义（大写=绝对/小写=相对），不得归一化
                i++;
                if (cmd is 'Z' or 'z')
                {
                    if (segments is null) throw new FormatException("Z 无进行中的子路径");
                    closed = true;
                    cx = sx;
                    cy = sy;
                    EndSubPath();
                    continue;
                }
            }
            else if (segments is null)
            {
                throw new FormatException("数字出现在无子路径处");
            }
            else if (cmd is 'M' or 'm')
            {
                cmd = cmd == 'M' ? 'L' : 'l'; // M/m 之后隐式续 L/l
            }

            switch (cmd)
            {
                case 'M':
                {
                    var (x, y) = Pair(tokens, ref i);
                    StartSubPath(x, y);
                    break;
                }
                case 'm':
                {
                    var (dx, dy) = Pair(tokens, ref i);
                    StartSubPath(cx + dx, cy + dy);
                    break;
                }
                case 'L':
                {
                    var (x, y) = Pair(tokens, ref i);
                    segments!.Add(new SvgSegment(false, x, y));
                    cx = x;
                    cy = y;
                    break;
                }
                case 'l':
                {
                    var (dx, dy) = Pair(tokens, ref i);
                    cx += dx;
                    cy += dy;
                    segments!.Add(new SvgSegment(false, cx, cy));
                    break;
                }
                case 'H':
                {
                    var x = Number(tokens, ref i);
                    cx = x;
                    segments!.Add(new SvgSegment(false, cx, cy));
                    break;
                }
                case 'h':
                {
                    cx += Number(tokens, ref i);
                    segments!.Add(new SvgSegment(false, cx, cy));
                    break;
                }
                case 'V':
                {
                    var y = Number(tokens, ref i);
                    cy = y;
                    segments!.Add(new SvgSegment(false, cx, cy));
                    break;
                }
                case 'v':
                {
                    cy += Number(tokens, ref i);
                    segments!.Add(new SvgSegment(false, cx, cy));
                    break;
                }
                case 'A':
                case 'a':
                {
                    var rx = Number(tokens, ref i);
                    var ry = Number(tokens, ref i);
                    var rot = Number(tokens, ref i);
                    var large = Number(tokens, ref i) != 0;
                    var sweep = Number(tokens, ref i) != 0;
                    double x, y;
                    if (cmd == 'A') (x, y) = Pair(tokens, ref i);
                    else
                    {
                        x = cx + Number(tokens, ref i);
                        y = cy + Number(tokens, ref i);
                    }
                    segments!.Add(new SvgSegment(true, x, y, rx, ry, rot, large, sweep));
                    cx = x;
                    cy = y;
                    break;
                }
                default:
                    throw new FormatException($"不支持的命令: {cmd}");
            }
        }

        EndSubPath();
        return new SvgPathData(subPaths);
    }

    private static (double X, double Y) Pair(List<object> tokens, ref int i)
    {
        var x = Number(tokens, ref i);
        var y = Number(tokens, ref i);
        return (x, y);
    }

    private static double Number(List<object> tokens, ref int i)
    {
        if (i >= tokens.Count || tokens[i] is not double v)
            throw new FormatException("缺少数字参数");
        i++;
        return v;
    }

    /// <summary>词法：字母 = 命令（char），其余 = 数字（double）。处理黏连切分。</summary>
    private static List<object> Tokenize(string s)
    {
        var tokens = new List<object>();
        var i = 0;
        while (i < s.Length)
        {
            var ch = s[i];
            if (ch is ' ' or ',' or '\t' or '\n' or '\r')
            {
                i++;
                continue;
            }
            if (char.IsLetter(ch))
            {
                tokens.Add(ch);
                i++;
                continue;
            }
            tokens.Add(ReadNumber(s, ref i));
        }
        return tokens;
    }

    private static double ReadNumber(string s, ref int i)
    {
        var start = i;
        // 符号
        if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
        // 整数部分
        while (i < s.Length && char.IsDigit(s[i])) i++;
        // 小数部分（".5" 也合法；"1.5.25" 在 '.' 已存在时切分为下一个数）
        if (i < s.Length && s[i] == '.')
        {
            i++;
            while (i < s.Length && char.IsDigit(s[i])) i++;
        }
        // 指数
        if (i < s.Length && (s[i] is 'e' or 'E') && i + 1 < s.Length
            && (char.IsDigit(s[i + 1]) || ((s[i + 1] is '-' or '+') && i + 2 < s.Length && char.IsDigit(s[i + 2]))))
        {
            i += 2;
            if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
            while (i < s.Length && char.IsDigit(s[i])) i++;
        }
        if (i == start) throw new FormatException($"位置 {i} 不是数字: '{s[Math.Min(i, s.Length - 1)]}'");
        return double.Parse(s[start..i], System.Globalization.CultureInfo.InvariantCulture);
    }
}
