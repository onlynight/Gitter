# capture-diff-preview.ps1 - 启动应用打开预览窗口并截屏（S3 视觉核查用）
param(
    [string]$RepoPath = 'D:\Code\Gitter',
    [string]$OutFile = "$env:TEMP\diff-preview.png"
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

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

function Invoke-Button($btn) { ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke() }

try {
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '设置')
    Start-Sleep -Seconds 2
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '打开 Diff 渲染预览（S3 验证）')
    Start-Sleep -Seconds 3

    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid)

    $preview = $null
    foreach ($w in $windows) {
        if ($null -ne (Find-ByName $w ([System.Windows.Automation.ControlType]::Edit) '仓库路径')) { $preview = $w; break }
    }
    if ($null -eq $preview) { throw 'preview window not found' }

    $pathBox = Find-ByName $preview ([System.Windows.Automation.ControlType]::Edit) '仓库路径'
    ($pathBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($RepoPath)
    Invoke-Button (Find-ByName $preview ([System.Windows.Automation.ControlType]::Button) '打开仓库')
    Start-Sleep -Seconds 3

    $commitList = Find-ByName $preview ([System.Windows.Automation.ControlType]::List) '提交列表'
    $firstCommit = $commitList.FindFirst([System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    ($firstCommit.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
    Start-Sleep -Seconds 2

    $fileList = Find-ByName $preview ([System.Windows.Automation.ControlType]::List) '文件列表'
    $firstFile = $fileList.FindFirst([System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    ($firstFile.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
    Start-Sleep -Seconds 2

    # 截取预览窗口
    $rect = $preview.Current.BoundingRectangle
    $w = [int]$rect.Width; $h = [int]$rect.Height
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "CAPTURED: $OutFile ($w x $h)"
} finally {
  # 测试设置守卫：恢复用户 settings.json
  if ($hadUserSettings -and (Test-Path $settingsBackup)) { Move-Item $settingsBackup $settingsPath -Force }
  elseif (-not $hadUserSettings -and (Test-Path $settingsPath)) { Remove-Item $settingsPath -Force }
    $p.Kill()
    Start-Sleep -Seconds 1
    if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
}
