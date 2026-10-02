$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath) | Out-Null
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }

$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
$windowRect = $root.Current.BoundingRectangle
Write-Output ('Window: x=' + [int]$windowRect.X + ' y=' + [int]$windowRect.Y + ' w=' + [int]$windowRect.Width + ' h=' + [int]$windowRect.Height)
Write-Output ''

$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output ('Total descendants: ' + $all.Count)
foreach ($el in $all) {
    $rt = $el.Current
    $r = $rt.BoundingRectangle
    try { $x = [int]$r.X } catch { $x = 'NaN' }
    try { $y = [int]$r.Y } catch { $y = 'NaN' }
    try { $w = [int]$r.Width } catch { $w = 'NaN' }
    try { $h = [int]$r.Height } catch { $h = 'NaN' }
    Write-Output ('  ' + $rt.ControlType.ProgrammaticName + ' class=' + $rt.ClassName + ' name=''' + $rt.Name + ''' x=' + $x + ' y=' + $y + ' w=' + $w + ' h=' + $h)
}

$p.Kill()
Start-Sleep -Seconds 1
if (Test-Path $settingsPath) { Remove-Item $settingsPath -Force }
