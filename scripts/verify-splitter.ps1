$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
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
public static class CapS {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
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
  Write-Host ("snap: rect $($r.Left),$($r.Top) ${w}x${hh}")
  if ($w -le 0 -or $hh -le 0) { return $null }
  $bmp = New-Object System.Drawing.Bitmap($w, $hh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  return $bmp   # 由调用方 Dispose（返回后还要做像素扫描）
}

# 扫描一行里"两侧相近、与自身差异最大"的 1px 竖线（分割线特征）
function Find-Divider($bmp, $y) {
  if ($null -eq $bmp) { return -1 }
  Write-Host ("fd bmp type: " + $bmp.GetType().FullName); if ($y -lt 0 -or $y -ge $bmp.Height) { Write-Host ("find-divider: y=$y 越界 h=" + $bmp.Height); return -1 }
  $best = -1; $bestScore = -1.0
  $maxX = [Math]::Min(1060, $bmp.Width - 10)
  for ($x = 320; $x -lt $maxX; $x++) {
    $c  = $bmp.GetPixel($x, $y); $cl = $bmp.GetPixel($x - 4, $y); $cr = $bmp.GetPixel($x + 4, $y)
    $b  = $c.R + $c.G + $c.B; $bl = $cl.R + $cl.G + $cl.B; $br = $cr.R + $cr.G + $cr.B
    if ([Math]::Abs($bl - $br) -gt 60) { continue }   # 两侧面板底色应相近
    $score = [Math]::Abs($b - $bl) + [Math]::Abs($b - $br)
    if ($score -gt $bestScore) { $bestScore = $score; $best = $x }
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
  Start-Sleep -Seconds 4
  [CapS]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 1

  $h = [IntPtr]$p.MainWindowHandle
  $r = New-Object CapS+RECT
  [CapS]::GetWindowRect($h, [ref]$r) | Out-Null
  $midY = $r.Top + 400

  $before = Snap('D:\Code\Gitter\diag-splitter-before.png')
  $x0 = Find-Divider $before ($midY - $r.Top)
  $before.Dispose()
  Write-Output ("divider before: window-x=" + $x0)

  # 真实鼠标拖拽 +150px
  [CapS]::SetCursorPos($r.Left + $x0, $midY) | Out-Null
  Start-Sleep -Milliseconds 150
  $down = New-Object CapS+INPUT; $down.type = 0; $down.mi.dwFlags = 0x02
  $null = [CapS]::SendInput(1, @($down), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CapS+INPUT]))
  Start-Sleep -Milliseconds 120
  for ($step = 1; $step -le 15; $step++) {
    [CapS]::SetCursorPos($r.Left + $x0 + $step * 10, $midY) | Out-Null
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep -Milliseconds 150
  $up = New-Object CapS+INPUT; $up.type = 0; $up.mi.dwFlags = 0x04
  $null = [CapS]::SendInput(1, @($up), [System.Runtime.InteropServices.Marshal]::SizeOf([type][CapS+INPUT]))
  Start-Sleep -Milliseconds 400

  $after = Snap('D:\Code\Gitter\diag-splitter-after.png')
  $x1 = Find-Divider $after ($midY - $r.Top)
  $after.Dispose()
  Write-Output ("divider after: window-x=" + $x1)
  Write-Output ("delta=" + ($x1 - $x0) + "  (期望 ~150)")
  if ([Math]::Abs(($x1 - $x0) - 150) -lt 40) { Write-Output 'SPLITTER DRAG OK' } else { Write-Output 'SPLITTER DRAG UNEXPECTED' }
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
