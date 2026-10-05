$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
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
public static class CapK2 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

function Find-ByName($root, $type, $name) {
  $c = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
  $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
}

function Snap($out) {
  try {
    $h = [IntPtr]$p.MainWindowHandle
    $r = New-Object CapK2+RECT
    [CapK2]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
    $bmp = New-Object System.Drawing.Bitmap($w, $hh)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("saved " + $out)
  } catch { Write-Output ("capture failed: " + $_.Exception.Message) }
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
  $palBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板'
  if ($null -eq $palBtn) { Write-Output 'FAIL: 命令面板按钮未找到'; return }
  ($palBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 2
  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $cmd = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '转到终端'
  if ($null -eq $cmd) { Write-Output 'FAIL: 转到终端未找到'; return }
  ($cmd.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 10

  # 真实键盘路径：SendKeys 走 OnKeyDown → IsPrintableKey → ToUnicode
  [CapK2]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 1
  try {
    [System.Windows.Forms.SendKeys]::SendWait('ls -al .')
    Write-Output 'SendKeys OK'
  } catch { Write-Output ('SendKeys DENIED: ' + $_.Exception.Message); return }
  Start-Sleep -Seconds 2
  Snap('D:\Code\Gitter\diag-keys-typed.png')

  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Seconds 3
  Snap('D:\Code\Gitter\diag-keys-executed.png')
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
