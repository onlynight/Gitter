# smoke-bash-terminal.ps1 - S0e UIA 冒烟：Git Bash 页签 → ConPTY 预检 → 会话启动 → 状态条
# ConPTY 环境不支持（RDP/非交互会话 0xC0000142，§11.10.5）时软跳过（exit 2）
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$ErrorActionPreference = 'Continue'
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

Get-Process GitUI.App -ErrorAction SilentlyContinue | Stop-Process -Force

# ConPTY 预检（与 Shell.Tests 同策略）：bash -c echo 8 秒探测
$probeOk = $false
try {
    $probe = Start-Process -FilePath "bash" -ArgumentList "-c", "echo ok" -PassThru -WindowStyle Hidden -ErrorAction Stop
    if ($probe.WaitForExit(8000)) { $probeOk = ($probe.ExitCode -eq 0) } else { $probe.Kill() }
} catch { $probeOk = $false }

$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 8

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
        # RDP 会话下首次 Invoke 可能返回 E_FAIL（UIA 提供程序冷启动），重试 5 次
        for ($try = 1; $try -le 5; $try++) {
            try {
                ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
                return
            } catch {
                Start-Sleep -Milliseconds 600
            }
        }
        throw "Invoke-Button 重试 5 次仍失败"
    }
    function Status-Text($scopeRoot) {
        $texts = $scopeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Text)))
        foreach ($t in $texts) {
            $n = $t.Current.Name
            if ($n -and ($n.StartsWith('运行中') -or $n.StartsWith('已退出') -or $n.StartsWith('未找到') -or $n.StartsWith('启动失败') -or $n.StartsWith('未启动') -or $n.StartsWith('正在检测') -or $n.StartsWith('环境不支持'))) {
                return $n
            }
        }
        return ''
    }

    # 等 UIA 树就绪
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        $probe2 = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '终端'
        if ($null -ne $probe2) { break }
        Start-Sleep -Milliseconds 500
    }

    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '终端')

    # 轮询状态：ConPTY 预检（≤8s 硬超时）+ 会话启动；每步检查应用存活
    $status = ''
    $final = $false
    foreach ($i in 1..20) {
        Start-Sleep -Seconds 1
        $p.Refresh()
        if ($p.HasExited) { Write-Output ("FAIL: 应用在轮询期间退出 (t+" + $i + "s)"); exit 1 }
        $status = Status-Text $main
        if ($status.StartsWith('环境不支持')) {
            Write-Output ("SOFT-SKIP: " + $status)
            $card = Find-ByName $main ([System.Windows.Automation.ControlType]::Group) '终端环境提示'
            if ($null -ne $card) { Write-Output 'OK: 空态卡片已展示' }
            exit 2
        }
        if ($status.StartsWith('运行中')) { $final = $true; break }
        if ($status.StartsWith('未找到') -or $status.StartsWith('启动失败')) { break }
    }

    Write-Output ("OK: Git Bash 页签状态 = " + $status)

    if (-not $final) { Write-Output 'FAIL: 会话未进入运行状态'; exit 1 }

    if ($probeOk) {
        Write-Output 'OK: ConPTY 会话运行中'
        Write-Output 'SMOKE-BASH-TERMINAL PASS'
        exit 0
    } else {
        Write-Output 'SOFT-SKIP: ConPTY 预检失败（会话级集成依赖桌面会话）'
        exit 2
    }
}
finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
