using System.Runtime.CompilerServices;
using System.Text;

namespace GitUI.Shell;

/// <summary>
/// 单个字符格。宽字符（CJK）占两格：第二格 <see cref="Char"/> 为 0（占位，渲染时跳过）。
/// 属性以索引引用驻留表（cell 8 字节：消引用写屏障，滚动整块搬移成本减半——xterm.js 同款设计）。
/// </summary>
public readonly record struct TerminalCell(char Char, int AttrIndex)
{
    /// <summary>宽字符的续格标记。</summary>
    public const char WideContinuation = '\0';

    /// <summary>空白格。</summary>
    public static TerminalCell Blank(int attrIndex) => new(' ', attrIndex);
}

/// <summary>
/// 终端字符网格（design.md §4.7.3）：主屏 + 备屏（?1049）、scrollback（仅主屏，上限默认 10000 行）、
/// 滚动区（DECSTBM）、光标与保存光标、自动换行开关、应用光标键模式、窗口标题。
/// 非线程安全：由 UI 线程读、解析线程写（调用方串行化，S0e 经 DispatcherQueue 回投）。
/// </summary>
public sealed class TerminalBuffer
{
    private const char BlankChar = ' ';

    private TerminalCell[][] _screen; // 行指针数组：滚动 = 旋转行引用，O(cols)
    private readonly Queue<TerminalCell[]> _scrollback = new();
    private readonly Stack<TerminalCell[]> _spareLines = new();
    private readonly List<SgrAttribute> _attrTable = new() { SgrAttribute.Normal }; // 索引 0 = Normal
    private readonly Dictionary<SgrAttribute, int> _attrIntern = new();
    private TerminalCell[][] _altScreen;
    private bool _usingAlt;

    /// <summary>创建 buffer。<paramref name="maxScrollbackLines"/> 为 scrollback 上限（仅主屏）。</summary>
    public TerminalBuffer(int columns = 120, int rows = 30, int maxScrollbackLines = 10_000)
    {
        if (columns < 2) throw new ArgumentOutOfRangeException(nameof(columns));
        if (rows < 2) throw new ArgumentOutOfRangeException(nameof(rows));

        Columns = columns;
        Rows = rows;
        MaxScrollbackLines = maxScrollbackLines;
        ScrollRegionTop = 0;
        ScrollRegionBottom = rows - 1;
        _screen = NewGrid(columns, rows);
        _altScreen = NewGrid(columns, rows);
    }

    public int Columns { get; private set; }
    public int Rows { get; private set; }
    public int MaxScrollbackLines { get; }

    /// <summary>scrollback 行数（仅主屏累计；备屏不进 scrollback）。</summary>
    public int ScrollbackCount => _usingAlt ? 0 : _scrollback.Count;

    private int _cursorCol;
    private int _cursorRow;

    /// <summary>光标位置（屏幕坐标，0 起）。</summary>
    public (int Col, int Row) Cursor { get => (_cursorCol, _cursorRow); private set => (_cursorCol, _cursorRow) = value; }

    /// <summary>保存的光标（DECSC/DECRC 与 CSI s/u 共用）。</summary>
    public (int Col, int Row) SavedCursor { get; private set; }

    /// <summary>滚动区上界（0 起含）。</summary>
    public int ScrollRegionTop { get; private set; }

    /// <summary>滚动区下界（0 起含）。</summary>
    public int ScrollRegionBottom { get; private set; }

    /// <summary>自动换行（DECAWM，默认开；?7l 关）。</summary>
    public bool AutoWrap { get; internal set; } = true;

    /// <summary>光标可见（?25，默认可见）。</summary>
    public bool CursorVisible { get; internal set; } = true;

    /// <summary>应用光标键模式（?1；影响画布对方向键的编码，解析器只记标志）。</summary>
    public bool ApplicationCursorKeys { get; internal set; }

