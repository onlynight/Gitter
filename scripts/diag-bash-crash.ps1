# diag-bash-crash.ps1 - 复现 Git Bash 页崩溃：切页 → 会话启动 → 输出 → 键入 → resize 各步检查存活
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe',
    [string]$RepoPath = 'D:\Code\Gitter'
)

$ErrorActionPreference = 'Continue'
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BC {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint b, UIntPtr e);
    [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    public static void Click(int x, int y) {
        SetCursorPos(x, y); System.Threading.Thread.Sleep(150);
        mouse_event(0x02,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(60);
        mouse_event(0x04,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(200);
    }
}
"@
Add-Type -AssemblyName System.Windows.Forms

$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 8

function Check([string]$step) {
    $p.Refresh()
    $alive = -not $p.HasExited
    Write-Output ("[{0}] alive={1}" -f $step, $alive)
    if (-not $alive) {
        Write-Output ("CRASH at: " + $step)
        # 最近的 WER / 应用程序错误
        Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-3)} -MaxEvents 10 -ErrorAction SilentlyContinue |
            Where-Object { $_.ProviderName -match 'Application Error|Windows Error|.NET' } |
            ForEach-Object { Write-Output ($_.Message.Substring(0, [Math]::Min(500, $_.Message.Length))) }
        exit 1
    }
}

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    function Find-ByName($scopeRoot, $ctlType, $name) {
        $and = New-Object System.Windows.Automation.AndCondition(
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctlType)),
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
        $scopeRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
    }
    function Invoke-Button($btn) {
        ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    }

    # 1. 切 Git Bash 页
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) 'Git Bash')
    Start-Sleep -Seconds 4
    Check 'switch-to-bash'

    # 2. 等 shell 输出
    Start-Sleep -Seconds 4
    Check 'after-session-output'

    # 3. 点击画布聚焦
    $canvas = Find-ByName $main ([System.Windows.Automation.ControlType]::Custom) '终端输出区'
    if ($null -eq $canvas) { $canvas = Find-ByName $main ([System.Windows.Automation.ControlType]::Pane) '终端输出区' }
    if ($null -ne $canvas) {
        $r = $canvas.Current.BoundingRectangle
        [BC]::Click([int]($r.X + $r.Width/2), [int]($r.Y + $r.Height/2))
        Start-Sleep -Seconds 1
    }
    Check 'after-canvas-click'

    # 4. 键入命令（聚焦画布后 SendKeys 逐字符）
    [BC]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait('echo ALIVE123')
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Seconds 2
    Check 'after-typing'

    # 5. resize 窗口（触发 PTY resize）
    $p.Refresh()
    if (-not $p.HasExited) {
        # 通过 ShowWindow API 改变窗口大小
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Win {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
        [Win]::MoveWindow($p.MainWindowHandle, 100, 100, 800, 500, $true)
        Start-Sleep -Seconds 2
        [Win]::MoveWindow($p.MainWindowHandle, 100, 100, 1280, 800, $true)
        Start-Sleep -Seconds 2
    }
    Check 'after-resize'

    # 6. 切走再切回（页签缓存路径）
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) 'Log')
    Start-Sleep -Seconds 2
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) 'Git Bash')
    Start-Sleep -Seconds 2
    Check 'switch-away-and-back'

    Write-Output 'DIAG-NO-CRASH'
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
