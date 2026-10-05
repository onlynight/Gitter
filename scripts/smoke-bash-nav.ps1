# smoke-bash-nav.ps1 - App UI smoke: nav to Git Bash page via UIA
$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
# 测试设置守卫：备份用户 settings.json，脚本尾部恢复（脚本重写会清掉用户项目/主题）
$settingsBackup = Join-Path $env:APPDATA 'GitUI\settings.verify-backup'
$hadUserSettings = Test-Path $settingsPath
if ($hadUserSettings) { Copy-Item $settingsPath $settingsBackup -Force }
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)

function Find-Button($name) {
    $and = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
    $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
}

$navBtn = Find-Button 'Git Bash'
if ($null -eq $navBtn) { Write-Output 'FAIL: Git Bash Button not found'; $p.Kill(); exit 1 }
Write-Output ('OK: Git Bash Button found, rect=' + $navBtn.Current.BoundingRectangle)

$invoke = $navBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
Start-Sleep -Seconds 2

if ($null -ne (Find-Button ([string][char]0x6E05 + [string][char]0x5C4F))) { Write-Output 'OK: Bash page toolbar visible' }
else { Write-Output 'FAIL: Bash page toolbar not visible'; $p.Kill(); exit 1 }

$edit = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
if ($null -ne $edit) { Write-Output 'OK: input box visible' } else { Write-Output 'FAIL: input box not visible'; $p.Kill(); exit 1 }

$p.Kill()
Start-Sleep -Seconds 1
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
# 测试设置守卫：恢复用户 settings.json
if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
Write-Output 'SMOKE PASS'
