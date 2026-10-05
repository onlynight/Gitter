# smoke-command-palette.ps1 - S7 UIA 冒烟（命令面板 v2）：Ctrl+Shift+P 打开命令面板 → 输入过滤 → 单击执行 → 断言页签切换
# 执行驱动用 UIA InvokePattern（行是 Button，与鼠标 Click 同一路径）；本会话物理鼠标/键盘注入不可靠（前台窗口=0）。
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，finally 恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

# i18n 冒烟钉扎：断言锚点为中文文案（docs/i18n.md §五-4）
@'
{"language":"zh-Hans"}
'@ | Set-Content -Path $settingsPath -Encoding UTF8

$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 8

$exitCode = 0
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)

    function Find-ByName($scopeRoot, $ctlType, $name) {
        $and = New-Object System.Windows.Automation.AndCondition(
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctlType)),
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
        $scopeRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
    }

    # 1. 标题栏"命令面板"chip 打开面板（与 Ctrl+Shift+P 同入口）
    $btn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板'
    if ($null -eq $btn) { Write-Output 'FAIL: 命令面板按钮未找到'; $exitCode = 1; return }
    ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 2

    $paletteBox = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '输入命令…'
    if ($null -eq $paletteBox) { Write-Output 'FAIL: 命令面板输入框未出现'; $exitCode = 1; return }
    Write-Output 'OK: 命令面板已打开'

    # 2. UIA 组头存在（空查询 = 全部分类组头）
    $navHeader = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分类 导航'
    if ($null -eq $navHeader) { Write-Output 'FAIL: 组头"分类 导航"未找到'; $exitCode = 1; return }
    Write-Output 'OK: 空查询显示分类组头'

    # 3. 输入过滤词（ValuePattern 触发 TextChanged → 120ms 防抖过滤）
    ($paletteBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('分支')
    Start-Sleep -Seconds 2

    # 4. fuzzy 命中"转到分支"（v2 命令项 UIA Name = 纯标题，快捷键在行尾 kbd 芯片），行按钮 Invoke 执行
    $target = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '转到分支'
    if ($null -eq $target) { Write-Output 'FAIL: 过滤结果应含 转到分支'; $exitCode = 1; return }
    Write-Output 'OK: fuzzy 过滤命中 转到分支'
    ($target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 2

    # 5. 面板已关闭（Popup 内容从 UIA 树移除，或退化为离屏）+ 分支页特征按钮"创建"出现
    $boxAfter = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '输入命令…'
    $paletteGone = ($null -eq $boxAfter) -or $boxAfter.Current.IsOffscreen
    if (-not $paletteGone) { Write-Output 'FAIL: 执行后面板未关闭'; $exitCode = 1; return }
    Write-Output 'OK: 执行后面板已关闭'

    $createBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '创建'
    if ($null -eq $createBtn) { Write-Output 'FAIL: 分支页未打开（缺"创建"按钮）'; $exitCode = 1; return }
    Write-Output 'OK: 命令执行 → 分支页已打开'

    # 6. 最近使用：重开面板，空查询首位（组头之后）应是刚执行过的"转到分支"
    ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 2
    $recentHeader = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '分类 最近使用'
    if ($null -eq $recentHeader) { Write-Output 'FAIL: 重开后未出现"最近使用"组头'; $exitCode = 1; return }
    Write-Output 'OK: 最近使用组头出现'
    $settingsAfter = Get-Content (Join-Path $env:APPDATA 'GitUI\settings.json') -Raw | ConvertFrom-Json
    if ($settingsAfter.recentCommands -notcontains '转到分支') {
        Write-Output 'FAIL: settings.json recentCommands 未记录 转到分支'; $exitCode = 1; return
    }
    Write-Output 'OK: 最近使用已持久化到 settings.json'

    Write-Output 'SMOKE-COMMAND-PALETTE PASS'
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
exit $exitCode
