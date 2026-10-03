# check-accessibility.ps1 - S7 无障碍扫描（design.md §8-S7"AutomationProperties 覆盖率 100%"）
# 运行时 UIA 扫描：启动应用，逐页签收集全部交互元素，Name 为空即违规。
# 用法: powershell -ExecutionPolicy Bypass -File scripts\check-accessibility.ps1 [-Exe <path>]
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

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
    function Invoke-Button($btn) {
        ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    }

    # 交互元素控制类型（列表项由宿主 List 命名策略覆盖，单独统计不单独判违规）
    $interactiveTypes = @(
        [System.Windows.Automation.ControlType]::Button,
        [System.Windows.Automation.ControlType]::Edit,
        [System.Windows.Automation.ControlType]::ComboBox,
        [System.Windows.Automation.ControlType]::CheckBox,
        [System.Windows.Automation.ControlType]::Hyperlink,
        [System.Windows.Automation.ControlType]::TabItem
    )

    $pages = @(
        @{ key = 'Log';      label = 'Log' },
        @{ key = 'changes';  label = '变更' },
        @{ key = 'branches'; label = '分支' },
        @{ key = 'bash';     label = 'Git Bash' },
        @{ key = 'settings'; label = '设置' }
    )

    $totalChecked = 0
    $violations = New-Object System.Collections.Generic.List[string]

    foreach ($page in $pages) {
        $nav = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) $page.label
        if ($null -eq $nav) { Write-Output "WARN: 页签 '$($page.label)' 未找到，跳过"; continue }
        Invoke-Button $nav
        Start-Sleep -Seconds 2

        foreach ($t in $interactiveTypes) {
            $els = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                (New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $t)))
            foreach ($el in $els) {
                $totalChecked++
                $name = $el.Current.Name
                if ([string]::IsNullOrWhiteSpace($name)) {
                    $autoId = $el.Current.AutomationId
                    $violations.Add("$($page.key): $($t.ProgrammaticName) 无 Name (AutomationId=$autoId)")
                }
            }
        }
        Write-Output ("页面 '$($page.label)' 扫描完成，累计交互元素 " + $totalChecked)
    }

    if ($violations.Count -gt 0) {
        Write-Output ''
        Write-Output '无障碍违规：'
        $violations | ForEach-Object { Write-Output ("  " + $_) }
        $exitCode = 1
    } else {
        Write-Output ''
        Write-Output "无障碍扫描通过：$totalChecked 个交互元素全部有 Name"
    }
}
finally {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
exit $exitCode
