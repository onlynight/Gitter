# diag-parser-feed.ps1 - 记录终端会话的原始输出流（P4 光标偏移诊断）
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
$proj = @{ path = 'D:\Code\Gitter'; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{ currentProjectPath = 'D:\Code\Gitter'; theme = 2; projects = @($proj); terminalShell = 'PowerShell' } | ConvertTo-Json -Depth 4 | Set-Content $settingsPath -Encoding UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CapK {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@

function Find-ByName($root, $type, $name) {
  $c = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
  $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
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
  $invokeCmd = $null
  for ($t = 0; $t -lt 5; $t++) {
    $palBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板'
    if ($null -ne $palBtn) { break }
    Start-Sleep -Seconds 1
  }
  ($palBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 2
  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $cmd = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '转到终端'
  if ($null -eq $cmd) { Write-Output 'FAIL: 转到终端未找到'; return }
  ($cmd.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 4

  # 聚焦并键入 ls（记录这一段的输出流）
  [CapK]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 1
  [System.Windows.Forms.SendKeys]::SendWait('ls')
  Start-Sleep -Seconds 3
  Write-Output 'typed ls; diag feed log at diag-feed.log'
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
