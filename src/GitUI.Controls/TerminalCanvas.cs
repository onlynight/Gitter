using System.Text;
using GitUI.Controls.Theme;
using GitUI.Shell;
using GitUI.Shell.Render;
using Microsoft.Graphics.Canvas.Text;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace GitUI.Controls;

/// <summary>
/// 自绘终端控件（S3b，design.md §4.7.3，与 DiffCanvas 同族）：
/// Win2D 即时绘制渲染管线的命令；滚动条（scrollback）；闪烁光标（500ms，聚焦时）；
/// 键盘输入编码为 PTY 字节流经 <see cref="KeyPressed"/> 交宿主写入会话；
/// Ctrl+Shift+C 复制选区 / Ctrl+Shift+V 粘贴（括号粘贴模式跟随 buffer）；
/// 主题（浅/深）切换即时换调色板；字体度量用 CanvasTextLayout 实测（DIP，与 DPI 档位联动）。
/// 纯逻辑（滚动数学/选区/编码）在 <see cref="TerminalRenderModel"/> 与本类私有静态方法，headless 可测部分尽量下沉。
/// </summary>
public sealed class TerminalCanvas : Grid
{
    private const double WheelRowsPerNotch = 3;

    private readonly CanvasControl _canvas;
    private readonly ScrollBar _vScroll;
    private TerminalBuffer? _buffer;
    private TerminalPalette _palette = TerminalPalette.Dark;
    private double _charWidth = 9;
    private double _lineHeight = 19;
    private int _metricsDpiKey = -1;
    private CanvasTextFormat? _textFormat;
    private bool _cursorOn;
    private bool _hasFocus;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _blinkTimer;

    // 选区（绝对行坐标）
    private bool _selecting;
    private (int Col, int Row)? _selStart;
    private (int Col, int Row)? _selEnd;

    /// <summary>宿主设置 buffer（会话解析后）并触发重绘。</summary>
    public TerminalBuffer? Buffer
    {
        get => _buffer;
        set
        {
            _buffer = value;
            UpdateScrollRange();
            _canvas.Invalidate();
        }
    }

    /// <summary>可打印/控制字节由宿主写入 PTY（画布不持有会话）。</summary>
    public event Action<ReadOnlyMemory<byte>>? KeyPressed;

    /// <summary>可视区尺寸变化（列×行），宿主据此 ResizePseudoConsole。</summary>
    public event Action<int, int>? ViewportSizeChanged;

    /// <summary>选区文本变化（状态栏可显示）。</summary>
    public event Action<string>? SelectionChanged;

