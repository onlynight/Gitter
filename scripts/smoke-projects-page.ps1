# smoke-projects-page.ps1 - 项目页 UIA 冒烟：启动恢复 → 列表渲染（当前标记）→ 双击切换项目 → 跳转 Log → 标记跟随
# 「添加项目」弹原生目录对话框无法可靠自动化，添加路径由人工验证；本脚本覆盖列表与切换链路。
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

function Invoke-Git($dir, [string[]]$gitArgs) {
    $out = & git -C $dir @gitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $gitArgs failed: $out" }
    return $out
}

function New-SmokeRepo([string]$dir, [int]$commits) {
    New-Item -ItemType Directory -Path $dir | Out-Null
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

# ---- 两个临时仓库：A 2 提交，B 3 提交（Log 状态条 "共 N" 可区分当前项目）----
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$repoA = Join-Path $env:TEMP "gitui-prjsmoke-$suffix-a"
$repoB = Join-Path $env:TEMP "gitui-prjsmoke-$suffix-b"
New-SmokeRepo $repoA 2
New-SmokeRepo $repoB 3
$nameA = Split-Path -Leaf $repoA
$nameB = Split-Path -Leaf $repoB

# ---- 预写 settings.json：A、B 均在项目列表，当前项目 = A ----
$settingsDir = Split-Path -Parent $settingsPath
New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
$escA = $repoA.Replace('\', '\\')
$escB = $repoB.Replace('\', '\\')
@"
{
  "projects": [
    { "path": "$escA" },
    { "path": "$escB" }
  ],
  "currentProjectPath": "$escA"
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
            if ($n -and ($n.StartsWith('共 ') -or $n.StartsWith('已加载') -or $n.StartsWith('错误') -or $n.StartsWith('加载中') -or $n.StartsWith('未打开'))) {
                return $n
            }
        }
        return ''
    }
    # 项目行会在单击后整表重建（选中态由状态驱动），按名字重找以拿到新鲜元素
    function Find-ProjectRow($scopeRoot, $name) {
        for ($try = 1; $try -le 5; $try++) {
            $row = Find-ByName $scopeRoot ([System.Windows.Automation.ControlType]::Button) $name
            if ($null -ne $row) { return $row }
            Start-Sleep -Milliseconds 500
        }
        return $null
    }

    # ---- 1. 启动恢复：当前项目 A 自动加载进 Log（共 2）----
    $status = Status-Text $main
    Write-Output ("OK: 启动恢复后 Log 状态 = " + $status)
    if ($status -notmatch '共 2') { Write-Output "FAIL: 项目 A 应自动加载（共 2），实际: $status"; exit 1 }

    # ---- 2. 项目页：列表渲染 + 当前标记 ----
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '项目')
    Start-Sleep -Seconds 2

    $rowA = Find-ProjectRow $main "项目 $nameA 当前"
    if ($null -eq $rowA) { Write-Output "FAIL: 项目 A 行应有「当前」标记"; exit 1 }
    $rowBPlain = Find-ProjectRow $main "项目 $nameB"
    if ($null -eq $rowBPlain) { Write-Output "FAIL: 项目 B 行未找到"; exit 1 }
    Write-Output 'OK: 项目列表渲染，A 带「当前」标记'

    # ---- 3. 双击切换（UIA Invoke 两次 = 单击高亮 + 提交）→ 跳转 Log 加载 B ----
    Invoke-Button $rowBPlain
    Start-Sleep -Milliseconds 800
    $rowBSelected = Find-ProjectRow $main "项目 $nameB 已选中"
    if ($null -eq $rowBSelected) { Write-Output 'FAIL: 首次单击后 B 行应高亮（已选中）'; exit 1 }
    Invoke-Button $rowBSelected
    Start-Sleep -Seconds 3

    $status = Status-Text $main
    Write-Output ("OK: 切换后自动跳转 Log，状态 = " + $status)
    if ($status -notmatch '共 3') { Write-Output "FAIL: 项目 B 应加载（共 3），实际: $status"; exit 1 }

    # ---- 4. 回项目页：当前标记已跟随到 B（切换后 B 仍处于高亮候选态）----
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '项目')
    Start-Sleep -Seconds 2
    $rowBNow = Find-ProjectRow $main "项目 $nameB 当前 已选中"
    if ($null -eq $rowBNow) { Write-Output 'FAIL: 切换后 B 行应带「当前」标记'; exit 1 }
    Write-Output 'OK: 当前项目标记已跟随到 B'

    # ---- 5. 持久化：settings.json 的 currentProjectPath 已指向 B ----
    Start-Sleep -Milliseconds 500
    $json = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($json.currentProjectPath -ine $repoB) { Write-Output "FAIL: currentProjectPath 应为 $repoB，实际 $($json.currentProjectPath)"; exit 1 }
    Write-Output 'OK: currentProjectPath 已持久化'

    Write-Output 'SMOKE-PROJECTS-PAGE PASS'
    exit 0
}
finally {
    if ($null -ne $p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item $repoA -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $repoB -Recurse -Force -ErrorAction SilentlyContinue
}
