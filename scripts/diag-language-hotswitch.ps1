# diag-language-hotswitch.ps1 - i18n 热切换诊断（docs/i18n.md §四）
# 路径：启动（zh-Hans）→ 进设置页 → 点 English → 检查侧边栏/状态条是否即时变英文
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.diag-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
@'
{"language":"zh-Hans"}
'@ | Set-Content -Path $settingsPath -Encoding UTF8

$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8
for ($i = 0; $i -lt 10 -and $p.MainWindowHandle -eq 0; $i++) { Start-Sleep -Seconds 2; $p.Refresh() }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

try {
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)

    function Find-ByName($scopeRoot, $ctlType, $name) {
        $and = New-Object System.Windows.Automation.AndCondition(
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctlType)),
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
        $scopeRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
    }

    function Dump-NavNames($scopeRoot) {
        $names = @()
        foreach ($n in @('项目','Projects','Log','变更','Changes','分支','Branches','终端','Terminal','设置','Settings')) {
            if ($null -ne (Find-ByName $scopeRoot ([System.Windows.Automation.ControlType]::Button) $n)) { $names += $n }
        }
        return ($names -join ',')
    }

    # 可见文本断言：TextBlock 的 UIA Name 即其 Text —— 专防"自动化名更新了、可见文本没变"
    function Visible-Text($scopeRoot, $text) {
        return $null -ne (Find-ByName $scopeRoot ([System.Windows.Automation.ControlType]::Text) $text)
    }

    Write-Output ("T0 nav names: " + (Dump-NavNames $main))

    # 1. 进设置页
    $settingsNav = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '设置'
    if ($null -eq $settingsNav) { Write-Output 'FAIL: 设置导航按钮未找到'; exit 1 }
    ($settingsNav.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 2

    # 2. 点 English
    $enBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) 'English'
    if ($null -eq $enBtn) { Write-Output 'FAIL: English 按钮未找到'; exit 1 }
    ($enBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 3

    Write-Output ("T1 nav names after click English: " + (Dump-NavNames $main))
    Write-Output ("T1 nav VISIBLE text: en(Projects)=" + (Visible-Text $main 'Projects') + " zh(项目)=" + (Visible-Text $main '项目'))

    $status = Find-ByName $main ([System.Windows.Automation.ControlType]::Text) 'No project selected'
    $statusZh = Find-ByName $main ([System.Windows.Automation.ControlType]::Text) '未选择项目'
    Write-Output ("T1 status text: en=" + ($null -ne $status) + " zh=" + ($null -ne $statusZh))

    # 3. 点"跟随系统"（此刻界面为英文，按钮文本 = System）。
    #    设置页有两个 "System"（主题卡片的在前、语言卡片的在后），取最后一个才是语言档。
    $and = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'System')))
    $sysBtns = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, $and)
    Write-Output ("T2 System buttons found: " + $sysBtns.Count)
    if ($sysBtns.Count -lt 2) { Write-Output 'FAIL: 语言卡片的 System 按钮未找到'; exit 1 }
    $sysBtn = $sysBtns[$sysBtns.Count - 1]
    ($sysBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 3
    Write-Output ("T2 nav names after click System (expect zh): " + (Dump-NavNames $main))

    # 4. 再点"简体中文"（显式 zh-Hans）
    $zhBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '简体中文'
    if ($null -eq $zhBtn) { Write-Output 'FAIL: 简体中文按钮未找到'; exit 1 }
    ($zhBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 3
    Write-Output ("T3 nav names after click 简体中文: " + (Dump-NavNames $main))
} finally {
    if (-not $p.HasExited) { $p.Kill() }
    Start-Sleep -Seconds 1
    if ($hadUserSettings) { Copy-Item $settingsBackup $settingsPath -Force }
    elseif (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
}
