# smoke-projects-add.ps1 - 项目页「添加项目」端到端冒烟：点击按钮 → 原生目录对话框出现 →
# Win32 消息驱动对话框选定文件夹 → 断言项目入列并成为当前项目 → 自动跳转 Log 加载。
# 此脚本同时是对 FolderPicker 原生互操作（known-issues §5.3 崩溃修复）的回归验证：
# 若对话框路径再出 AccessViolation，进程会直接终止，本脚本以"进程存活"为第一断言。
#
# 环境约束（headless 兼容）：
# - UIA Invoke 会同步等待点击处理返回，SHBrowseForFolder 的模态循环会让它一直阻塞——
#   因此把 Invoke 放到后台 runspace，主线程继续轮询。
# - 真实鼠标/前台切换在非交互桌面（fg=0，锁定/断开的 RDP）上不可用，不能采用。
# - 对话框（class #32770）交互走纯 Win32：FindWindowEx 定位、WM_SETTEXT 填路径、
#   WM_COMMAND IDOK 确认——不依赖 UIA 桌面枚举（超时）也不依赖交互桌面。
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

function Invoke-Git($dir, [string[]]$gitArgs) {
    $out = & git -C $dir @gitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $gitArgs failed: $out" }
    return $out
}

# ---- 项目 A（已入列，当前）；待通过对话框添加的是 B（3 提交）----
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$repoA = Join-Path $env:TEMP "gitui-addsmoke-$suffix-a"
$repoB = Join-Path $env:TEMP "gitui-addsmoke-$suffix-b"
foreach ($r in @($repoA, $repoB)) { New-Item -ItemType Directory -Path $r | Out-Null }
function New-SmokeRepo([string]$dir, [int]$commits) {
    Invoke-Git $dir @('init', '-q', '-b', 'main', '.')
    Invoke-Git $dir @('config', 'core.autocrlf', 'false')
    Invoke-Git $dir @('config', 'user.name', 'smoke')
    Invoke-Git $dir @('config', 'user.email', 'smoke@test')
    for ($i = 1; $i -le $commits; $i++) {
        [System.IO.File]::WriteAllText((Join-Path $dir 'a.txt'), "$i`n")
        Invoke-Git $dir @('add', '.')
        Invoke-Git $dir @('commit', '-q', '-m', "c$i")
    }
}
New-SmokeRepo $repoA 2
New-SmokeRepo $repoB 3

$settingsDir = Split-Path -Parent $settingsPath
New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
$escA = $repoA.Replace('\', '\\')
@"
{
  "language": "zh-Hans",
  "projects": [ { "path": "$escA" } ],
  "currentProjectPath": "$escA"
}
"@ | Set-Content -Path $settingsPath -Encoding UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MC4 {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);

    // 找到属于 pid 的顶层 #32770 对话框；没有则返回 IntPtr.Zero
    public static IntPtr FindDialogFor(uint pid) {
        IntPtr h = IntPtr.Zero;
        while (true) {
            h = FindWindowExW(IntPtr.Zero, h, "#32770", null);
            if (h == IntPtr.Zero) return IntPtr.Zero;
            uint wpid;
            GetWindowThreadProcessId(h, out wpid);
            if (wpid == pid) return h;
        }
    }
    public static void SetText(IntPtr edit, string text) {
        IntPtr buf = Marshal.StringToHGlobalUni(text);
        try { SendMessageW(edit, 0x000C, IntPtr.Zero, buf); } // WM_SETTEXT
        finally { Marshal.FreeHGlobal(buf); }
    }
    public static void PressOk(IntPtr dlg) {
        PostMessageW(dlg, 0x0111, (IntPtr)1, IntPtr.Zero); // WM_COMMAND, IDOK
    }
}
'@

