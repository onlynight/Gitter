param([string]$OutFile = "$env:TEMP\diff-inline.png")
Add-Type -AssemblyName System.Drawing
$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
function Find-ByName($r, $t, $n) {
    $and = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $t)),
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $n)))
    $r.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
}
function Invoke-Button($b) { ($b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke() }
try {
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '设置')
    Start-Sleep -Seconds 2
    Invoke-Button (Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '打开 Diff 渲染预览（S3 验证）')
    Start-Sleep -Seconds 3
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $byPid = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $byPid)
    $preview = $null
    foreach ($w in $windows) { if ($null -ne (Find-ByName $w ([System.Windows.Automation.ControlType]::Edit) '仓库路径')) { $preview = $w; break } }
    $pathBox = Find-ByName $preview ([System.Windows.Automation.ControlType]::Edit) '仓库路径'
    ($pathBox.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('D:\Code\Gitter')
    Invoke-Button (Find-ByName $preview ([System.Windows.Automation.ControlType]::Button) '打开仓库')
    Start-Sleep -Seconds 3
    # 切内联模式
    Invoke-Button (Find-ByName $preview ([System.Windows.Automation.ControlType]::Button) '内联模式')
    Start-Sleep -Seconds 1
    $commitList = Find-ByName $preview ([System.Windows.Automation.ControlType]::List) '提交列表'
    $fc = $commitList.FindFirst([System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
    ($fc.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
    Start-Sleep -Seconds 2
    $fileList = Find-ByName $preview ([System.Windows.Automation.ControlType]::List) '文件列表'
    $ff = $fileList.FindFirst([System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
    ($ff.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
    Start-Sleep -Seconds 2
    # Alt+Down 两次跳到第二个变更块，然后截屏
    $canvas = Find-ByName $preview ([System.Windows.Automation.ControlType]::Custom) 'Diff 视图'
    if ($null -eq $canvas) { $canvas = Find-ByName $preview ([System.Windows.Automation.ControlType]::Group) 'Diff 视图' }
    if ($null -ne $canvas) { $canvas.SetFocus() }
    Start-Sleep -Milliseconds 500
    $ws = New-Object -ComObject WScript.Shell
    $ws.SendKeys('%{DOWN}')
    Start-Sleep -Milliseconds 300
    $ws.SendKeys('%{DOWN}')
    Start-Sleep -Milliseconds 800
    $rect = $preview.Current.BoundingRectangle
    $w2 = [int]$rect.Width; $h2 = [int]$rect.Height
    $bmp = New-Object System.Drawing.Bitmap($w2, $h2)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, (New-Object System.Drawing.Size($w2, $h2)))
    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "CAPTURED: $OutFile"
} finally {
    $p.Kill(); Start-Sleep -Seconds 1
    if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
}
