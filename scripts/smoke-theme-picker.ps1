$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
$proj = @{ path = 'D:\Code\Gitter'; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{ language = 'zh-Hans'; currentProjectPath = 'D:\Code\Gitter'; theme = 2; projects = @($proj) } | ConvertTo-Json -Depth 4 | Set-Content $settingsPath -Encoding UTF8
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
function Invoke-Button($btn) {
  for ($t = 0; $t -lt 5; $t++) {
    try { ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke(); return $true } catch { Start-Sleep -Milliseconds 600 }
  }
  return $false
}
function Alive($label) {
  $p.Refresh()
  if ($p.HasExited) { Write-Output ("FAIL: {0} 后进程退出" -f $label); return $false }
  Write-Output ("OK: {0} 后存活" -f $label)
  return $true
}

try {
  $main = $null
  for ($i = 1; $i -le 8; $i++) {
    Start-Sleep -Seconds 2
    $p.Refresh()
    if ($p.HasExited) { Write-Output 'FAIL: 启动即退出'; return }
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    $palBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板'
    if ($null -ne $palBtn) { break }
  }
  if ($null -eq $palBtn) { Write-Output 'FAIL: 命令面板按钮未找到'; return }
  # 经命令面板切页（单条命令即执行，顺带覆盖面板链路）
  Invoke-Button $palBtn | Out-Null
  Start-Sleep -Seconds 2
  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $pin = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '输入命令…'
  if ($null -eq $pin) { Write-Output 'FAIL: 面板输入框未出现'; return }
  ($pin.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('转到设置')
  Start-Sleep -Seconds 2
  $cmd = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '转到设置'
  if ($null -eq $cmd) { Write-Output 'FAIL: 转到设置命令未找到'; return }
  Invoke-Button $cmd | Out-Null
  $inSettings = $false
  for ($i = 1; $i -le 6; $i++) {
    Start-Sleep -Seconds 2
    $p.Refresh()
    if ($p.HasExited) { Write-Output 'FAIL: 切页时退出'; return }
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    if ($null -ne (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '跟随基座（内置）')) {
      $inSettings = $true
      Write-Output ("OK: 进入设置页（~{0}s）" -f ($i*2))
      break
    }
  }
  if (-not $inSettings) {
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    $btns = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
    $allNames = @()
    foreach ($b in $btns) { $allNames += $b.Current.Name }
    Write-Output ('DEBUG BUTTONS: ' + ($allNames -join ' | '))
    Write-Output 'FAIL: 未能进入设置页'; return
  }

  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $btns = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
  $pkgNames = @()
  foreach ($b in $btns) {
    $n = $b.Current.Name
    if ($n -like '主题包 *') { $pkgNames += $n }
  }
  Write-Output ('OK: 主题包列表 = [' + ($pkgNames -join ' | ') + ']')
  $allNames = @()
  foreach ($b in $btns) { $allNames += $b.Current.Name }
  Write-Output ('ALL BUTTONS: ' + ($allNames -join ' | '))
  # 扩展卡片启停轮询（列表经 DispatcherQueue 延迟填充，且 UIA 快照偶发滞后）
  $extFound = $false
  for ($i = 1; $i -le 8; $i++) {
    Start-Sleep -Seconds 1
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    $extToggles = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        '启用 深色 主题')))
    if ($extToggles.Count -ge 1) { $extFound = $true; break }
  }
  if (-not $extFound) {
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    $all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::CheckBox)))
    $cn = @()
    foreach ($c in $all) { $cn += $c.Current.Name }
    Write-Output ('DEBUG CHECKBOXES: [' + ($cn -join ' | ') + ']')
    Write-Output 'FAIL: 扩展卡片启停未找到'; return
  }
  Write-Output 'OK: 扩展卡片启停存在（启用 深色 主题）'
  if ($pkgNames.Count -lt 2) { Write-Output 'FAIL: 主题包数量不足 2'; return }

  # 选择亮色包
  $lightBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '主题包 亮色'
  if ($null -eq $lightBtn) { Write-Output 'FAIL: 亮色包按钮未找到'; return }
  Invoke-Button $lightBtn | Out-Null
  Start-Sleep -Seconds 2
  if (-not (Alive '应用亮色包')) { return }
  $cfg = (Get-Content $settingsPath -Raw | ConvertFrom-Json)
  if ($cfg.themePackageId -ne 'gitui.theme.light') { Write-Output ('FAIL: themePackageId=' + $cfg.themePackageId); return }
  Write-Output 'OK: themePackageId = gitui.theme.light'

  # 回到跟随基座
  $followBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '跟随基座（内置）'
  if ($null -eq $followBtn) { Write-Output 'FAIL: 跟随基座按钮未找到'; return }
  Invoke-Button $followBtn | Out-Null
  Start-Sleep -Seconds 2
  if (-not (Alive '回到跟随基座')) { return }
  $cfg = (Get-Content $settingsPath -Raw | ConvertFrom-Json)
  if ($cfg.themePackageId) { Write-Output ('FAIL: themePackageId 应为空，实际=' + $cfg.themePackageId); return }
  Write-Output 'OK: themePackageId 已清空（跟随基座）'

  Write-Output 'SETTINGS-THEME PASS'
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
