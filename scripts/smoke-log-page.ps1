# smoke-log-page.ps1 - S4 UIA 冒烟：打开仓库 → 首屏条目 → 搜索过滤 → 分组折叠 → 点击提交 → 文件 → Diff 视图
# design.md §8-S4"UI 自动化测试覆盖搜索 → 分组 → 点击 → 显示 diff 完整链路"
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe',
    [string]$RepoPath = 'D:\Code\Gitter',
    [string]$Author = 'wyndam'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

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

function Find-AllButtons($scopeRoot) {
    $scopeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button)))
}

function Count-ByNamePrefix($scopeRoot, $prefix) {
    $n = 0
    foreach ($b in (Find-AllButtons $scopeRoot)) {
        if ($b.Current.Name -and $b.Current.Name.StartsWith($prefix)) { $n++ }
    }
    return $n
}

function Status-Text($scopeRoot) {
    # 状态 TextBlock 未设 AutomationProperties.Name（显式 Name 会覆盖动态文本），
    # 其 UIA Name 即状态内容本身，按内容前缀在 Text 元素中定位
    $texts = $scopeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text)))
    foreach ($t in $texts) {
        $n = $t.Current.Name
        if ($n -and ($n.StartsWith('已加载') -or $n.StartsWith('错误') -or $n.StartsWith('加载中') -or $n.StartsWith('未打开'))) {
            return $n
        }
    }
    return ''
}

