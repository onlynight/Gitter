using GitUI.Core.Models;
using GitUI.Controls.Theme;
using GitUI.Diff.Highlighting;
using GitUI.Core.Settings;
using GitUI.Diff.Render;
using Microsoft.Graphics.Canvas.Text;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Windows.System;

namespace GitUI.Controls;

/// <summary>
/// 自绘 diff 视图（S3，design.md §4.4 / §8-S3）。
/// Win2D <see cref="CanvasControl"/> 即时绘制：只绘可视区 + 上下 overscan 20 行；
/// 行高 18px 固定栅格；行号槽固定不随水平滚动；字级高亮只对可视行惰性计算；
/// 主题（浅/深）切换即时刷新；Alt+↑/↓ 在变更块之间跳转。
/// 纯管线（DiffRenderModel/DiffLayoutEngine）在 GitUI.Diff，可 Headless 测试；
/// 本控件只做事件接线与 Win2D 翻译。
/// </summary>
public sealed class DiffCanvas : Grid
{
    private const double WheelRowsPerNotch = 3;

    private readonly CanvasControl _canvas;
    private readonly ScrollBar _vScroll;
    private readonly ScrollBar _hScroll;

    private IReadOnlyList<DiffHunk>? _hunks;
    private bool _oldEndsWithNewline = true;
    private bool _newEndsWithNewline = true;
    private DiffRenderModel? _model;
    private DiffMetrics _metrics = DiffMetrics.Default;
    private DiffPalette _palette = DiffPalette.Dark;
    private string? _message;
    private int _currentBlock = -1;

    // 语法着色（code-highlight-framework.md P1）
    private string? _sourcePath;
    private ISyntaxHighlighter? _highlighter;
    private SyntaxStyleSet _syntaxStyles;

    private CanvasTextFormat? _textFormat;
    private CanvasTextFormat? _messageFormat;
    private float _textOffsetY;
    private int _metricsDpiKey = -1;

    /// <summary>当前变更块索引变化（状态条可据此显示"变更 N/M"）。</summary>
    public event EventHandler? CurrentChangeChanged;

    /// <summary>用户点击选中 hunk 集合变化（S5 hunk 级暂存 / known-issues 1.5 多选）；参数为当前全部选中序号，空 = 无选中。</summary>
    public event EventHandler<IReadOnlyList<int>>? HunkSelectionChanged;

    private readonly List<int> _selectedHunks = new();

    /// <summary>当前选中的 hunk 序号列表（升序）。空 = 未选中。</summary>
    public IReadOnlyList<int> SelectedHunks => _selectedHunks;

    /// <summary>外部设置选中集合（空清除）；不触发事件。</summary>
    public void SetSelectedHunks(IReadOnlyList<int> hunkIndices)
    {
        _selectedHunks.Clear();
        foreach (var h in hunkIndices)
            if (!_selectedHunks.Contains(h)) _selectedHunks.Add(h);
        _selectedHunks.Sort();
        _canvas.Invalidate();
    }