    /// <summary>括号粘贴模式（?2004；画布粘贴时据此包裹 \e[200~/201~）。</summary>
    public bool BracketedPaste { get; internal set; }

    /// <summary>反向视频模式（DECSCNM ?5，少数主题切换用）。</summary>
    public bool ReverseVideo { get; internal set; }

    /// <summary>当前在备屏（vim/less 等）。</summary>
    public bool IsAlternateScreen => _usingAlt;

    /// <summary>窗口标题（OSC 0/2）。</summary>
    public string Title { get; internal set; } = string.Empty;

    /// <summary>当前 SGR 属性索引（解析器写入字符时打戳）。</summary>
    internal int CurrentAttrIndex { get; set; }

    /// <summary>属性驻留：相同属性复用同一索引。</summary>
    internal int InternAttr(SgrAttribute attr)
    {
        if (_attrIntern.TryGetValue(attr, out var idx)) return idx;
        idx = _attrTable.Count;
        _attrTable.Add(attr);
        _attrIntern[attr] = idx;
        return idx;
    }

    internal SgrAttribute AttrByIndex(int index) => _attrTable[index];

    private TerminalCell[][] ActiveScreen => _usingAlt ? _altScreen : _screen;

    // ---- 读取 ----

    /// <summary>屏幕格字符（col/row 0 起，屏幕坐标）。越界返回空格。</summary>
    public char GetChar(int col, int row)
    {
        if (col < 0 || col >= Columns || row < 0 || row >= Rows) return BlankChar;
        return ActiveScreen[row][col].Char;
    }

    /// <summary>屏幕格属性。越界返回默认。</summary>
    public SgrAttribute GetAttr(int col, int row)
    {
        if (col < 0 || col >= Columns || row < 0 || row >= Rows) return SgrAttribute.Normal;
        return _attrTable[ActiveScreen[row][col].AttrIndex];
    }

    /// <summary>格属性索引（渲染管线用，越界返回 0 = Normal）。</summary>
    internal int GetAttrIndexInternal(int col, int row)
    {
        if (col < 0 || col >= Columns || row < 0 || row >= Rows) return 0;
        return ActiveScreen[row][col].AttrIndex;
    }

    /// <summary>屏幕行数组（渲染管线用；只读不写）。越界返回 null。</summary>
    internal TerminalCell[]? GetScreenRowInternal(int row)
    {
        if (row < 0 || row >= Rows) return null;
        return ActiveScreen[row];
    }

    /// <summary>是否为宽字符续格（渲染时跳过）。</summary>
    public bool IsWideContinuation(int col, int row) => GetChar(col, row) == TerminalCell.WideContinuation;

    /// <summary>
    /// 取 scrollback 第 <paramref name="index"/> 行（0 = 最旧）。返回行拷贝。
    /// 仅主屏；备屏返回 null。
    /// </summary>
    public TerminalCell[]? GetScrollbackLine(int index)
    {
        if (_usingAlt || index < 0 || index >= _scrollback.Count) return null;
        return _scrollback.ElementAt(index);
    }

    /// <summary>按序枚举 scrollback 行（渲染用，避免 ElementAt 的 O(n) 逐行取）。</summary>
    public IEnumerable<TerminalCell[]> ScrollbackLines => _usingAlt
        ? Enumerable.Empty<TerminalCell[]>()
        : _scrollback;

    // ---- 写入（解析器专用，internal）----

    private bool _wrapPending;

