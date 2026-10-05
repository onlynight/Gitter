# smoke-branches-page.ps1 - S6 UIA 冒烟：分支页打开仓库 → 树显示 → 检出 → 删除确认对话框（N 值一致）→ 删除
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

# ---- 临时仓库：main 2 提交 + feature 1 个独有提交 ----
$repo = Join-Path $env:TEMP ("gitui-brsmoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $repo | Out-Null
function Invoke-Git($dir, [string[]]$gitArgs) {
    $out = & git -C $dir @gitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $gitArgs failed: $out" }
    return $out
}
Invoke-Git $repo @('init', '-q', '-b', 'main', '.')
Invoke-Git $repo @('config', 'core.autocrlf', 'false')
Invoke-Git $repo @('config', 'user.name', 'smoke')
Invoke-Git $repo @('config', 'user.email', 'smoke@test')
[System.IO.File]::WriteAllText((Join-Path $repo 'a.txt'), "1`n")
Invoke-Git $repo @('add', '.')
Invoke-Git $repo @('commit', '-q', '-m', 'base')
Invoke-Git $repo @('branch', 'feature')
[System.IO.File]::WriteAllText((Join-Path $repo 'a.txt'), "2`n")
Invoke-Git $repo @('commit', '-q', '-am', 'main-2')
Invoke-Git $repo @('checkout', '-q', 'feature')
[System.IO.File]::WriteAllText((Join-Path $repo 'f.txt'), "feat`n")
Invoke-Git $repo @('add', '.')
Invoke-Git $repo @('commit', '-q', '-m', 'feat-1')
Invoke-Git $repo @('checkout', '-q', 'main')

# ---- 预写 settings.json：项目页模式下由启动恢复自动打开仓库（替代旧"仓库路径"输入框）----
$settingsDir = Split-Path -Parent $settingsPath
New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
$escapedRepo = $repo.Replace('\', '\\')
@"
{
  "language": "zh-Hans",
  "projects": [ { "path": "$escapedRepo" } ],
  "currentProjectPath": "$escapedRepo"
}
"@ | Set-Content -Path $settingsPath -Encoding UTF8

$p = $null
try {
    $p = Start-Process -FilePath $exe -PassThru
    Start-Sleep -Seconds 8

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
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MC4 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint b, UIntPtr e);
    public static void Click(int x, int y) {
        SetCursorPos(x, y); System.Threading.Thread.Sleep(150);
        mouse_event(0x02,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(60);
        mouse_event(0x04,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(200);
    }
}
"@
    Add-Type -AssemblyName System.Windows.Forms
    function Shot([string]$name) {
        [MC4]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 400
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $g.Dispose()
        $file = Join-Path $env:TEMP $name
        $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Output ("shot: " + $file)
    }
    function Click-Row($el) {
        $r = $el.Current.BoundingRectangle
        [MC4]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 300
        [MC4]::Click([int]($r.X + $r.Width/2), [int]($r.Y + $r.Height/2))
        Start-Sleep -Milliseconds 800
        [MC4]::SetForegroundWindow([IntPtr]$p.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 300
    }
    function Status-Text($scopeRoot) {
        $texts = $scopeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Text)))
        foreach ($t in $texts) {
            $n = $t.Current.Name
            if ($n -and ($n.StartsWith('共 ') -or $n.StartsWith('已') -or $n.StartsWith('错误') -or $n.StartsWith('执行中') -or $n.StartsWith('加载中') -or $n.StartsWith('未打开'))) {
                return $n
            }
        }
        return ''
    }

    # 等待 UIA 树就绪（冷启动/首启可能超过固定 sleep；sidebar 任一按钮出现即可）
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        $probe = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '终端'
        if ($null -ne $probe) { break }
        Start-Sleep -Milliseconds 500
    }

    # ---- 1. 分支页签（项目页模式下仓库由启动恢复自动打开）----
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分支')
    Start-Sleep -Seconds 4

    $branchRow = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分支 feature'
    if ($null -eq $branchRow) { Write-Output 'FAIL: feature 分支行未找到'; exit 1 }
    $mainRow = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分支 main 当前'
    if ($null -eq $mainRow) { Write-Output 'FAIL: main 分支行（当前标记）未找到'; exit 1 }
    Write-Output 'OK: 分支树显示 main（当前）/ feature'

    # ---- 2. 检出 feature ----
    Invoke-Button $branchRow
    Start-Sleep -Seconds 1
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '检出')
    Start-Sleep -Seconds 3
    $headBranch = Invoke-Git $repo @('rev-parse', '--abbrev-ref', 'HEAD')
    if ($headBranch -ne 'feature') { Write-Output "FAIL: HEAD 应在 feature，实际 $headBranch"; exit 1 }
    $status = Status-Text $main
    Write-Output ("OK: 检出后 HEAD=feature，状态 = " + $status)

    # ---- 2.5 选中态像素采样（诊断）----
    $rows = @{}
    foreach ($n in @('分支 main', '分支 feature 当前')) {
        $el = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) $n
        if ($null -ne $el) { $rows[$n] = $el }
    }
    Write-Output '--- initial ---'
    Shot 'diag-initial.png' 
    if ($rows.ContainsKey('分支 main')) {
        Click-Row $rows['分支 main']
        Write-Output '--- after-click-main ---'
        Shot 'diag-click-main.png' 
    }
    if ($rows.ContainsKey('分支 feature 当前')) {
        Click-Row $rows['分支 feature 当前']
        Write-Output '--- after-click-feature ---'
        Shot 'diag-click-feature.png' 
    }

    # ---- 3. 删除确认对话框：N 值与实际一致（S6 通过标准）----
    Invoke-Button $branchRow
    Start-Sleep -Seconds 1
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '删除')
    Start-Sleep -Seconds 2

    $texts = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text)))
    $confirmText = ''
    foreach ($t in $texts) {
        $n = $t.Current.Name
        if ($n -and $n.StartsWith('将丢弃')) { $confirmText = $n; break }
    }
    Write-Output ("OK: 确认文案 = " + $confirmText)
    if ($confirmText -notmatch '将丢弃 1 个提交') { Write-Output 'FAIL: 确认文案 N 值应为 1'; exit 1 }

    # 取消 → 分支仍在
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '取消')
    Start-Sleep -Seconds 2
    if (Invoke-Git $repo @('rev-parse', '--verify', '-q', 'refs/heads/feature')) {
        # rev-parse 成功输出 sha = 分支存在
    } else {
        Write-Output 'FAIL: 取消后分支不应被删除'; exit 1
    }
    Write-Output 'OK: 取消后分支保留'

    # ---- 4. 切回 main 后确认删除 ----
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分支 main')
    Start-Sleep -Seconds 1
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '检出')
    Start-Sleep -Seconds 3
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分支 feature')
    Start-Sleep -Seconds 1
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '删除')
    Start-Sleep -Seconds 2
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '确认删除')
    Start-Sleep -Seconds 3

    $gone = & git -C $repo rev-parse --verify -q refs/heads/feature
    if ($LASTEXITCODE -eq 0 -and $gone) { Write-Output 'FAIL: 确认删除后分支仍存在'; exit 1 }
    $status = Status-Text $main
    Write-Output ("OK: 确认删除后 ref 消失，状态 = " + $status)
    if ($status -notmatch '已删除 feature') { Write-Output 'FAIL: 状态条无删除成功标记'; exit 1 }

    Write-Output 'SMOKE-BRANCHES-PAGE PASS'
    exit 0
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $repo -ErrorAction SilentlyContinue
}
