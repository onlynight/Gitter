
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
$proj = @{ path = 'D:\Code\Gitter'; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{ currentProjectPath = 'D:\Code\Gitter'; theme = 2; projects = @($proj); terminalShell = 'PowerShell' } | ConvertTo-Json -Depth 4 | Set-Content $settingsPath -Encoding UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

function Find-ByName($root, $type, $name) {
  $c = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
  $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
}
function Alive($label) {
  $p.Refresh()
  if ($p.HasExited) { Write-Output ("FAIL: {0} 后进程退出" -f $label); return $false }
  Write-Output ("OK: {0} 后存活" -f $label)
  return $true
}
function Select-Shell($main, $shellName) {
  # 组合框展开 → 列表项选择 → 收起
  $combo = Find-ByName $main ([System.Windows.Automation.ControlType]::ComboBox) '终端 Shell 选择'
  if ($null -eq $combo) { Write-Output 'FAIL: shell 组合框未找到'; return $false }
  try { ($combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Expand() } catch { }
  Start-Sleep -Milliseconds 800
  $item = $null
  for ($i = 0; $i -lt 5 -and $null -eq $item; $i++) {
    $items = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem)))
    foreach ($it in $items) {
      if ($it.Current.Name -eq $shellName) { $item = $it; break }
    }
    if ($null -eq $item) { Start-Sleep -Milliseconds 500 }
  }
  if ($null -eq $item) { Write-Output ('FAIL: 列表项未找到: ' + $shellName); return $false }
  ($item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
  Start-Sleep -Seconds 2
  return $true
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

  # 经命令面板进入终端页
  $palBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板'
  if ($null -eq $palBtn) { Write-Output 'FAIL: 命令面板按钮未找到'; return }
  ($palBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 2
  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $cmd = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '转到终端'
  if ($null -eq $cmd) { Write-Output 'FAIL: 转到终端命令未找到'; return }
  ($cmd.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 3
  if (-not (Alive '进入终端页')) { return }

  # 依序切 PowerShell → CMD → Git Bash → PowerShell（每步验证存活）
  foreach ($shell in @('CMD', 'Git Bash', 'PowerShell')) {
    if (-not (Select-Shell $main $shell)) { return }
    if (-not (Alive ("切到 " + $shell))) { return }
    $p.Refresh()
  }

  Start-Sleep -Seconds 3
  if (-not (Alive '全部切换完成 3s 后')) { return }

  $cfg = (Get-Content $settingsPath -Raw | ConvertFrom-Json)
  if ($cfg.terminalShell -ne 'PowerShell') { Write-Output ('FAIL: terminalShell=' + $cfg.terminalShell); return }
  Write-Output 'OK: terminalShell 持久化正确'
  Write-Output 'TERMINAL-SHELL-SWITCH PASS'
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
