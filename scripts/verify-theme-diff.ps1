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

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CapT {
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
  $h = [IntPtr]$p.MainWindowHandle
  $r = New-Object CapT+RECT
  [CapT]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0) { return $null }
  $bmp = New-Object System.Drawing.Bitmap($w, $hh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  return $bmp
}

# diff 预览区（右栏中部）平均亮度
function Region-Brightness($bmp) {
  if ($null -eq $bmp) { return -1 }
  $sum = 0.0; $n = 0
  for ($x = 620; $x -lt 1040; $x += 6) {
    for ($y = 220; $y -lt 520; $y += 6) {
      $c = $bmp.GetPixel($x, $y)
      $sum += ($c.R + $c.G + $c.B); $n++
    }
  }
  return [Math]::Round($sum / $n, 1)
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

  Invoke-Button $main '转到变更' | Out-Null
  Start-Sleep -Seconds 4
  [CapT]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 1
  # 选中 scratch 文件行（名称含路径）显示 diff
  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $btns = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
  foreach ($b in $btns) {
    if ($b.Current.Name -like '*diag-scratch*') {
      ($b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
      Write-Output ('selected: ' + $b.Current.Name)
      break
    }
  }
  Start-Sleep -Seconds 2

  $b1 = Snap('D:\Code\Gitter\diag-theme-dark.png')
  $v1 = Region-Brightness $b1
  $b1.Dispose()
  Write-Output ("dark  brightness: " + $v1)

  # 命令面板 → 主题：浅色
  Invoke-Button $main '命令面板' | Out-Null
  Start-Sleep -Seconds 2
  Invoke-Button ([System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)) '主题：浅色' | Out-Null
  Start-Sleep -Seconds 2

  $b2 = Snap('D:\Code\Gitter\diag-theme-light.png')
  $v2 = Region-Brightness $b2
  $b2.Dispose()
  Write-Output ("light brightness: " + $v2)

  # 切回深色（双向验证）
  Invoke-Button $main '命令面板' | Out-Null
  Start-Sleep -Seconds 2
  Invoke-Button ([System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)) '主题：深色' | Out-Null
  Start-Sleep -Seconds 2

  $b3 = Snap('D:\Code\Gitter\diag-theme-dark2.png')
  $v3 = Region-Brightness $b3
  $b3.Dispose()
  Write-Output ("dark2 brightness: " + $v3)

  if (($v2 - $v1) -gt 100 -and (($v2 - $v3) -gt 100)) { Write-Output 'THEME FOLLOW OK' } else { Write-Output 'THEME FOLLOW UNEXPECTED' }
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