$p = $null
try {
    $p = Start-Process -FilePath $Exe -PassThru
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
        if ($null -eq $btn) { throw 'InvokeButton: 元素为 null' }
        $lastErr = ''
        for ($try = 1; $try -le 5; $try++) {
            try {
                ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
                return
            } catch {
                $lastErr = $_.Exception.Message
                Start-Sleep -Milliseconds 600
            }
        }
        throw ('InvokePattern 不可用 [' + $btn.Current.Name + ']: ' + $lastErr)
    }

    function Find-DialogWin32 {
        if ($p.HasExited) { return 'EXITED' }
        return [MC4]::FindDialogFor([uint32]$p.Id)
    }

    # ---- 0. 等待 UIA 树就绪（冷启动/首启可能超过固定 sleep；cf. fb3170b）----
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        if (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '项目') { break }
        Start-Sleep -Milliseconds 500
    }

    # ---- 1. 进项目页，后台 runspace Invoke「添加项目」----
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '项目')
    Start-Sleep -Seconds 1
    $addDeadline = (Get-Date).AddSeconds(10)
    $addBtn = $null
    while ((Get-Date) -lt $addDeadline) {
        $addBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '添加项目'
        if ($null -ne $addBtn) { break }
        Start-Sleep -Milliseconds 500
    }
    if ($null -eq $addBtn) { Write-Output 'FAIL: 添加项目按钮未找到'; exit 1 }

    $firePs = [PowerShell]::Create()
    $null = $firePs.AddScript({
        param($btn)
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    }).AddArgument($addBtn)
    $fireHandle = $firePs.BeginInvoke()

    # ---- 2. 等待原生目录对话框出现（第一断言：进程必须还活着）----
    $deadline = (Get-Date).AddSeconds(20)
    $dlg = [IntPtr]::Zero
    while ((Get-Date) -lt $deadline) {
        $dlg = Find-DialogWin32
        if ($dlg -ne [IntPtr]::Zero -or $dlg -eq 'EXITED') { break }
        Start-Sleep -Milliseconds 500
    }
    if ($dlg -eq 'EXITED') { Write-Output 'FAIL: 点击添加项目后进程退出（原生对话框互操作崩溃）'; exit 1 }
    if ($dlg -eq [IntPtr]::Zero) { Write-Output 'FAIL: 原生目录对话框未出现'; exit 1 }
    Write-Output 'OK: 原生目录对话框出现，进程存活'

    # ---- 3. Win32 驱动对话框：路径填入编辑框 → IDOK 确认 ----
    $edit = [MC4]::FindWindowExW($dlg, [IntPtr]::Zero, 'Edit', [NullString]::Value)
    if ($edit -eq [IntPtr]::Zero) { Write-Output 'FAIL: 对话框路径编辑框未找到'; exit 1 }
    [MC4]::SetText($edit, $repoB)
    Start-Sleep -Milliseconds 300
    [MC4]::PressOk($dlg)
    Start-Sleep -Seconds 3

    # ---- 4. 添加后：进程存活 + 自动跳转 Log 加载 B（共 3）----
    if ($p.HasExited) { Write-Output 'FAIL: 确认选择后进程退出'; exit 1 }
    $texts = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text)))
    $status = ''
    foreach ($t in $texts) {
        $n = $t.Current.Name
        if ($n -and $n -match '共 3' -and $n -match '已加载|共 \d+') { $status = $n; break }
    }
    Write-Output ("OK: 添加后状态 = " + $(if ($status) { $status } else { '(Log 状态条未见 共 3)' }))
    if (-not $status) { Write-Output 'FAIL: 添加后未自动跳转 Log 加载新项目'; exit 1 }

    # ---- 5. settings.json：B 入列且成为当前项目 ----
    Start-Sleep -Milliseconds 500
    $json = Get-Content $settingsPath -Raw | ConvertFrom-Json
    $inList = @($json.projects) | Where-Object { $_.path -ieq $repoB }
    if ($null -eq $inList) { Write-Output 'FAIL: settings.json 未新增项目 B'; exit 1 }
    if ($json.currentProjectPath -ine $repoB) { Write-Output "FAIL: currentProjectPath 应为 B，实际 $($json.currentProjectPath)"; exit 1 }
    Write-Output 'OK: 项目 B 已入列并持久化为当前项目'

    Write-Output 'SMOKE-PROJECTS-ADD PASS'
    $firePs.Dispose()
    exit 0
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    if ($null -ne $p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item $repoA -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $repoB -Recurse -Force -ErrorAction SilentlyContinue
}
