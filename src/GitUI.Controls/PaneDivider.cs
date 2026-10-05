using Microsoft.UI.Input;
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
    private bool _dragging;
    private double _dragStartX;
    private double _dragStartLeft;

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
        AutomationProperties.SetName(this, "调整左右面板宽度");
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
        }
    }

    private void EnsureHost()
    {
        if (_host is not null || Parent is not FrameworkElement fe) return;
        _host = fe;
        fe.SizeChanged += (_, args) =>
        {
            if (_fraction is { } f && args.NewSize.Width > MinLeftWidth + RightMinWidth + GutterWidth)
            {
                _leftColumn.Width = new GridLength(
                    Math.Clamp(f * args.NewSize.Width, MinLeftWidth,
                        Math.Max(MinLeftWidth, args.NewSize.Width - RightMinWidth - GutterWidth)),
                    GridUnitType.Pixel);
            }
        };
    }
}
