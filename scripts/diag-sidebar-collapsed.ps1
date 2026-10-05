# diag-sidebar-collapsed.ps1 - 折叠态侧边栏图标布局 UIA 验证：
# 折叠态按钮应为 40 宽（Margin 4+4），居中于 48 导轨；图标列 20px 恰好填满内容槽（无裁切）；
# 展开/折叠切换（CollapseToggle_Click → RefreshNavVisuals）后 margin 双向生效。
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
$repo = 'D:\Code\Gitter'
$proj = @{ path = $repo; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{
    currentProjectPath = $repo; theme = 2; sidebarCollapsed = $true; projects = @($proj)
} | ConvertTo-Json -Depth 4 | Set-Content -Path $settingsPath -Encoding UTF8

Get-Process GitUI.App -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

$p = $null
try {
    $p = Start-Process -FilePath $Exe -PassThru
    Start-Sleep -Seconds 9

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)

    # 客户区原点（UIA BoundingRectangle 基于窗口矩形，Win11 有 ~7px 隐形边框）
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Client {
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    public struct POINT { public int X; public int Y; }
}
"@
    $origin = New-Object Win32Client+POINT
    [Win32Client]::ClientToScreen([IntPtr]$p.MainWindowHandle, [ref]$origin) | Out-Null
    $scale = [Win32Client]::GetDpiForWindow([IntPtr]$p.MainWindowHandle) / 96.0
    Write-Output "DPI scale: $scale"

    function Find-ByName($scopeRoot, $ctlType, $name) {
        $and = New-Object System.Windows.Automation.AndCondition(
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctlType)),
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
        $scopeRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
    }
    function Invoke-Button($btn) {
        ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    }

    # 等 UIA 树就绪
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        $probe = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '终端'
        if ($null -ne $probe) { break }
        Start-Sleep -Milliseconds 500
    }

    $navNames = @('项目', 'Log', '变更', '分支', '终端', '设置')
    $fail = 0
    function Assert-Nav([string]$tag, [double]$expectW, [double]$expectX) {
        foreach ($n in $navNames) {
            $el = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) $n
            if ($null -eq $el) { Write-Output "FAIL[$tag]: $n 未找到"; $script:fail++; continue }
            $r = $el.Current.BoundingRectangle
            $x = $r.X - $origin.X
            if ([Math]::Abs($r.Width - $expectW) -gt 0.5) { Write-Output "FAIL[$tag]: $n 宽度 $($r.Width) 应 $expectW"; $script:fail++ }
            if ([Math]::Abs($x - $expectX) -gt 0.5) { Write-Output "FAIL[$tag]: $n x=$x 应 $expectX"; $script:fail++ }
        }
    }
    function Dump-Nav([string]$tag) {
        Write-Output "--- $tag ---"
        foreach ($n in $navNames) {
            $el = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) $n
            if ($null -eq $el) { Write-Output "  $n : NOT FOUND"; continue }
            $r = $el.Current.BoundingRectangle
            Write-Output ("  {0}: x={1:F1} y={2:F1} w={3:F1} h={4:F1}" -f $n, ($r.X - $origin.X), ($r.Y - $origin.Y), $r.Width, $r.Height)
        }
    }

    Dump-Nav 'collapsed (启动即折叠)'
    Assert-Nav 'collapsed-assert' (40*$scale) (4*$scale)

    # 切换 → 展开态
    $toggle = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '切换侧边栏'
    if ($null -eq $toggle) { Write-Output 'FAIL: 切换侧边栏按钮未找到'; exit 1 }
    Invoke-Button $toggle
    Start-Sleep -Seconds 2
    Dump-Nav 'expanded (点击切换后)'
    # 展开态与折叠态共用 Margin(4,1,4,1)：图标列钉在导轨 x=14，切换零跳变
    Assert-Nav 'expanded-assert' (168*$scale) (4*$scale)

    # 再切回折叠态（回归 CollapseToggle_Click 路径）
    Invoke-Button $toggle
    Start-Sleep -Seconds 2
    Dump-Nav 'collapsed again (再切回)'
    Assert-Nav 'collapsed-again-assert' (40*$scale) (4*$scale)

    if ($fail -gt 0) { Write-Output "DIAG-SIDEBAR FAIL ($fail)"; exit 1 }
    Write-Output 'DIAG-SIDEBAR PASS'
    exit 0
}
finally {
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
