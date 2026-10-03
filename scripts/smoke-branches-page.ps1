# smoke-branches-page.ps1 - S6 UIA 冒烟：分支页打开仓库 → 树显示 → 检出 → 删除确认对话框（N 值一致）→ 删除
param()

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
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
            if ($n -and ($n.StartsWith('共 ') -or $n.StartsWith('已') -or $n.StartsWith('错误') -or $n.StartsWith('执行中') -or $n.StartsWith('加载中') -or $n.StartsWith('未打开'))) {
                return $n
            }
        }
        return ''
    }

    # ---- 1. 分支页签 + 打开仓库 ----
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分支')
    Start-Sleep -Seconds 2
    $repoBox = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '仓库路径'
    if ($null -eq $repoBox) { Write-Output 'FAIL: 仓库路径输入框未找到'; exit 1 }
    ($repoBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($repo)
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '打开仓库')
    Start-Sleep -Seconds 3

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
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $repo -ErrorAction SilentlyContinue
}
