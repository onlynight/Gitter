$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
$proj = @{ path = 'D:\Code\Gitter'; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{ currentProjectPath = 'D:\Code\Gitter'; theme = 2; projects = @($proj); terminalShell = 'PowerShell' } | ConvertTo-Json -Depth 4 | Set-Content $settingsPath -Encoding UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CapTT {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

function Find-ByName($root, $type, $name) {
  $c = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
  $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
}

function Invoke-Button($root, $name) {
  for ($t = 0; $t -lt 5; $t++) {
    $btn = Find-ByName $root ([System.Windows.Automation.ControlType]::Button) $name
    if ($null -ne $btn) {
      try { ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke(); return $true } catch { }
    }
    Start-Sleep -Milliseconds 700
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  }
  Write-Output ("FAIL: 按钮未找到: " + $name)
  return $false
}

function Snap($out) {
  try {
    $h = [IntPtr]$p.MainWindowHandle
    [CapTT]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE：最小化窗口 PrintWindow 抓全黑
    [CapTT]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Milliseconds 600
    $r = New-Object CapTT+RECT
    [CapTT]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
    $bmp = New-Object System.Drawing.Bitmap($w, $hh)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    # PrintWindow 对 WinUI3 合成窗口可能返回全黑；无交互桌面访问时 CopyFromScreen 也抛异常
    # ——两种都失败不影响验证：应用内 GITTER_TERM_SNAPSHOT 会用 RenderTargetBitmap 自截图
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("saved " + $out)
  } catch {
    Write-Output ("desktop capture unavailable: " + $_.Exception.Message)
  }
}

try {
  $main = $null
  for ($i = 1; $i -le 8; $i++) {
    Start-Sleep -Seconds 2
    $p.Refresh()
    if ($p.HasExited) { Write-Output 'FAIL: 启动即退出'; return }
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    if ($null -ne (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板')) { break }
  }

  # 经命令面板进终端页
  Invoke-Button $main '命令面板' | Out-Null
  Start-Sleep -Seconds 2
  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  Invoke-Button $main '转到终端' | Out-Null
  Start-Sleep -Seconds 4

  # 聚焦终端并键入：本机 SendKeys 可能被 UIPI/策略拒绝（Win32Exception 拒绝访问），
  # 改用应用内诊断钩子 GITTER_TERM_AUTOTYPE（字节经 WriteRaw → 暂存队列 → 会话回放）
  [CapTT]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 12
  Snap('D:\Code\Gitter\diag-term-typed.png')
  Write-Output 'REPRO DONE'
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
