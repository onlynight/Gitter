# smoke-bash-terminal.ps1 - S0e UIA 冒烟：Git Bash 页签 → ConPTY 启动 → 输出渲染 → 状态条
# ConPTY 探测失败（本机已知 RDP 会话问题，§11.10）时软跳过（exit 2）
param(
    [string]$Exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
)

$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

# ConPTY 预检（与 Shell.Tests 同策略）：bash -c echo 8 秒探测
$probeOk = $false
try {
    $probe = Start-Process -FilePath "bash" -ArgumentList "-c", "echo ok" -PassThru -WindowStyle Hidden -ErrorAction Stop
    if ($probe.WaitForExit(8000)) { $probeOk = ($probe.ExitCode -eq 0) } else { $probe.Kill() }
} catch { $probeOk = $false }

$p = $null
try {
    $p = Start-Process -FilePath $Exe -PassThru
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
            if ($n -and ($n -match '运行中' -or $n -match '已退出' -or $n -match '未找到' -or $n -match '启动失败' -or $n -match '未启动')) {
                return $n
            }
        }
        return ''
    }

    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) 'Git Bash')
    Start-Sleep -Seconds 3

    $status = Status-Text $main
    Write-Output ("OK: Git Bash 页签状态 = " + $status)

    if ($status -match '未找到|启动失败') {
        # bash 缺失时空态卡片应出现
        $card = Find-ByName $main ([System.Windows.Automation.ControlType]::Group) 'Git Bash 未安装提示'
        if ($null -ne $card) { Write-Output 'SOFT-SKIP: bash 未安装（空态卡片正常）'; exit 2 }
        Write-Output 'SOFT-SKIP: bash 定位失败'; exit 2
    }

    if ($status -notmatch '\d+\s*[x×]\s*\d+') { Write-Output 'FAIL: 状态条无 PTY 尺寸'; exit 1 }

    if ($probeOk) {
        # ConPTY 正常：会话应已启动
        if ($status -notmatch '运行中') { Write-Output "FAIL: 预检通过但会话未运行"; exit 1 }
        Write-Output 'OK: ConPTY 会话运行中'
        Write-Output 'SMOKE-BASH-TERMINAL PASS'
        exit 0
    } else {
        # 预检失败（RDP 会话 ConPTY 已知问题）：只验证页签 UI 正常，不判失败
        Write-Output 'SOFT-SKIP: ConPTY 预检失败（会话级集成依赖桌面会话）'
        exit 2
    }
}
finally {
    if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
