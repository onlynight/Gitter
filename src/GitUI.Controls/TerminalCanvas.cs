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
    private const double ScrollbarGutter = 14;  // 自绘滚动条槽宽（DIP，含左右留白）
    private const double ThumbMinHeight = 28;   // thumb 最小高度：10k 行 scrollback 时按比例仅 ~2px，必须托底

    private readonly CanvasControl _canvas;
    private TerminalBuffer? _buffer;
    private TerminalPalette _palette = TerminalPalette.Dark;
    private double _charWidth = 9;
    private double _lineHeight = 19;
    private int _metricsDpiKey = -1;
    private CanvasTextFormat? _textFormat;
    private bool _cursorOn;
    private bool _hasFocus;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _blinkTimer;

    // 自绘滚动条状态（替代 WinUI ScrollBar：其 thumb 高度按 LargeChange/(Maximum+LargeChange)
    // 比例计算，10k scrollback 时仅 ~2px 且轨道透明 —— 视觉上等于没有滚动条；
    // 且 ScrollBar 列透明会让下层页面透出 —— 右缘"残影"的来源）
    private double _scrollValue;      // 0..ScrollbackCount
    private int _lastScrollbackCount; // 上次输出时的 scrollback 行数（贴底跟随的判定基准）
    private bool _dragThumb;
    private double _dragGrabOffset;   // 按点相对 thumb 顶部的偏移

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
            _lastScrollbackCount = value?.ScrollbackCount ?? 0;
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
        _canvas = new CanvasControl();
        _canvas.Draw += OnDraw;
        _canvas.SizeChanged += (_, _) =>
        {
            // 先实测字宽再算列数：此前用默认 _charWidth(9) 推列数并发给 PTY，
            // 而渲染用实测字宽（约 8.4）——整条会话的换行列与可视网格错位，
            // 输入到行尾会提前换行（输入与提示符不对齐的根因之一）
            try { EnsureMetrics(_canvas); } catch { /* 设备未就绪：沿用上次度量 */ }
            ViewportSizeChanged?.Invoke(Columns, Rows);
            _canvas.Invalidate();
        };
        _canvas.PointerPressed += OnPointerPressed;
        _canvas.PointerMoved += OnPointerMoved;
        _canvas.PointerReleased += OnPointerReleased;
        Children.Add(_canvas);

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

    /// <summary>可视列数（内容区像素宽 ÷ 实测字宽；右侧自绘滚动条槽不计入）。</summary>
    public int Columns
    {
        get
        {
            var w = _canvas.ActualWidth - ScrollbarGutter;
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
        : Math.Clamp((int)Math.Round(_scrollValue), 0, Buffer.ScrollbackCount);

    /// <summary>让视窗贴底（新输出到达时宿主调用）。</summary>
    public void ScrollToBottom()
    {
        if (Buffer is null) return;
        _scrollValue = Buffer.ScrollbackCount;
        _canvas.Invalidate();
    }

    public void NotifyOutput()
    {
        if (Buffer is not null)
        {
            // 贴底跟随以"上一次输出时"的 scrollback 为基准：一次输出 chunk 常含多行
            // （8KB 读缓冲 ≈ 上百行），若与增长后的 sb 比较会误判"用户在看历史"而停止跟随
            if (_scrollValue >= Math.Max(0, _lastScrollbackCount - 1))
            {
                _scrollValue = Buffer.ScrollbackCount;
            }
            _lastScrollbackCount = Buffer.ScrollbackCount;
        }
        _canvas.Invalidate();
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

        DrawScrollbar(session);
    }

    /// <summary>自绘滚动条（scrollback > 0 时）：可见 thumb（带最小高度）+ 淡轨道。</summary>
    private void DrawScrollbar(Microsoft.Graphics.Canvas.CanvasDrawingSession session)
    {
        if (Buffer is null || Buffer.ScrollbackCount <= 0) return;
        var trackH = _canvas.ActualHeight - 4;
        if (trackH <= 0 || _canvas.ActualWidth <= ScrollbarGutter) return;

        var trackX = _canvas.ActualWidth - ScrollbarGutter + 2;
        session.FillRectangle((float)trackX, 2f, (float)(ScrollbarGutter - 4), (float)trackH,
            ToColor(TerminalRenderModel.Rgba(128, 128, 128, 26)));
        var thumb = ThumbRect();
        session.FillRectangle((float)thumb.X, (float)thumb.Y, (float)thumb.Width, (float)thumb.Height,
            ToColor(TerminalRenderModel.Rgba(128, 128, 128, 140)));
    }

    /// <summary>当前 thumb 矩形（画布 DIP 坐标；scrollback 为 0 时返回 Empty）。</summary>
    private Windows.Foundation.Rect ThumbRect()
    {
        var sb = Buffer?.ScrollbackCount ?? 0;
        var trackH = _canvas.ActualHeight - 4;
        if (sb <= 0 || trackH <= ThumbMinHeight) return default;

        var frac = (double)Math.Max(1, Rows) / (sb + Math.Max(1, Rows));
        var thumbH = Math.Max(ThumbMinHeight, trackH * frac);
        var y = 2 + (trackH - thumbH) * Math.Clamp(_scrollValue / sb, 0, 1);
        return new Windows.Foundation.Rect(
            _canvas.ActualWidth - ScrollbarGutter + 3, y, ScrollbarGutter - 6, thumbH);
    }

    private CanvasTextFormat TextFormat => _textFormat ??= new CanvasTextFormat
    {
        // DirectWrite 只接受单一族名：XAML 风格逗号回退串整体按无效名处理 →
        // 静默回退默认比例字体（Segoe UI），文本自然步进 ≠ 网格步进，
        // 长 run 逐字符累计漂移（提示符与光标块之间出现数格空隙的根因）。
        // 运行时解析出实际安装的等宽族，保证字形步进 = 字宽度量 = 网格格距。
        FontFamily = ResolveMonoFamily(),
        FontSize = (float)14,
        FontWeight = new Windows.UI.Text.FontWeight(400),
    };

    private static string? _monoFamily;

    /// <summary>
    /// 解析一个实际可用且等宽的字体族（结果缓存）。
    /// DirectWrite 的 FontFamily 只接受单一族名：XAML 风格逗号回退串整体按无效名处理 →
    /// 静默回退默认比例字体（Segoe UI），文本自然步进 ≠ 网格步进，长 run 逐字符累计漂移。
    /// 探针法：等宽族中 'i' 串与 'W' 串布局宽度相等；族名无效回退比例字体时两者不等，
    /// 据此逐候选验证（比枚举字体族名更本质——直接检验渲染出来的步进性质）。
    /// </summary>
    private static string ResolveMonoFamily()
    {
        if (_monoFamily is not null) return _monoFamily;
        var resolved = "Consolas"; // Windows 系统自带等宽，保底
        try
        {
            var device = Microsoft.Graphics.Canvas.CanvasDevice.GetSharedDevice();
            foreach (var candidate in new[] { "Cascadia Mono", "Cascadia Code", "Consolas", "Courier New" })
            {
                using var fmt = new CanvasTextFormat { FontFamily = candidate, FontSize = 14 };
                using var narrow = new CanvasTextLayout(device, new string('i', 16), fmt, 0, 0);
                using var wide = new CanvasTextLayout(device, new string('W', 16), fmt, 0, 0);
                if (Math.Abs(narrow.LayoutBounds.Width - wide.LayoutBounds.Width) < 0.01)
                {
                    resolved = candidate;
                    break;
                }
            }
        }
        catch { /* 设备不可用：Consolas 保底 */ }
        _monoFamily = resolved;
        return resolved;
    }

    /// <summary>实测字符宽/行高（CanvasTextLayout，DIP 坐标；DPI 档位变化才重算）。</summary>
    private void EnsureMetrics(CanvasControl sender)
    {
        var dpiKey = (int)Math.Round(sender.DpiScale * 100);
        if (_metricsDpiKey == dpiKey) return;
        try
        {
            // 请求宽度给足（4096）：约束宽 0 会被 DWrite 按"逐字符换行"排版，
            // LayoutBounds.Width 退化为单字符宽 —— 此前度量恒错，网格永远用默认 9×19 步进
            using var layout = new CanvasTextLayout(sender, new string('X', 32), TextFormat, 4096f, 256f);
            var w = layout.LayoutBounds.Width / 32;
            if (w > 1 && w < 50) _charWidth = w;
            var lineMetrics = layout.LineMetrics;
            if (lineMetrics.Length > 0)
            {
                var h = lineMetrics[0].Height;
                if (h > 4) _lineHeight = h;
            }
            // 成功后才缓存档位：首帧设备未就绪抛异常时，下一帧重试
            _metricsDpiKey = dpiKey;
        }
        catch { /* 设备未就绪：沿用上次度量，下一帧重试 */ }
    }

    private static Windows.UI.Color ToColor(uint rgba) => Windows.UI.Color.FromArgb(
        (byte)(rgba >> 24), (byte)(rgba >> 16), (byte)(rgba >> 8), (byte)rgba);

    // ---- 选区 ----

    private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        Focus(FocusState.Pointer);
        var point = e.GetCurrentPoint(_canvas).Position;

        // 滚动条槽交互优先于选区
        if (point.X >= _canvas.ActualWidth - ScrollbarGutter)
        {
            var thumb = ThumbRect();
            if (thumb.Height > 0 && point.Y >= thumb.Y && point.Y <= thumb.Y + thumb.Height)
            {
                _dragThumb = true;
                _dragGrabOffset = point.Y - thumb.Y;
                _canvas.CapturePointer(e.Pointer);
            }
            else if (Buffer is { ScrollbackCount: > 0 })
            {
                // 轨道点击：向点击方向翻一页
                var page = Math.Max(1, Rows - 2);
                WheelBy(point.Y < thumb.Y ? page : -page);
            }
            e.Handled = true;
            return;
        }

        var cell = CellAt(point);
        _selecting = true;
        _selStart = cell;
        _selEnd = cell;
        _canvas.Invalidate();
        e.Handled = true;
    }

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (_dragThumb)
        {
            DragThumbTo(e.GetCurrentPoint(_canvas).Position.Y);
            e.Handled = true;
            return;
        }
        if (!_selecting) return;
        _selEnd = CellAt(e.GetCurrentPoint(_canvas).Position);
        _canvas.Invalidate();
        e.Handled = true;
    }

    private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (_dragThumb)
        {
            _dragThumb = false;
            _canvas.ReleasePointerCapture(e.Pointer);
            e.Handled = true;
            return;
        }
        if (!_selecting) return;
        _selecting = false;
        _selEnd = CellAt(e.GetCurrentPoint(_canvas).Position);
        SelectionChanged?.Invoke(SelectedText());
        _canvas.Invalidate();
        e.Handled = true;
    }

    /// <summary>拖动 thumb：按 thumb 顶对齐位置映射滚动值。</summary>
    private void DragThumbTo(double y)
    {
        if (Buffer is null || Buffer.ScrollbackCount <= 0) return;
        var thumb = ThumbRect();
        if (thumb.Height <= 0) return;
        var trackTop = 2;
        var trackH = _canvas.ActualHeight - 4;
        var maxThumbY = trackTop + (trackH - thumb.Height);
        var t = (Math.Clamp(y - _dragGrabOffset, trackTop, maxThumbY) - trackTop) / (trackH - thumb.Height);
        _scrollValue = Math.Clamp(t * Buffer.ScrollbackCount, 0, Buffer.ScrollbackCount);
        _canvas.Invalidate();
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
        if (TerminalInputEncoder.IsPrintableKey((int)e.Key))
        {
            var text = TerminalInputEncoder.EncodePrintable((int)e.Key, e.KeyStatus.ScanCode, mods);
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
        WheelBy((int)Math.Round(delta / 120.0 * WheelRowsPerNotch));
        e.Handled = true;
    }

    /// <summary>滚轮滚动 N 格：改滚动值并显式重绘（程序化滚动没有 ScrollBar.Scroll 事件可依赖）。</summary>
    private void WheelBy(int notches)
    {
        if (Buffer is null) return;
        _scrollValue = Math.Clamp(_scrollValue - notches, 0, Buffer.ScrollbackCount);
        _canvas.Invalidate();
    }
}