    public TerminalCanvas()
    {
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(12) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });

        _canvas = new CanvasControl();
        _canvas.Draw += OnDraw;
        _canvas.SizeChanged += (_, _) =>
        {
            // 先实测字宽再算列数：此前用默认 _charWidth(9) 推列数并发给 PTY，
            // 而渲染用实测字宽（约 8.4）——整条会话的换行列与可视网格错位，
            // 输入到行尾会提前换行（输入与提示符不对齐的根因之一）
            try { EnsureMetrics(_canvas); } catch { /* 设备未就绪：沿用上次度量 */ }
            UpdateScrollRange();
            ViewportSizeChanged?.Invoke(Columns, Rows);
            _canvas.Invalidate();
        };
        _canvas.PointerPressed += OnPointerPressed;
        _canvas.PointerMoved += OnPointerMoved;
        _canvas.PointerReleased += OnPointerReleased;
        Grid.SetRow(_canvas, 0);
        Grid.SetColumn(_canvas, 0);
        Children.Add(_canvas);

        _vScroll = new ScrollBar
        {
            Orientation = Orientation.Vertical,
            SmallChange = 1,
            Minimum = 0,
            Maximum = 0,
        };
        _vScroll.Scroll += (_, _) => _canvas.Invalidate();
        Grid.SetRow(_vScroll, 0);
        Grid.SetColumn(_vScroll, 1);
        Children.Add(_vScroll);

        IsTabStop = true;
        UseSystemFocusVisuals = false;
        KeyDown += OnKeyDown;
        PointerWheelChanged += OnWheel;

        _blinkTimer = DispatcherQueue.CreateTimer();
        _blinkTimer.Interval = TimeSpan.FromMilliseconds(500);
        _blinkTimer.Tick += (_, _) => { _cursorOn = !_cursorOn; _canvas.Invalidate(); };
        GotFocus += (_, _) => { _hasFocus = true; if (Buffer is { CursorVisible: true }) _blinkTimer.Start(); };
        LostFocus += (_, _) => { _hasFocus = false; _blinkTimer.Stop(); _cursorOn = true; _canvas.Invalidate(); };
        ActualThemeChanged += (_, _) => { _palette = ResolvePalette(); _canvas.Invalidate(); };

        _palette = ResolvePalette();
        AutomationProperties.SetName(this, "终端输出区");
    }

    private TerminalPalette ResolvePalette()
    {
        // 主题包 terminal 段覆盖：克隆内置深/浅色板后应用（不污染静态单例）
        return (ActualTheme == ElementTheme.Light
            ? TerminalPalette.Light
            : TerminalPalette.Dark).WithOverrides(ThemeService.ActiveTerminal);
    }

    /// <summary>可视列数（由像素宽与实测字宽推出）。</summary>
    public int Columns
    {
        get
        {
            var w = _canvas.ActualWidth;
            return w <= 0 ? 80 : Math.Max(2, (int)(w / _charWidth));
        }
    }

    /// <summary>可视行数。</summary>
    public int Rows
    {
        get
        {
            var h = _canvas.ActualHeight;
            return h <= 0 ? 24 : Math.Max(2, (int)(h / _lineHeight));
        }
    }

    /// <summary>scrollback 视窗滚动（绝对行号，画布内部）。</summary>
    private int FirstRow => Buffer is null
        ? 0
        : Math.Clamp((int)_vScroll.Value, 0, Buffer.ScrollbackCount);

    /// <summary>让视窗贴底（新输出到达时宿主调用）。</summary>
    public void ScrollToBottom()
    {
        if (Buffer is null) return;
        _vScroll.Value = Buffer.ScrollbackCount;
        _canvas.Invalidate();
    }

    public void NotifyOutput()
    {
        UpdateScrollRange();
        // 用户停在底部附近则跟随；否则保持位置（查看历史不被打断）
        if (Buffer is not null && _vScroll.Value >= Buffer.ScrollbackCount - 1)
        {
            _vScroll.Value = Buffer.ScrollbackCount;
        }
        _canvas.Invalidate();
    }

    private void UpdateScrollRange()
    {
        if (Buffer is null) { _vScroll.Maximum = 0; return; }
        _vScroll.Maximum = Buffer.ScrollbackCount;
        _vScroll.LargeChange = Math.Max(1, Rows);
        _vScroll.SmallChange = 1;
        _vScroll.Value = Math.Min(_vScroll.Value, Buffer.ScrollbackCount);
    }

    // ---- 绘制 ----

    private void OnDraw(CanvasControl sender, CanvasDrawEventArgs args)
    {
        EnsureMetrics(sender);
        var session = args.DrawingSession;
        session.Clear(ToColor(_palette.BackgroundRgba));

        if (Buffer is null) return;
        var total = Buffer.ScrollbackCount + Buffer.Rows;
        var first = FirstRow;
        var sel = NormalizeSelection();

        var (rects, runs) = TerminalRenderModel.Layout(
            Buffer, _palette, first, Rows, Columns,
            cursorVisibleRow: _cursorOn && _hasFocus
                ? Buffer.ScrollbackCount + Buffer.Cursor.Row
                : -1,
            selection: sel);

        foreach (var rect in rects)
        {
            if (rect.Row < 0 || rect.Row >= Rows) continue;
            session.FillRectangle(
                (float)(rect.Col * _charWidth),
                (float)(rect.Row * _lineHeight),
                (float)(rect.Cols * _charWidth),
                (float)_lineHeight,
                ToColor(rect.Rgba));
        }

        foreach (var run in runs)
        {
            session.DrawText(
                run.Text,
                (float)(run.Col * _charWidth),
                (float)(run.Row * _lineHeight),
                ToColor(run.Style.FgRgba),
                TextFormat);
        }
    }

    private CanvasTextFormat TextFormat => _textFormat ??= new CanvasTextFormat
    {
        FontFamily = "Cascadia Mono, Consolas, Segoe UI Mono",
        FontSize = (float)14,
        FontWeight = new Windows.UI.Text.FontWeight(400),
    };

    /// <summary>实测字符宽/行高（CanvasTextLayout，DIP 坐标；DPI 档位变化才重算）。</summary>
    private void EnsureMetrics(CanvasControl sender)
    {
        var dpiKey = (int)Math.Round(sender.DpiScale * 100);
        if (_metricsDpiKey == dpiKey) return;
        _metricsDpiKey = dpiKey;

        using var layout = new CanvasTextLayout(sender, new string('X', 32), TextFormat, 0, 0);
        var w = layout.LayoutBounds.Width / 32;
        if (w > 1) _charWidth = w;
        var lineMetrics = layout.LineMetrics;
        if (lineMetrics.Length > 0)
        {
            var h = lineMetrics[0].Height;
            if (h > 4) _lineHeight = h;
        }
    }

    private static Windows.UI.Color ToColor(uint rgba) => Windows.UI.Color.FromArgb(
        (byte)(rgba >> 24), (byte)(rgba >> 16), (byte)(rgba >> 8), (byte)rgba);

    // ---- 选区 ----

    private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        Focus(FocusState.Pointer);
        var point = e.GetCurrentPoint(_canvas).Position;
        _selecting = true;
        _selStart = CellAt(point);
        _selEnd = _selStart;
        _canvas.Invalidate();
        e.Handled = true;
    }

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_selecting) return;
        _selEnd = CellAt(e.GetCurrentPoint(_canvas).Position);
        _canvas.Invalidate();
        e.Handled = true;
    }

    private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_selecting) return;
        _selecting = false;
        _selEnd = CellAt(e.GetCurrentPoint(_canvas).Position);
        SelectionChanged?.Invoke(SelectedText());
        _canvas.Invalidate();
        e.Handled = true;
    }

    /// <summary>像素点 → 绝对行格坐标。</summary>
    private (int Col, int Row) CellAt(Windows.Foundation.Point point)
    {
        var col = Math.Clamp((int)(point.X / _charWidth), 0, Columns - 1);
        var row = FirstRow + Math.Clamp((int)(point.Y / _lineHeight), 0, Rows - 1);
        return (col, row);
    }

    private (int Col, int Row, int Cols, int Rows)? NormalizeSelection()
    {
        if (_selStart is null || _selEnd is null) return null;
        var (c0, r0) = _selStart.Value;
        var (c1, r1) = _selEnd.Value;
        if (c0 == c1 && r0 == r1) return null;
        if (r0 > r1 || (r0 == r1 && c0 > c1)) (c0, c1) = (c1, c0);
        (r0, r1) = (Math.Min(r0, r1), Math.Max(r0, r1));
        return (c0, r0, c1 - c0 + 1, r1 - r0 + 1);
    }

    /// <summary>按行提取选区文本（矩形选区，忽略属性——design.md §4.7.3）。</summary>
    public string SelectedText()
    {
        if (Buffer is null || NormalizeSelection() is not { } sel) return string.Empty;
        var sb = new StringBuilder();
        for (var abs = sel.Row; abs < sel.Row + sel.Rows; abs++)
        {
            var line = AbsLineText(abs);
            var from = Math.Min(sel.Col, line.Length);
            var to = Math.Min(sel.Col + sel.Cols, line.Length);
            sb.AppendLine(line[from..to]);
        }
        return sb.ToString();
    }

    private string AbsLineText(int abs)
    {
        if (Buffer is null) return string.Empty;
        var sb = new StringBuilder(Columns);
        var cols = Buffer.Columns;
        for (var c = 0; c < cols; c++)
        {
            var ch = Buffer.GetChar(c, abs - Buffer.ScrollbackCount);
            if (ch != TerminalCell.WideContinuation) sb.Append(ch);
        }
        return sb.ToString();
    }

    // ---- 键盘 → PTY 编码 ----

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (Buffer is null) return;

        // Ctrl+Shift+C / V（design.md §4.7.2）
        var ctrl = e.Key == VirtualKey.C && Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down)
            && Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
        if (ctrl)
        {
            var text = SelectedText();
            if (text.Length > 0)
            {
                var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
                dp.SetText(text);
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
            }
            e.Handled = true;
            return;
        }
        var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
        var control = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
        if (control && shift && e.Key == VirtualKey.V)
        {
            PasteFromClipboard();
            e.Handled = true;
            return;
        }

        // 修饰键（含 CapsLock/NumLock 锁定位）+ 扫描码 → 编码器按真实键盘状态解码
        var mods = new TerminalInputEncoder.Modifiers(
            Ctrl: control,
            Shift: shift,
            Alt: Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Menu).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down),
            CapsLock: Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread((VirtualKey)0x14).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Locked),
            NumLock: Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread((VirtualKey)0x90).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Locked));

        var seq = TerminalInputEncoder.EncodeSpecial((int)e.Key, Buffer.ApplicationCursorKeys, mods);
        if (seq is not null)
        {
            KeyPressed?.Invoke(seq);
            e.Handled = true;
            return;
        }

        // 可打印字符：ToUnicode 按当前键盘状态解码（Shift 区分大小写、OEM 键按布局出真实符号；
        // 中文 IME 输入由宿主 TextBox 旁路，v1 不支持直接上屏）
        var key = (int)e.Key;
        var printable =
            (key >= (int)VirtualKey.Space && key <= (int)VirtualKey.Divide) // Space..0-9..A-Z.. OEM 区
            || key == (int)VirtualKey.Decimal;
        if (printable)
        {
            var text = TerminalInputEncoder.EncodePrintable(key, e.KeyStatus.ScanCode, mods);
            if (text is not null)
            {
                KeyPressed?.Invoke(Encoding.UTF8.GetBytes(text));
                e.Handled = true;
            }
        }
    }

    /// <summary>粘贴剪贴板文本（括号粘贴模式开启时包裹标记）。</summary>
    public void PasteFromClipboard()
    {
        try
        {
            var content = Windows.ApplicationModel.DataTransfer.Clipboard.GetContent();
            if (!content.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.Text)) return;
            var task = content.GetTextAsync();
            var text = task.GetAwaiter().GetResult();
            if (text.Length == 0) return;

            var payload = Buffer?.BracketedPaste == true
                ? "\x1b[200~" + text + "\x1b[201~"
                : text;
            KeyPressed?.Invoke(Encoding.UTF8.GetBytes(payload));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("paste: " + ex);
        }
    }

    private void OnWheel(object sender, PointerRoutedEventArgs e)
    {
        var delta = e.GetCurrentPoint(this).Properties.MouseWheelDelta;
        _vScroll.Value -= delta / 120.0 * WheelRowsPerNotch;
        e.Handled = true;
    }
}
