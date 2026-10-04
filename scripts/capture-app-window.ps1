# capture-app-window.ps1 - launch app and capture main window PNG (PrintWindow)
# Writes settings first so the Log page loads a repo (real toolbar visible).
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe',
    [string]$Out = 'D:\Code\Gitter\diag-out.png',
    [string]$RepoPath = 'D:\Code\Gitter',
    [int]$Theme = 2
)
Get-Process GitUI.App -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

$dir = Join-Path $env:APPDATA 'GitUI'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$settingsPath = Join-Path $dir 'settings.json'
if ($RepoPath -eq '') {
    Remove-Item $settingsPath -Force -ErrorAction SilentlyContinue
} else {
    $proj = @{
        path = $RepoPath
        name = Split-Path $RepoPath -Leaf
        addedAt = (Get-Date).ToString('o')
        lastOpenedAt = (Get-Date).ToString('o')
    }
    @{ currentProjectPath = $RepoPath; theme = $Theme; projects = @($proj) } |
        ConvertTo-Json -Depth 4 | Set-Content -Path $settingsPath -Encoding UTF8
}

Add-Type -AssemblyName System.Drawing

$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 9

try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Cap {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
    $hWnd = [IntPtr]$p.MainWindowHandle
    [Win32Cap]::ShowWindow($hWnd, 3) | Out-Null
    [Win32Cap]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Seconds 6

    $rect = New-Object Win32Cap+RECT
    [Win32Cap]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    Write-Output "Window: $($rect.Left),$($rect.Top) ${w}x${h}"

    if ($w -le 0 -or $h -le 0) { Write-Output 'ERROR: invalid window rect'; return }

    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
        Write-Output "CopyFromScreen done"
    } catch {
        # 屏幕锁定/无桌面时回退 PrintWindow（锁定下可能为黑帧，仅供窗口存在性验证）
        $hdc = $g.GetHdc()
        [Win32Cap]::PrintWindow($hWnd, $hdc, 2) | Out-Null
        $g.ReleaseHdc($hdc)
        Write-Output "PrintWindow fallback used"
    }
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "Saved: $Out"
}
finally {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Get-Process GitUI.App -ErrorAction SilentlyContinue | Stop-Process -Force
}