    public DiffCanvas()
    {
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(12) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });

        _canvas = new CanvasControl();
        _canvas.Draw += OnDraw;
        _canvas.SizeChanged += (_, _) =>
        {
            UpdateScrollRanges();
            _canvas.Invalidate();
        };
        _canvas.PointerPressed += OnCanvasPointerPressed;
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

        _hScroll = new ScrollBar
        {
            Orientation = Orientation.Horizontal,
            Minimum = 0,
            Maximum = 0,
        };
        _hScroll.Scroll += (_, _) => _canvas.Invalidate();
        Grid.SetRow(_hScroll, 1);
        Grid.SetColumn(_hScroll, 0);
        Children.Add(_hScroll);

        IsTabStop = true;
        UseSystemFocusVisuals = false;
        KeyDown += OnKeyDown;
        // WinUI 3 投影没有可重写的 OnPointerWheelChanged，用事件订阅
        PointerWheelChanged += OnWheelChanged;
        ActualThemeChanged += (_, _) =>
        {
            _palette = ResolvePalette();
            _syntaxStyles = BuildSyntaxStyles();
            _canvas.Invalidate();
        };
        ThemeService.Applied += _ =>
        {
            // 主题包切换（含暗↔亮与第三方包）→ 语法配色随主题重载
            _syntaxStyles = BuildSyntaxStyles();
            _canvas.Invalidate();
        };
        HighlighterRegistry.Changed += () =>
        {
            // 扩展包启停/导入/卸载 → 重解析当前源文件的高亮器
            _highlighter = _sourcePath is null ? null : HighlighterRegistry.Resolve(_sourcePath);
            _canvas.Invalidate();
        };

        BuildAccelerators();
        _palette = ResolvePalette();
        _syntaxStyles = BuildSyntaxStyles();
        AutomationProperties.SetName(this, "Diff 视图");
    }

    private DiffViewMode _mode = DiffViewMode.SideBySide;

    /// <summary>并排 / 内联。切换会重建行模型（滚动位置按行夹紧保留）。</summary>
    public DiffViewMode Mode
    {
        get => _mode;
        set
        {
            if (_mode == value) return;
            _mode = value;
            if (_hunks is not null) RebuildModel(resetScroll: false);
        }
    }

    /// <summary>
    /// 源文件路径：按扩展名解析语法高亮器（code-highlight-framework.md P1）。
    /// Load 前设置；null/无匹配语言 → 不着色。
    /// </summary>
    public string? SourcePath
    {
        get => _sourcePath;
        set
        {
            if (_sourcePath == value) return;
            _sourcePath = value;
            _highlighter = value is null ? null : HighlighterRegistry.Resolve(value);
            _canvas.Invalidate();
        }
    }

    /// <summary>空态/占位文案（二进制、大文件、无差异等）。Load 后自动清空。</summary>
    public string? Message
    {
        get => _message;
        set
        {
            _message = value;
            _canvas.Invalidate();
        }
    }

    public int ChangeCount => _model?.ChangeBlocks.Count ?? 0;

    public int CurrentChangeIndex => _currentBlock;

    /// <summary>载入 diff。<paramref name="oldEndsWithNewline"/>/<paramref name="newEndsWithNewline"/>
    /// 来自 TextDiffPipeline（渲染 git 的 "\ No newline at end of file" 标记）。</summary>
    public void Load(IReadOnlyList<DiffHunk> hunks, bool oldEndsWithNewline = true, bool newEndsWithNewline = true)
    {
        _hunks = hunks ?? throw new ArgumentNullException(nameof(hunks));
        _oldEndsWithNewline = oldEndsWithNewline;
        _newEndsWithNewline = newEndsWithNewline;
        _selectedHunks.Clear();
        RebuildModel(resetScroll: true);
    }

    /// <summary>清空视图并显示占位文案。</summary>
    public void Clear(string? message = null)
    {
        _hunks = null;
        _model = null;
        _message = message ?? string.Empty;
        _currentBlock = -1;
        _selectedHunks.Clear();
        _vScroll.Maximum = 0;
        _hScroll.Maximum = 0;
        _canvas.Invalidate();
    }

    /// <summary>
    /// 点击画布：定位到行 → 所属 hunk，更新选中态并触发 <see cref="HunkSelectionChanged"/>。
    /// 普通点击替换单选；Ctrl+点击 toggle 多选（known-issues 1.5）；
    /// 点在空白区（超出内容行数）时普通点击清除选择、Ctrl 点击保持。
    /// </summary>
    private void OnCanvasPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        Focus(FocusState.Pointer);
        if (_model is null || _model.Rows.Count == 0) return;

        var point = e.GetCurrentPoint(_canvas).Position.Y;
        int firstRow = (int)Math.Round(_vScroll.Value);
        int row = firstRow + (int)(point / _metrics.LineHeight);

        int? hunk = _model.TryGetHunkIndexAtRow(row);
        var ctrl = e.KeyModifiers.HasFlag(VirtualKeyModifiers.Control);
        var before = _selectedHunks.ToArray();

        if (hunk is null)
        {
            if (!ctrl && _selectedHunks.Count > 0)
                _selectedHunks.Clear();
        }
        else if (ctrl)
        {
            if (!_selectedHunks.Remove(hunk.Value))
                _selectedHunks.Add(hunk.Value);
            _selectedHunks.Sort();
        }
        else
        {
            if (_selectedHunks.Count != 1 || _selectedHunks[0] != hunk.Value)
            {
                _selectedHunks.Clear();
                _selectedHunks.Add(hunk.Value);
            }
        }

        if (!_selectedHunks.SequenceEqual(before))
        {
            HunkSelectionChanged?.Invoke(this, _selectedHunks);
            _canvas.Invalidate();
        }
        e.Handled = false; // 不吞掉事件：外部仍可感知按下（如滚动条交互不受影响）
    }

    /// <summary>跳到下一个变更块（已到最后则停在原地）。</summary>
    public void NextChange()
    {
        var blocks = _model?.ChangeBlocks;
        if (blocks is null || blocks.Count == 0) return;

        var target = Math.Min(_currentBlock + 1, blocks.Count - 1);
        if (target == _currentBlock) return;
        _currentBlock = target;
        ScrollBlockIntoView(blocks[_currentBlock]);
        CurrentChangeChanged?.Invoke(this, EventArgs.Empty);
        _canvas.Invalidate();
    }

    /// <summary>跳到上一个变更块（未定位过时跳到第一个）。</summary>
    public void PrevChange()
    {
        var blocks = _model?.ChangeBlocks;
        if (blocks is null || blocks.Count == 0) return;

        var target = _currentBlock < 0 ? blocks.Count - 1 : Math.Max(_currentBlock - 1, 0);
        if (target == _currentBlock && _currentBlock >= 0) return;
        _currentBlock = target;
        ScrollBlockIntoView(blocks[_currentBlock]);
        CurrentChangeChanged?.Invoke(this, EventArgs.Empty);
        _canvas.Invalidate();
    }

    private void RebuildModel(bool resetScroll)
    {
        _message = null;
        _model = new DiffRenderModel(_hunks!, _oldEndsWithNewline, _newEndsWithNewline, sideBySide: _mode == DiffViewMode.SideBySide);
        if (resetScroll) _currentBlock = -1;
        UpdateScrollRanges();
        if (resetScroll) _vScroll.Value = 0;
        _hScroll.Value = Math.Min(_hScroll.Value, _hScroll.Maximum);
        _canvas.Invalidate();
    }

    private void ScrollBlockIntoView(DiffChangeBlock block)
    {
        int visible = VisibleRowCount();
        int first = (int)Math.Round(_vScroll.Value);

        if (block.LastRow < first)
            _vScroll.Value = block.FirstRow;
        else if (block.FirstRow > first + visible - 1)
            _vScroll.Value = Math.Max(0, block.FirstRow - visible / 3);
    }

    private int VisibleRowCount() => Math.Max(1, (int)(_canvas.ActualHeight / _metrics.LineHeight));

    private void UpdateScrollRanges()
    {
        int rows = _model?.Rows.Count ?? 0;
        double visible = VisibleRowCount();
        _vScroll.Maximum = Math.Max(0, rows - 1);
        _vScroll.ViewportSize = visible;
        _vScroll.LargeChange = visible;

        double maxCols = _model?.MaxTextColumns ?? 0;
        double contentWidth = maxCols * _metrics.CharWidth;
        double colWidth = ColumnWidthForScroll();
        _hScroll.Maximum = Math.Max(0, contentWidth - colWidth + _metrics.CharWidth);
        _hScroll.ViewportSize = Math.Max(1, colWidth);
        _hScroll.LargeChange = Math.Max(1, colWidth - _metrics.CharWidth);
        _hScroll.Value = Math.Min(_hScroll.Value, _hScroll.Maximum);
    }

    /// <summary>单列可视宽度（水平滚动范围用）：并排 = 两列均分；内联 = 减去行号槽。</summary>
    private double ColumnWidthForScroll()
    {
        double w = _canvas.ActualWidth;
        if (double.IsNaN(w) || w <= 0) return 1;

        int digitsOld = DiffLayoutEngine.Digits(_model?.MaxOldNumber ?? 0);
        int digitsNew = DiffLayoutEngine.Digits(_model?.MaxNewNumber ?? 0);
        double pad = _metrics.GutterPadding;

        if (_mode == DiffViewMode.SideBySide)
        {
            double gutters = digitsOld * _metrics.CharWidth + pad * 2 + digitsNew * _metrics.CharWidth + pad * 2;
            return Math.Max(1, (w - gutters) / 2);
        }

        double gutterSum = (digitsOld + digitsNew) * _metrics.CharWidth + pad * 4;
        return Math.Max(1, w - gutterSum);
    }

    private void OnWheelChanged(object sender, PointerRoutedEventArgs e)
    {
        var delta = e.GetCurrentPoint(this).Properties.MouseWheelDelta;
        _vScroll.Value -= delta / 120.0 * WheelRowsPerNotch;
        e.Handled = true;
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Up: _vScroll.Value -= 1; break;
            case VirtualKey.Down: _vScroll.Value += 1; break;
            case VirtualKey.PageUp: _vScroll.Value -= _vScroll.LargeChange; break;
            case VirtualKey.PageDown: _vScroll.Value += _vScroll.LargeChange; break;
            case VirtualKey.Home: _vScroll.Value = 0; break;
            case VirtualKey.End: _vScroll.Value = _vScroll.Maximum; break;
            case VirtualKey.Left: _hScroll.Value -= 8 * _metrics.CharWidth; break;
            case VirtualKey.Right: _hScroll.Value += 8 * _metrics.CharWidth; break;
            default: return;
        }

        e.Handled = true;
    }

    private void BuildAccelerators()
    {
        var altDown = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Menu, Key = VirtualKey.Down };
        altDown.Invoked += (_, args) => { NextChange(); args.Handled = true; };
        KeyboardAccelerators.Add(altDown);

        var altUp = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Menu, Key = VirtualKey.Up };
        altUp.Invoked += (_, args) => { PrevChange(); args.Handled = true; };
        KeyboardAccelerators.Add(altUp);
    }

    private DiffPalette ResolvePalette()
    {
        // 主题包 diff 段覆盖：克隆内置深/浅色板后应用（不污染静态单例）
        var palette = (ActualTheme == ElementTheme.Light ? DiffPalette.Light : DiffPalette.Dark).Clone();
        palette.ApplyOverrides(ThemeService.ActiveDiff);
        return palette;
    }

    /// <summary>活动主题语法配色 → 样式集（ThemeService.ActiveSyntax 覆盖内置缺省）。</summary>
    private SyntaxStyleSet BuildSyntaxStyles()
    {
        var set = new SyntaxStyleSet(ActualTheme == ElementTheme.Light);
        set.ApplyOverrides(ThemeService.ActiveSyntax);
        return set;
    }

    private void OnDraw(CanvasControl sender, CanvasDrawEventArgs args)
    {
        EnsureTextFormat();
        EnsureFontMetrics(sender);
        var session = args.DrawingSession;
        session.Clear(ToWinColor(_palette[DiffColorKind.Background]));

        if (_model is null || _model.Rows.Count == 0)
        {
            if (!string.IsNullOrEmpty(_message))
            {
                session.DrawText(_message, 0, 0,
                    (float)sender.ActualWidth, (float)sender.ActualHeight,
                    ToWinColor(_palette[DiffColorKind.MutedForeground]), MessageFormat);
            }

            return;
        }

        var viewport = new DiffViewport(
            sender.ActualWidth,
            sender.ActualHeight,
            (int)Math.Round(_vScroll.Value),
            _hScroll.Value,
            _currentBlock >= 0 && _currentBlock < _model.ChangeBlocks.Count
                ? _model.ChangeBlocks[_currentBlock]
                : null);

        var (_, from, last) = DiffLayoutEngine.VisibleRange(_model.Rows.Count, _metrics, viewport);
        _model.EnsureWordDiff(from, last);
        _model.EnsureSyntaxTokens(from, last, _highlighter);

        var frame = DiffLayoutEngine.Layout(_model, sideBySide: _mode == DiffViewMode.SideBySide, _metrics, viewport,
            _syntaxStyles);
        foreach (var cmd in frame.Commands)
        {
            switch (cmd)
            {
                case FillRectCommand f:
                    session.FillRectangle(
                        (float)f.X, (float)f.Y, (float)f.Width, (float)f.Height,
                        ToWinColor(_palette[f.Color]));
                    break;
                case TextCommand t:
                    session.DrawText(
                        t.Text, (float)t.X, (float)(t.Y + _textOffsetY),
                        ToWinColor(_palette[t.Color]), _textFormat);
                    break;
            }
        }

        DrawHunkSelectionOverlay(session, sender, viewport);
    }

    /// <summary>选中 hunk 的半透明覆盖层（S5 选块反馈，known-issues 1.5 起支持多块），与滚动同步。</summary>
    private void DrawHunkSelectionOverlay(
        Microsoft.Graphics.Canvas.CanvasDrawingSession session, CanvasControl sender, DiffViewport viewport)
    {
        if (_model is null || _selectedHunks.Count == 0) return;

        var overlay = ActualTheme == ElementTheme.Light
            ? Windows.UI.Color.FromArgb(0x26, 0x00, 0x60, 0xD0)
            : Windows.UI.Color.FromArgb(0x38, 0x60, 0xB8, 0xFF);
        int firstRow = (int)Math.Round(_vScroll.Value);

        foreach (var hunk in _selectedHunks)
        {
            var range = _model.TryGetHunkRowRange(hunk);
            if (range is null) continue;

            double y = (range.FirstRow - firstRow) * _metrics.LineHeight;
            double height = (range.LastRow - range.FirstRow + 1) * _metrics.LineHeight;
            if (y >= sender.ActualHeight || y + height <= 0) continue;

            session.FillRectangle(
                0, (float)Math.Max(0, y),
                (float)sender.ActualWidth, (float)Math.Min(height, sender.ActualHeight - Math.Max(0, y)),
                overlay);
        }
    }

    private CanvasTextFormat TextFormat => _textFormat ??= new CanvasTextFormat
    {
        FontFamily = "Cascadia Mono, Consolas, Segoe UI Mono",
        FontSize = (float)_metrics.FontSize,
        FontWeight = new Windows.UI.Text.FontWeight(400),
    };

    private CanvasTextFormat MessageFormat => _messageFormat ??= new CanvasTextFormat
    {
        FontSize = (float)_metrics.FontSize,
        HorizontalAlignment = CanvasHorizontalAlignment.Center,
        VerticalAlignment = CanvasVerticalAlignment.Center,
    };

    /// <summary>
    /// 实测等宽字符步进与垂直居中偏移（design.md §4.7.4 同源思路：用文本布局度量，不用 ActualWidth）。
    /// DIP 坐标系下度量与 DPI 无关，仅 DPI 档位变化时重算一次。
    /// </summary>
    private void EnsureFontMetrics(CanvasControl sender)
    {
        int dpiKey = (int)Math.Round(sender.DpiScale * 100);
        if (_metricsDpiKey == dpiKey) return;

        _metricsDpiKey = dpiKey;
        using var layout = new CanvasTextLayout(sender, new string('X', 32), TextFormat, 0, 0);
        double charWidth = layout.LayoutBounds.Width / 32;
        if (charWidth > 0.5 && Math.Abs(charWidth - _metrics.CharWidth) > 0.01)
            _metrics = _metrics with { CharWidth = charWidth };

        var lines = layout.LineMetrics;
        double naturalLineHeight = lines.Length > 0 ? lines[0].Height : _metrics.FontSize * 1.33;
        _textOffsetY = (float)((_metrics.LineHeight - naturalLineHeight) / 2);
        UpdateScrollRanges();
    }

    private void EnsureTextFormat()
    {
        if (_textFormat is null)
        {
            _ = TextFormat;
        }
    }

    private static Windows.UI.Color ToWinColor(RgbaColor c) => Windows.UI.Color.FromArgb(c.A, c.R, c.G, c.B);
}