    /// <summary>xterm 挂起换行模型：写满一行后光标钉在末列，下一个可见字符到达才真正换行。</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal void PutChar(char ch, bool wide)
    {
        var attrIdx = CurrentAttrIndex;
        if (_wrapPending && AutoWrap)
        {
            _wrapPending = false;
            LineFeed();
            _cursorCol = 0;
        }
        _wrapPending = false;

        var row = _cursorRow;
        var col = _cursorCol;
        var line = ActiveScreen[row];

        // 行尾宽字符放不下：末格填空白并换行（xterm 行为）
        if (wide && col == Columns - 1)
        {
            line[col] = TerminalCell.Blank(attrIdx);
            LineFeed();
            _cursorCol = 0;
            row = _cursorRow;
            line = ActiveScreen[row];
            col = 0;
        }

        line[col] = new TerminalCell(ch, attrIdx);
        col++;
        if (wide && col < Columns)
        {
            line[col] = new TerminalCell(TerminalCell.WideContinuation, attrIdx);
            col++;
        }

        if (col >= Columns)
        {
            // 光标钉在末列；DECAWM 开启时挂起换行，下个可见字符触发
            _cursorCol = Columns - 1;
            _cursorRow = row;
            _wrapPending = AutoWrap;
            return;
        }

        _cursorCol = col;
        _cursorRow = row;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal void CarriageReturn()
    {
        _wrapPending = false;
        _cursorCol = 0;
    }

    private void CarriageReturnInternal() => Cursor = (0, Cursor.Row);

    internal void Backspace()
    {
        _wrapPending = false;
        _cursorCol = Math.Max(0, _cursorCol - 1);
    }

    internal void Tab()
    {
        _wrapPending = false;
        _cursorCol = Math.Min((_cursorCol / 8 + 1) * 8, Columns - 1);
    }

    /// <summary>LF：滚动区内下移/滚动；区外夹在屏幕底。</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal void LineFeed()
    {
        _wrapPending = false;
        var bottom = ScrollRegionBottom;
        if (_cursorRow == bottom)
        {
            ScrollRegionUp(1);
        }
        else if (_cursorRow < Rows - 1)
        {
            _cursorRow++;
        }
    }

    /// <summary>可见字符触发的换行 = LF + 回到区左界处理（光标列保留，CR 由调用方决定）。</summary>
    internal void LineFeedWithWrap()
    {
        LineFeed();
        var (col, row) = Cursor;
        if (col >= Columns) Cursor = (0, row);
    }

    internal void ReverseIndex()
    {
        if (_cursorRow == ScrollRegionTop)
        {
            ScrollRegionDown(1);
        }
        else if (_cursorRow > 0)
        {
            _cursorRow--;
        }
    }

    internal void SetScrollRegion(int top, int bottom)
    {
        ScrollRegionTop = Math.Clamp(top, 0, Rows - 1);
        ScrollRegionBottom = Math.Clamp(bottom, 0, Rows - 1);
        if (ScrollRegionTop > ScrollRegionBottom)
            (ScrollRegionTop, ScrollRegionBottom) = (ScrollRegionBottom, ScrollRegionTop);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal void SetCursor(int col, int row)
    {
        _wrapPending = false;
        _cursorCol = col;
        _cursorRow = row;
    }

    internal void SaveCursor() => SavedCursor = (_cursorCol, _cursorRow);

    internal void RestoreCursor()
    {
        _wrapPending = false;
        _cursorCol = Math.Clamp(SavedCursor.Col, 0, Columns - 1);
        _cursorRow = Math.Clamp(SavedCursor.Row, 0, Rows - 1);
    }

    /// <summary>清屏（ED n）。</summary>
    internal void EraseDisplay(int mode)
    {
        var screen = ActiveScreen;
        var (col, row) = Cursor;

        void ClearLine(int r, int from, int to)
        {
            for (var c = from; c <= to; c++)
                screen[r][c] = TerminalCell.Blank(CurrentAttrIndex);
        }

        switch (mode)
        {
            case 0:
                ClearLine(row, col, Columns - 1);
                for (var r = row + 1; r < Rows; r++) ClearLine(r, 0, Columns - 1);
                break;
            case 1:
                ClearLine(row, 0, col);
                for (var r = 0; r < row; r++) ClearLine(r, 0, Columns - 1);
                break;
            case 2:
            case 3:
                for (var r = 0; r < Rows; r++) ClearLine(r, 0, Columns - 1);
                if (mode == 3 && !_usingAlt) _scrollback.Clear();
                break;
        }
    }

    /// <summary>清行（EL n）。</summary>
    internal void EraseLine(int mode)
    {
        var screen = ActiveScreen;
        var (col, row) = Cursor;
        switch (mode)
        {
            case 0:
                for (var c = col; c < Columns; c++) screen[row][c] = TerminalCell.Blank(CurrentAttrIndex);
                break;
            case 1:
                for (var c = 0; c <= col; c++) screen[row][c] = TerminalCell.Blank(CurrentAttrIndex);
                break;
            case 2:
                for (var c = 0; c < Columns; c++) screen[row][c] = TerminalCell.Blank(CurrentAttrIndex);
                break;
        }
    }

    /// <summary>插入空白行（CSI Ps L）：滚动区内，光标下方行下移。</summary>
    internal void InsertLines(int count)
    {
        var (col, row) = Cursor;
        if (row < ScrollRegionTop || row > ScrollRegionBottom) return;
        for (var i = 0; i < count; i++) InsertBlankLineAt(row);
        Cursor = (col, row);
    }

    /// <summary>删除行（CSI Ps M）：滚动区内，光标下方行上移补位。</summary>
    internal void DeleteLines(int count)
    {
        var (col, row) = Cursor;
        if (row < ScrollRegionTop || row > ScrollRegionBottom) return;
        for (var i = 0; i < count; i++) DeleteLineAt(row);
        Cursor = (col, row);
    }

    /// <summary>插入空白字符（CSI Ps @）。</summary>
    internal void InsertChars(int count)
    {
        var screen = ActiveScreen;
        var (col, row) = Cursor;
        count = Math.Min(count, Columns - col);
        for (var c = Columns - 1; c >= col + count; c--)
            screen[row][c] = screen[row][c - count];
        for (var c = col; c < col + count; c++)
            screen[row][c] = TerminalCell.Blank(CurrentAttrIndex);
    }

    /// <summary>删除字符（CSI Ps P），行尾补空白。</summary>
    internal void DeleteChars(int count)
    {
        var screen = ActiveScreen;
        var (col, row) = Cursor;
        count = Math.Min(count, Columns - col);
        for (var c = col; c + count < Columns; c++)
            screen[row][c] = screen[row][c + count];
        for (var c = Columns - count; c < Columns; c++)
            screen[row][c] = TerminalCell.Blank(CurrentAttrIndex);
    }

    /// <summary>清屏按钮：等价 CSI 2J + 3J + 光标归位。</summary>
    public void EraseDisplayAll()
    {
        EraseDisplay(2);
        ClearScrollback();
        SetCursor(0, 0);
    }

    /// <summary>清空 scrollback（CSI 3J / 清屏按钮）。</summary>
    internal void ClearScrollback()
    {
        if (!_usingAlt) _scrollback.Clear();
    }

    /// <summary>宿主触发的全量重置（重开 shell / 清屏按钮）；RIS 由解析器走 <see cref="ResetInternal"/>。</summary>
    public void HardReset() => ResetInternal();

    /// <summary>全量重置（RIS，ESC c）。</summary>
    internal void ResetInternal()
    {
        _usingAlt = false;
        _scrollback.Clear();
        FillGrid(_screen, 0);
        FillGrid(_altScreen, 0);
        Cursor = (0, 0);
        SavedCursor = (0, 0);
        ScrollRegionTop = 0;
        ScrollRegionBottom = Rows - 1;
        AutoWrap = true;
        CursorVisible = true;
        ApplicationCursorKeys = false;
        BracketedPaste = false;
        ReverseVideo = false;
        Title = string.Empty;
        CurrentAttrIndex = 0;
    }

    /// <summary>进入/退出备屏（?1049 / ?47 / ?1047）。</summary>
    internal void SetAlternateScreen(bool enable, bool saveCursor)
    {
        if (enable)
        {
            if (_usingAlt) return;
            if (saveCursor) SaveCursor();
            _usingAlt = true;
            FillGrid(_altScreen, 0);
        }
        else
        {
            if (!_usingAlt) return;
            _usingAlt = false;
            if (saveCursor) RestoreCursor();
        }
    }

    /// <summary>
    /// 调整尺寸（ResizePseudoConsole 后调用）。行/列截断保留左上内容；
    /// 仅主屏把放不下的顶部行移入 scrollback（贴进真实终端的 reflow 简化版：不 reflow 长行）。
    /// 光标夹在新界内。
    /// </summary>
    public void Resize(int columns, int rows)
    {
        if (columns < 2 || rows < 2) return;
        if (columns == Columns && rows == Rows) return;

        foreach (var gridRef in new[] { _usingAlt ? _altScreen : _screen, _usingAlt ? _screen : _altScreen })
        {
            var grid = gridRef;
            var next = NewGrid(columns, rows);
            var copyRows = Math.Min(rows, Rows);
            var copyCols = Math.Min(columns, Columns);
            for (var r = 0; r < copyRows; r++)
            {
                Array.Copy(grid[r], 0, next[r], 0, copyCols);
            }
            if (ReferenceEquals(grid, _screen)) _screen = next;
            else _altScreen = next;
        }

        // 主屏缩小：把放不下的顶部行转入 scrollback，保住底部内容（终端常见行为）
        if (rows < Rows && !_usingAlt)
        {
            var evict = Rows - rows;
            for (var r = 0; r < evict; r++)
            {
                PushScrollback(_screen[r]);
            }
            // 内容整体上移 evict 行（行引用旋转，免拷贝）
            for (var r = 0; r + evict < Rows; r++)
            {
                _screen[r] = _screen[r + evict];
            }
            for (var r = Rows - evict; r < Rows; r++)
            {
                _screen[r] = NewScrollbackLine();
                FillRow(_screen, r, Columns, TerminalCell.Blank(0));
            }
        }

        Columns = columns;
        Rows = rows;
        SetScrollRegion(0, Rows - 1);
        _cursorCol = Math.Clamp(_cursorCol, 0, Columns - 1);
        _cursorRow = Math.Clamp(_cursorRow, 0, Rows - 1);
    }

    // ---- 内部辅助 ----

    private static TerminalCell[][] NewGrid(int columns, int rows)
    {
        var grid = new TerminalCell[rows][];
        for (var r = 0; r < rows; r++)
        {
            grid[r] = new TerminalCell[columns];
            FillRow(grid, r, columns, TerminalCell.Blank(0));
        }
        return grid;
    }

    private static void FillGrid(TerminalCell[][] grid, int attrIndex)
    {
        for (var r = 0; r < grid.Length; r++) FillRow(grid, r, grid[r].Length, TerminalCell.Blank(attrIndex));
    }

    private static void FillRow(TerminalCell[][] grid, int row, int columns, TerminalCell cell)
    {
        var line = grid[row];
        for (var c = 0; c < columns; c++) line[c] = cell;
    }

    private TerminalCell[] CopyRows(TerminalCell[] src, int row, int srcCols, TerminalCell[] copy)
    {
        Array.Copy(src, row * srcCols, copy, 0, srcCols);
        return copy;
    }

    private void PushScrollback(TerminalCell[] line)
    {
        _scrollback.Enqueue(line);
        while (_scrollback.Count > MaxScrollbackLines)
        {
            // 淘汰行数组回收复用（10MB 输入 ≈ 14 万次滚动，避免 700MB 分配压力）
            var evicted = _scrollback.Dequeue();
            if (_spareLines.Count < 64) _spareLines.Push(evicted);
        }
    }

    private TerminalCell[] NewScrollbackLine()
        => _spareLines.TryPop(out var reuse) ? reuse : new TerminalCell[Columns];

    private TerminalCell[] TakeSpareLine()
        => _spareLines.TryPop(out var reuse) ? reuse : new TerminalCell[Columns];

    /// <summary>滚动区整体上滚 n 行（CSI S）：与光标无关。</summary>
    internal void ScrollUp(int n) => ScrollRegionUp(n);

    /// <summary>滚动区整体下滚 n 行（CSI T）：与光标无关。</summary>
    internal void ScrollDown(int n) => ScrollRegionDown(n);

    /// <summary>滚动区上移 n 行；顶行（区顶=屏顶且主屏）进 scrollback。</summary>
    private void ScrollRegionUp(int n)
    {
        n = Math.Min(n, ScrollRegionBottom - ScrollRegionTop + 1);
        if (n <= 0) return;
        var screen = ActiveScreen;

        for (var i = 0; i < n; i++)
        {
            if (!_usingAlt && ScrollRegionTop == 0)
            {
                // 顶行数组整体移交 scrollback（内容零拷贝），底行换备用数组——
                // 注意不能把同一数组既入队又留在屏幕（别名会让历史行被后续写入污染）
                PushScrollback(screen[ScrollRegionTop]);
                screen[ScrollRegionTop] = TakeSpareLine();
                for (var r = ScrollRegionTop; r < ScrollRegionBottom; r++)
                    screen[r] = screen[r + 1];
                screen[ScrollRegionBottom] = TakeSpareLine();
                FillRow(screen, ScrollRegionBottom, Columns, TerminalCell.Blank(CurrentAttrIndex));
                continue;
            }

            var rotated = screen[ScrollRegionTop];
            for (var r = ScrollRegionTop; r < ScrollRegionBottom; r++)
                screen[r] = screen[r + 1];
            screen[ScrollRegionBottom] = rotated;
            FillRow(screen, ScrollRegionBottom, Columns, TerminalCell.Blank(CurrentAttrIndex));
        }
    }

    private void ScrollRegionDown(int n)
    {
        var screen = ActiveScreen;
        for (var i = 0; i < n; i++)
        {
            var bottomLine = screen[ScrollRegionBottom];
            for (var r = ScrollRegionBottom; r > ScrollRegionTop; r--)
                screen[r] = screen[r - 1];
            screen[ScrollRegionTop] = bottomLine;
            FillRow(screen, ScrollRegionTop, Columns, TerminalCell.Blank(CurrentAttrIndex));
        }
    }

    private void InsertBlankLineAt(int row)
    {
        var screen = ActiveScreen;
        var moved = screen[ScrollRegionBottom];
        for (var r = ScrollRegionBottom; r > row; r--)
            screen[r] = screen[r - 1];
        screen[row] = moved;
        FillRow(screen, row, Columns, TerminalCell.Blank(CurrentAttrIndex));
    }

    private void DeleteLineAt(int row)
    {
        var screen = ActiveScreen;
        var moved = screen[row];
        for (var r = row; r < ScrollRegionBottom; r++)
            screen[r] = screen[r + 1];
        screen[ScrollRegionBottom] = moved;
        FillRow(screen, ScrollRegionBottom, Columns, TerminalCell.Blank(CurrentAttrIndex));
    }

    /// <summary>调试/无障碍摘要：屏幕文本（宽字符续格折叠），行间 \n。</summary>
    public string ToScreenText()
    {
        var sb = new StringBuilder(Rows * (Columns + 1));
        for (var r = 0; r < Rows; r++)
        {
            for (var c = 0; c < Columns; c++)
            {
                var ch = ActiveScreen[r][c].Char;
                if (ch == TerminalCell.WideContinuation) continue;
                sb.Append(ch);
            }
            sb.Append(NLCH());
        }
        return sb.ToString().TrimEnd('\r', '\n');

        static string NLCH() => "\n";
    }
}
