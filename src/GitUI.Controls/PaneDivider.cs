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

    private readonly ColumnDefinition _leftColumn;
    private readonly Func<double> _hostWidth;
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
        AutomationProperties.SetName(this, "调整左右面板宽度");
    }

    private void OnPressed(object sender, PointerRoutedEventArgs e)
    {
        _dragging = true;
        _dragStartX = e.GetCurrentPoint(this).Position.X;
        _dragStartLeft = _leftColumn.ActualWidth;
        CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void OnMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return;
        var dx = e.GetCurrentPoint(this).Position.X - _dragStartX;
        var maxLeft = Math.Max(MinLeftWidth, _hostWidth() - RightMinWidth - Width);
        var left = Math.Clamp(_dragStartLeft + dx, MinLeftWidth, maxLeft);
        _leftColumn.Width = new GridLength(left, GridUnitType.Pixel);
        e.Handled = true;
    }

    private void OnReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return;
        _dragging = false;
        ReleasePointerCapture(e.Pointer);
        e.Handled = true;
    }

    /// <summary>诊断钩子：程序化执行拖拽逻辑（验证列宽改写与布局联动，绕过鼠标注入）。</summary>
    public void DiagDrag(double dx)
    {
        var maxLeft = Math.Max(MinLeftWidth, _hostWidth() - RightMinWidth - Width);
        _leftColumn.Width = new GridLength(
            Math.Clamp(_leftColumn.ActualWidth + dx, MinLeftWidth, maxLeft), GridUnitType.Pixel);
    }
}
