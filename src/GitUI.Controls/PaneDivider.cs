using Microsoft.UI.Input;
using GitUI.Core.Resources;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace GitUI.Controls;

/// <summary>
/// 可拖拽的两栏分割条（水平布局，拖动改写左侧列宽）：替代 1px 死分割线。
/// 视觉仍是 1px 竖线（居中于 10px 命中区），悬停显示东西向调整光标；
/// 拖动把左列改为像素宽，右列保持 Star 吸收剩余空间。
/// 位置以比例记忆：<see cref="InitialFraction"/> 启动回放（宿主首次布局时应用），
/// 拖动结束经 <see cref="FractionChanged"/> 上报，宿主持久化到设置。
/// 列实例由宿主传入——页面实例跨导航缓存（??=），拖出的宽度在会话内保持。
/// （基类用 Grid：WinUI 的 Border 是密封类。）
/// </summary>
public sealed class PaneDivider : Grid
{
    public const double MinLeftWidth = 220;   // 左栏最小像素宽
    public const double RightMinWidth = 320;  // 右栏保留的最小像素宽
    private const double GutterWidth = 10;    // 命中区宽度（显式设置：Grid 不设 Width 则为 NaN，
                                              // 所有数值守卫会静默失效）

    private readonly ColumnDefinition _leftColumn;
    private readonly Func<double> _hostWidth;
    private FrameworkElement? _host;  // 拖动坐标基准：宿主 Grid（拖动中不移动）
    private double? _fraction;        // 左栏占宿主宽度的比例；null = 未拖过，保持 star 初始布局
    private bool _initialApplied;     // InitialFraction 只应用一次（此后以拖动/回放为准）
    private bool _dragging;
    private double _dragStartX;
    private double _dragStartLeft;

    /// <summary>启动时的初始比例（来自持久化设置；null = 未调整过）。</summary>
    public double? InitialFraction { get; init; }

    /// <summary>拖动结束（含诊断钩子拖动）后上报最终比例，宿主据此持久化。</summary>
    public event Action<double>? FractionChanged;

    /// <param name="leftColumn">拖动时改写宽度的左列（列定义）。</param>
    /// <param name="hostWidth">宿主 Grid 的实际宽度（计算右栏下限时用）。</param>
    /// <param name="lineBrush">1px 视觉线颜色（传 Ui.Border 等令牌画刷，随主题就地换色）。</param>
    public PaneDivider(ColumnDefinition leftColumn, Func<double> hostWidth, Brush lineBrush)
    {
        _leftColumn = leftColumn;
        _hostWidth = hostWidth;

        Width = GutterWidth;
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent); // 透明但可命中
        Children.Add(new Border
        {
            Width = 1,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Stretch,
            Background = lineBrush,
        });

        PointerPressed += OnPressed;
        PointerMoved += OnMoved;
        PointerReleased += OnReleased;
        PointerEntered += (_, _) => ProtectedCursor = InputSystemCursor.Create(InputSystemCursorShape.SizeWestEast);
        PointerExited += (_, _) => ProtectedCursor = null;
        Loaded += (_, _) => EnsureHost();
        LayoutUpdated += (_, _) => EnsureHost(); // Loaded 在部分挂载路径下不触发：布局帧兜底解析
        AutomationProperties.SetName(this, Strings.Common_PaneDividerAutomation);
    }

    private void OnPressed(object sender, PointerRoutedEventArgs e)
    {
        _host ??= Parent as FrameworkElement;
        _dragging = true;
        // 坐标必须以宿主为基准：分割条自身随拖动平移，若以自身为参照，
        // dx 构成 d_k = p_k − d_{k−1} 的反馈回路 —— 本次只计入最后一步增量、
        // 与上次位移交替正负，表现即拖动抖动/来回跳。
        _dragStartX = e.GetCurrentPoint(_host!).Position.X;
        _dragStartLeft = _leftColumn.ActualWidth;
        CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void OnMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging || _host is null) return;
        var dx = e.GetCurrentPoint(_host).Position.X - _dragStartX;
        var hostW = _host.ActualWidth;
        var maxLeft = Math.Max(MinLeftWidth, _hostWidth() - RightMinWidth - GutterWidth);
        var left = Math.Clamp(_dragStartLeft + dx, MinLeftWidth, maxLeft);
        _leftColumn.Width = new GridLength(left, GridUnitType.Pixel);
        if (hostW > 0)
        {
            _fraction = left / hostW; // 记录比例，供窗口缩放回放
        }
        e.Handled = true;
    }

    private void OnReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return;
        _dragging = false;
        ReleasePointerCapture(e.Pointer);
        if (_fraction is { } f) FractionChanged?.Invoke(f);
        e.Handled = true;
    }

    /// <summary>诊断钩子：程序化执行拖拽逻辑（鼠标注入被环境拦截时验证列宽改写与布局联动）。</summary>
    public void DiagDrag(double dx)
    {
        var hostW = _host?.ActualWidth ?? _hostWidth();
        var maxLeft = Math.Max(MinLeftWidth, _hostWidth() - RightMinWidth - GutterWidth);
        var left = Math.Clamp(_leftColumn.ActualWidth + dx, MinLeftWidth, maxLeft);
        _leftColumn.Width = new GridLength(left, GridUnitType.Pixel);
        if (hostW > 0)
        {
            _fraction = left / hostW;
            FractionChanged?.Invoke(_fraction.Value);
        }
    }

    private void EnsureHost()
    {
        if (_host is not null || Parent is not FrameworkElement fe) return;
        _host = fe;
        fe.SizeChanged += (_, args) => ApplyToWidth(args.NewSize.Width);
        // 立即应用一次：订阅时宿主可能已处于最终尺寸（启动布局先于本控件 Loaded），
        // 若只等 SizeChanged，持久化的 InitialFraction 在无缩放的普通启动下永不生效
        ApplyToWidth(fe.ActualWidth);
    }

    private void ApplyToWidth(double hostWidth)
    {
        if (!_initialApplied)
        {
            // 首次拿到宿主宽度：应用持久化的初始比例（此后 SizeChanged 走回放分支）
            _initialApplied = true;
            if (_fraction is null && InitialFraction is { } f0)
            {
                _fraction = f0;
            }
        }

        if (_fraction is { } f && hostWidth > MinLeftWidth + RightMinWidth + GutterWidth)
        {
            var w = Math.Clamp(f * hostWidth, MinLeftWidth,
                Math.Max(MinLeftWidth, hostWidth - RightMinWidth - GutterWidth));
            _leftColumn.Width = new GridLength(w, GridUnitType.Pixel);
        }
    }
}
