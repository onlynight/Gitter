# smoke-changes-page.ps1 - S5 UIA 冒烟：变更页打开仓库 → 三层列表 → 选文件看 diff → 暂存 → 提交 → 断言 HEAD
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe',
    [string]$Author = 'smoke'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

# ---- 构造临时仓库：base 提交 + 两处修改（分属两个 hunk）----
$repo = Join-Path $env:TEMP ("gitui-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $repo | Out-Null
function Invoke-Git($dir, [string[]]$gitArgs) {
    $out = & git -C $dir @gitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $gitArgs failed: $out" }
    return $out
}
Invoke-Git $repo @('init', '-q', '-b', 'main', '.')
# 与 GitFixtureBuilder 同理：隔离用户全局配置的 autocrlf，保证内容逐字节一致
Invoke-Git $repo @('config', 'core.autocrlf', 'false')
Invoke-Git $repo @('config', 'core.quotepath', 'false')
Invoke-Git $repo @('config', 'user.name', $Author)
Invoke-Git $repo @('config', 'user.email', "$author@test")
$base = (1..12 | ForEach-Object { "line$_" }) -join "`n"
[System.IO.File]::WriteAllText((Join-Path $repo 'f.txt'), $base + "`n")
Invoke-Git $repo @('add', '.')
Invoke-Git $repo @('commit', '-q', '-m', 'base')
$modified = $base.Replace('line2', 'LINE2').Replace('line12', 'LINE12')
[System.IO.File]::WriteAllText((Join-Path $repo 'f.txt'), $modified + "`n")
[System.IO.File]::WriteAllText((Join-Path $repo 'new.txt'), "untracked`n")

# ---- 预写 settings.json：项目页模式下由启动恢复自动打开仓库（替代旧"仓库路径"输入框）----
$settingsDir = Split-Path -Parent $settingsPath
New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
$escapedRepo = $repo.Replace('\', '\\')
@"
{
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
    function Status-Text($scopeRoot) {
        $texts = $scopeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Text)))
        foreach ($t in $texts) {
            $n = $t.Current.Name
            if ($n -and ($n.StartsWith('1 项') -or $n.StartsWith('已提交') -or $n.StartsWith('工作区干净') -or $n.StartsWith('错误') -or $n.StartsWith('加载中') -or $n.StartsWith('未打开'))) {
                return $n
            }
        }
        return ''
    }

    # ---- 1. 切到"变更"页签 ----
    $changesBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '变更'
    if ($null -eq $changesBtn) { Write-Output 'FAIL: 变更页签按钮未找到'; exit 1 }
    Invoke-Button $changesBtn
    Start-Sleep -Seconds 2

    # ---- 2. 启动恢复后变更页数据已在（项目页模式，无需输入仓库路径）----
    $status = Status-Text $main
    Write-Output ("OK: 打开后状态 = " + $status)
    if ($status -notmatch '1 项变更') { Write-Output 'FAIL: 应有 1 项变更'; exit 1 }

    # ---- 3. 点击变更文件行 → Diff 视图出现 ----
    $fileRow = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) "变更 f.txt"
    if ($null -eq $fileRow) { Write-Output 'FAIL: 变更文件行未找到'; exit 1 }
    Invoke-Button $fileRow
    Start-Sleep -Seconds 2

    $diffView = $main.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, 'Diff 视图')))
    if ($null -eq $diffView) { Write-Output 'FAIL: Diff 视图未出现'; exit 1 }
    Write-Output 'OK: 文件行点击 → Diff 视图出现'

    # ---- 4. 整文件暂存 → 层移动 ----
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '暂存文件')
    Start-Sleep -Seconds 3
    $status = Status-Text $main
    Write-Output ("OK: 暂存后状态 = " + $status)
    if ($status -notmatch '1 项已暂存') { Write-Output 'FAIL: 暂存后应有 1 项已暂存'; exit 1 }

    # ---- 5. 提交（不推送）----
    $msgBox = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '提交消息'
    if ($null -eq $msgBox) { Write-Output 'FAIL: 提交消息输入框未找到'; exit 1 }
    ($msgBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue("smoke: commit via UI")

    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '提交')
    # 轮询等待提交完成（最多 15s）；new.txt 保持未跟踪，故以"已提交 <sha>"为完成锚点
    $ok = $false
    foreach ($i in 1..15) {
        Start-Sleep -Seconds 1
        $status = Status-Text $main
        if ($status -match '已提交 [0-9a-f]{7,}') { $ok = $true; break }
    }
    Write-Output ("OK: 提交后状态 = " + $status)
    if (-not $ok) { Write-Output 'FAIL: 提交后工作区未变干净'; exit 1 }

    # ---- 6. 权威断言：HEAD 提交存在且工作区无已跟踪变更 ----
    $headMsg = Invoke-Git $repo @('log', '-1', '--format=%s')
    if ($headMsg -ne 'smoke: commit via UI') { Write-Output "FAIL: HEAD 消息不符: $headMsg"; exit 1 }
    $dirty = Invoke-Git $repo @('status', '--porcelain')
    if ($dirty -notmatch '^\?\? new\.txt') { Write-Output "FAIL: 工作区状态异常: $dirty"; exit 1 }
    $headContent = (Invoke-Git $repo @('show', 'HEAD:f.txt')) -join "`n"
    if ($headContent -notmatch 'LINE2' -or $headContent -notmatch 'LINE12') { Write-Output 'FAIL: HEAD 内容未包含修改'; exit 1 }
    Write-Output 'OK: HEAD 消息 / 内容 / 工作区状态全部一致'

    Write-Output 'SMOKE-CHANGES-PAGE PASS'
    exit 0
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $repo -ErrorAction SilentlyContinue
}
