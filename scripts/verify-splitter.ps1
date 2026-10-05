$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
$proj = @{ path = 'D:\Code\Gitter'; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{ currentProjectPath = 'D:\Code\Gitter'; theme = 2; projects = @($proj) } | ConvertTo-Json -Depth 4 | Set-Content $settingsPath -Encoding UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CapS {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
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
  $r = New-Object CapS+RECT
  [CapS]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0) { return $null }
  $bmp = New-Object System.Drawing.Bitmap($w, $hh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  return $bmp   # 由调用方 Dispose（返回后还要做像素扫描）
}

# 扫描分割线（多行一致性）：真分割线贯穿内容区全高，在所有采样行都有同样的
# 1px 亮暗特征；提交列表的时间轴竖线/文字边缘会被行间隙与分组打断而被过滤
function Find-Divider($bmp, $yMid) {
  if ($null -eq $bmp) { return -1 }
  $maxX = [Math]::Min(1060, $bmp.Width - 10)
  $rows = @([int]($yMid * 0.7), $yMid, [int][Math]::Min($bmp.Height - 30, $yMid * 1.3))
  $best = -1; $bestMin = -1.0
  for ($x = 320; $x -lt $maxX; $x++) {
    $minScore = 1e9; $ok = $true
    foreach ($y in $rows) {
      if ($y -lt 2 -or $y -ge $bmp.Height - 2) { $ok = $false; break }
      $c  = $bmp.GetPixel($x, $y); $cl = $bmp.GetPixel($x - 4, $y); $cr = $bmp.GetPixel($x + 4, $y)
      $b  = $c.R + $c.G + $c.B; $bl = $cl.R + $cl.G + $cl.B; $br = $cr.R + $cr.G + $cr.B
      if ([Math]::Abs($bl - $br) -gt 60) { $ok = $false; break }
      $score = [Math]::Abs($b - $bl) + [Math]::Abs($b - $br)
      if ($score -lt $minScore) { $minScore = $score }
    }
    if ($ok -and $minScore -gt $bestMin) { $bestMin = $minScore; $best = $x }
  }
  return $best
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

  Invoke-Button $main '转到 Log' | Out-Null
  Start-Sleep -Seconds 12   # 钩子在页面 ctor+6s 程序化拖动（+150px）

  $h = [IntPtr]$p.MainWindowHandle
  $r = New-Object CapS+RECT
  [CapS]::GetWindowRect($h, [ref]$r) | Out-Null
  $midY = $r.Top + 400

  $after = Snap('D:\Code\Gitter\diag-splitter-after.png')
  $x1 = Find-Divider $after ($midY - $r.Top)
  $after.Dispose()
  Write-Output ("divider after drag: window-x=" + $x1)
  if ($x1 -lt 0) { Write-Output 'FAIL: 未定位到分割线'; return }

  # 窗口缩放（SetWindowPos 非输入注入）：拖动记录的左栏比例应在缩放后回放
  # 缩到 1100 宽并移到 x=100：不越过监视器 DPI 边界，排除跨屏 DPI 干扰
  [CapS]::SetWindowPos($h, [IntPtr]::Zero, 100, 100, 1100, 700, 0x0004) | Out-Null
  Start-Sleep -Seconds 3

  $r2 = New-Object CapS+RECT
  [CapS]::GetWindowRect($h, [ref]$r2) | Out-Null
  $resized = Snap('D:\Code\Gitter\diag-splitter-resized.png')
  $x2 = Find-Divider $resized ($midY - $r2.Top)
  $resized.Dispose()
  Write-Output ("divider after resize: window-x=" + $x2)

  # 像素级断言：左栏新宽度 = 拖动后宽度 × host 增长比（host = 窗口宽 - 侧边栏等 192）
  if ($x2 -lt 0) { Write-Output 'FAIL: 缩放后未定位到分割线'; return }
  $host1 = ($r.Right - $r.Left) - 192
  $host2 = ($r2.Right - $r2.Left) - 192
  $leftCol = $x1 - 196   # 191 侧边栏 + 5 时间轴边距
  $expect = [Math]::Round(196 + $leftCol * $host2 / $host1)
  Write-Output ("expect ~" + $expect + " (leftCol " + $leftCol + ", host " + $host1 + "→" + $host2 + ")")
  if ([Math]::Abs($x2 - $expect) -le 10) { Write-Output 'FRACTION REPLAY OK' } else { Write-Output 'FRACTION REPLAY UNEXPECTED' }
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
}
