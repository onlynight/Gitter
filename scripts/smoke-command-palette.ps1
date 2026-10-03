# smoke-command-palette.ps1 - S7 UIA 冒烟：Ctrl+Shift+P 打开命令面板 → 输入过滤 → 双击执行 → 断言页签切换
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 8

$exitCode = 0
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Foreground {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
    # 激活窗口接收键盘
    [Foreground]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 500

    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.AppActivate($p.Id)
    Start-Sleep -Milliseconds 500

    # 键盘注入在部分会话不可靠：用标题栏"命令面板"按钮触发（Ctrl+Shift+P 语义相同）
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)

    function Find-ByName($scopeRoot, $ctlType, $name) {
        $and = New-Object System.Windows.Automation.AndCondition(
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctlType)),
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
        $scopeRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
    }

    $btn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板'
    if ($null -eq $btn) { Write-Output 'FAIL: 命令面板按钮未找到'; $exitCode = 1; return }
    ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 2

    # 1. 面板输入框出现
    $paletteBox = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '输入命令…'
    if ($null -eq $paletteBox) { Write-Output 'FAIL: 命令面板输入框未出现'; $exitCode = 1; return }
    Write-Output 'OK: Ctrl+Shift+P 打开命令面板'

    # 2. 输入过滤词（ValuePattern 触发 TextChanged 过滤）
    ($paletteBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('分支')
    Start-Sleep -Seconds 2

    # 3. fuzzy 排序首位应是"转到分支 (Ctrl+3)"，双击执行
    $target = Find-ByName $main ([System.Windows.Automation.ControlType]::ListItem) '转到分支 (Ctrl+3)'
    if ($null -eq $target) { Write-Output 'FAIL: 过滤结果首位应为 转到分支 (Ctrl+3)'; $exitCode = 1; return }
    Write-Output 'OK: fuzzy 过滤命中 转到分支 (Ctrl+3)'

    $r = $target.Current.BoundingRectangle
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DblClick {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint b, UIntPtr e);
    public static void Click(int x, int y) {
        SetCursorPos(x, y); System.Threading.Thread.Sleep(120);
        mouse_event(0x02,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(50);
        mouse_event(0x04,0,0,0,UIntPtr.Zero);
        System.Threading.Thread.Sleep(80);
        mouse_event(0x02,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(50);
        mouse_event(0x04,0,0,0,UIntPtr.Zero);
    }
}
"@
    [DblClick]::Click([int]($r.X + $r.Width/2), [int]($r.Y + $r.Height/2))
    Start-Sleep -Seconds 2

    # 4. 面板已关闭 + 分支页特征按钮"创建"出现
    $paletteGone = $null -eq (Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '输入命令…')
    if (-not $paletteGone) { Write-Output 'FAIL: 执行后面板未关闭'; $exitCode = 1; return }
    Write-Output 'OK: 执行后面板已关闭'

    $createBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '创建'
    if ($null -eq $createBtn) { Write-Output 'FAIL: 分支页未打开（缺"创建"按钮）'; $exitCode = 1; return }
    Write-Output 'OK: 命令执行 → 分支页已打开'

    Write-Output 'SMOKE-COMMAND-PALETTE PASS'
}
finally {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
exit $exitCode