try {
    # ---- 1. 默认 Log 页：仓库路径输入 + 打开 ----
    $repoBox = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '仓库路径'
    if ($null -eq $repoBox) { Write-Output 'FAIL: 仓库路径输入框未找到'; exit 1 }
    ($repoBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($RepoPath)

    $openBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '打开仓库'
    if ($null -eq $openBtn) { Write-Output 'FAIL: 打开仓库按钮未找到'; exit 1 }
    Invoke-Button $openBtn
    Start-Sleep -Seconds 4

    # ---- 2. 首屏条目数（状态条 "已加载 N / 共 M"）----
    $status = Status-Text $main
    Write-Output ("OK: 打开后状态 = " + $status)
    if ($status -notmatch '已加载 (\d+) / 共 (\d+)') { Write-Output 'FAIL: 状态条无条目计数'; exit 1 }
    $loaded = [int]$Matches[1]; $total = [int]$Matches[2]
    if ($loaded -lt 1 -or $loaded -gt 50) { Write-Output "FAIL: 首屏条目数异常 ($loaded)"; exit 1 }
    if ($total -lt 1) { Write-Output "FAIL: 总提交数为 0"; exit 1 }

    $commitRowsBefore = Count-ByNamePrefix $main '提交 '
    Write-Output ("OK: 可见提交行 = " + $commitRowsBefore)
    if ($commitRowsBefore -lt 1) { Write-Output 'FAIL: 列表无提交行'; exit 1 }

    # ---- 3. 分组头存在 ----
    $groupHeaders = Count-ByNamePrefix $main '分组 '
    Write-Output ("OK: 分组头 = " + $groupHeaders)
    if ($groupHeaders -lt 1) { Write-Output 'FAIL: 无分组头'; exit 1 }

    # ---- 4. 搜索：不存在的作者 → 0 条 ----
    $searchBox = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) 'Log 搜索'
    if ($null -eq $searchBox) { Write-Output 'FAIL: 搜索框未找到'; exit 1 }
    ($searchBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue("author:nonexistent-xyz")
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '搜索')
    Start-Sleep -Seconds 3
    $status = Status-Text $main
    Write-Output ("OK: author:nonexistent-xyz → " + $status)
    if ($status -notmatch '已加载 0 / 共 0') { Write-Output 'FAIL: 不存在作者应得 0 条'; exit 1 }
    if ((Count-ByNamePrefix $main '提交 ') -ne 0) { Write-Output 'FAIL: 0 条时仍有提交行'; exit 1 }

    # ---- 5. 搜索：真实作者 → >0 条 ----
    ($searchBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue("author:$Author")
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '搜索')
    Start-Sleep -Seconds 3
    $status = Status-Text $main
    Write-Output ("OK: author:$Author → " + $status)
    if ($status -match '共 0') { Write-Output "FAIL: 真实作者过滤结果为 0"; exit 1 }

    # 清空搜索恢复全量
    ($searchBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue("")
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '搜索')
    Start-Sleep -Seconds 3

    # ---- 6. 分组折叠：点击第一个组头 → 提交行减少 ----
    $headerBtn = $null
    foreach ($b in (Find-AllButtons $main)) {
        if ($b.Current.Name -and $b.Current.Name.StartsWith('分组 ')) { $headerBtn = $b; break }
    }
    if ($null -eq $headerBtn) { Write-Output 'FAIL: 组头按钮未找到'; exit 1 }
    $before = Count-ByNamePrefix $main '提交 '
    Invoke-Button $headerBtn
    Start-Sleep -Seconds 2
    $after = Count-ByNamePrefix $main '提交 '
    Write-Output ("OK: 折叠后提交行 $before → $after")
    if ($after -ge $before) { Write-Output 'FAIL: 折叠未减少提交行'; exit 1 }
    Invoke-Button $headerBtn
    Start-Sleep -Seconds 2
    $restored = Count-ByNamePrefix $main '提交 '
    Write-Output ("OK: 展开恢复 $restored")
    if ($restored -lt $before) { Write-Output 'FAIL: 展开未恢复提交行'; exit 1 }

    # ---- 7. 点击提交 → 文件列表 → Diff 视图 ----
    $commitBtn = $null
    foreach ($b in (Find-AllButtons $main)) {
        if ($b.Current.Name -and $b.Current.Name.StartsWith('提交 ')) { $commitBtn = $b; break }
    }
    if ($null -eq $commitBtn) { Write-Output 'FAIL: 提交行按钮未找到'; exit 1 }
    Invoke-Button $commitBtn
    Start-Sleep -Seconds 3

    # 变更文件项：ListViewItem，Name = "文件 <path>"（Name 属性是精确匹配，前缀过滤需枚举）
    $fileCount = 0
    $firstFileItem = $null
    $listItems = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    foreach ($it in $listItems) {
        if ($it.Current.Name -and $it.Current.Name.StartsWith('文件 ')) {
            $fileCount++
            if ($null -eq $firstFileItem) { $firstFileItem = $it }
        }
    }
    Write-Output ("OK: 变更文件项 = " + $fileCount)
    if ($fileCount -lt 1) { Write-Output 'FAIL: 文件列表为空'; exit 1 }

    # ---- 8. 通用 git diff：设基准 → 清除（按钮出现/消失）----
    $pinBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '设为比较基准'
    if ($null -eq $pinBtn) { Write-Output 'FAIL: 设为比较基准按钮未找到'; exit 1 }
    Invoke-Button $pinBtn
    Start-Sleep -Seconds 2

    $clearBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '清除比较基准'
    if ($null -eq $clearBtn) { Write-Output 'FAIL: 设基准后应出现清除按钮'; exit 1 }
    Write-Output 'OK: 比较基准已设置（清除按钮出现）'

    Invoke-Button $clearBtn
    Start-Sleep -Seconds 2
    $clearGone = $null -eq (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '清除比较基准')
    if (-not $clearGone) { Write-Output 'FAIL: 清除后按钮应消失'; exit 1 }
    Write-Output 'OK: 清除比较基准恢复默认父 diff 视图'

    ($firstFileItem.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
    Start-Sleep -Seconds 2

    $diffView = Find-ByName $main ([System.Windows.Automation.ControlType]::Custom) 'Diff 视图'
    if ($null -eq $diffView) {
        # DiffCanvas 是 Grid，ControlType 可能报告为 Custom 之外的值——放宽为按 Name 找
        $diffView = $main.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty, 'Diff 视图')))
    }
    if ($null -eq $diffView) { Write-Output 'FAIL: Diff 视图未出现'; exit 1 }
    Write-Output 'OK: Diff 视图已渲染'

    Write-Output 'SMOKE-LOG-PAGE PASS'
    exit 0
}
finally {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
