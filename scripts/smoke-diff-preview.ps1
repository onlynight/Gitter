# smoke-diff-preview.ps1 - S3 UIA 冒烟：设置页 → Diff 渲染预览窗口 → 打开本仓库 → 选提交/文件 → Diff 视图出现
param(
    [string]$RepoPath = 'D:\Code\Gitter'
)

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
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

try {
    # 1. 侧边栏进入"设置"
    $settingsBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '设置'
    if ($null -eq $settingsBtn) { Write-Output 'FAIL: 设置按钮未找到'; exit 1 }
    Invoke-Button $settingsBtn
    Start-Sleep -Seconds 2

    # 2. 打开 Diff 预览窗口
    $previewBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '打开 Diff 渲染预览（S3 验证）'
    if ($null -eq $previewBtn) { Write-Output 'FAIL: Diff 预览按钮未找到'; exit 1 }
    Invoke-Button $previewBtn
    Start-Sleep -Seconds 3

    # 3. 预览窗口与主窗口同进程：按进程 ID 在桌面根下找"仓库路径"输入框
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid)
    Write-Output ("OK: 进程顶层窗口数 = " + $windows.Count)
    if ($windows.Count -lt 2) { Write-Output 'FAIL: 预览窗口未出现'; exit 1 }

    $preview = $null
    foreach ($w in $windows) {
        $edit = Find-ByName $w ([System.Windows.Automation.ControlType]::Edit) '仓库路径'
        if ($null -ne $edit) { $preview = $w; break }
    }
    if ($null -eq $preview) { Write-Output 'FAIL: 预览窗口内容未找到（仓库路径输入框）'; exit 1 }
    Write-Output 'OK: 预览窗口已打开'

    # 4. 输入仓库路径并打开
    $pathBox = Find-ByName $preview ([System.Windows.Automation.ControlType]::Edit) '仓库路径'
    ($pathBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($RepoPath)
    $openBtn = Find-ByName $preview ([System.Windows.Automation.ControlType]::Button) '打开仓库'
    if ($null -eq $openBtn) { Write-Output 'FAIL: 打开仓库按钮未找到'; exit 1 }
    Invoke-Button $openBtn
    Start-Sleep -Seconds 3

    # 5. 选择第一个提交
    $commitList = Find-ByName $preview ([System.Windows.Automation.ControlType]::List) '提交列表'
    if ($null -eq $commitList) { Write-Output 'FAIL: 提交列表未找到'; exit 1 }
    $firstCommit = $commitList.FindFirst([System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    if ($null -eq $firstCommit) { Write-Output 'FAIL: 提交列表为空'; exit 1 }
    ($firstCommit.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
    Start-Sleep -Seconds 2
    Write-Output ('OK: 已选提交: ' + $firstCommit.Current.Name)

    # 6. 选择第一个文件
    $fileList = Find-ByName $preview ([System.Windows.Automation.ControlType]::List) '文件列表'
    if ($null -eq $fileList) { Write-Output 'FAIL: 文件列表未找到'; exit 1 }
    $firstFile = $fileList.FindFirst([System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    if ($null -eq $firstFile) { Write-Output 'FAIL: 文件列表为空'; exit 1 }
    ($firstFile.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
    Start-Sleep -Seconds 2
    Write-Output ('OK: 已选文件: ' + $firstFile.Current.Name)

    # 7. Diff 视图出现
    $canvas = Find-ByName $preview ([System.Windows.Automation.ControlType]::Custom) 'Diff 视图'
    if ($null -eq $canvas) { $canvas = Find-ByName $preview ([System.Windows.Automation.ControlType]::Group) 'Diff 视图' }
    if ($null -eq $canvas) {
        $byName = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, 'Diff 视图')
        $canvas = $preview.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $byName)
    }
    if ($null -eq $canvas) { Write-Output 'FAIL: Diff 视图未出现'; exit 1 }
    Write-Output 'OK: Diff 视图已渲染'

    Write-Output 'SMOKE PASS'
} finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    $p.Kill()
    Start-Sleep -Seconds 1
    if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
}
