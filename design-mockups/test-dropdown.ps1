$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
$proj = @{ path = 'D:\Code\Gitter'; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{ currentProjectPath = 'D:\Code\Gitter'; theme = 2; projects = @($proj) } | ConvertTo-Json -Depth 4 | Set-Content $settingsPath -Encoding UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$exe = 'D:\Code\Gitter\src\GitUI.App\bin\Debug\net8.0-windows10.0.19041.0\GitUI.App.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

function Find-ByName($root, $type, $name) {
  $c = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)))
  $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
}

try {
  $combo = $null
  for ($i = 1; $i -le 8; $i++) {
    Start-Sleep -Seconds 2
    $p.Refresh()
    if ($p.HasExited) { Write-Output ("DIED at ~{0}s" -f ($i * 2)); return }
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    $combo = Find-ByName $main ([System.Windows.Automation.ControlType]::ComboBox) '分支选择'
    if ($null -ne $combo) { Write-Output ("combo at ~{0}s" -f ($i * 2)); break }
  }
  if ($null -eq $combo) { Write-Output 'combo never found'; return }

  ($combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Expand()
  Start-Sleep -Seconds 2

  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $items = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
  $names = @()
  foreach ($it in $items) {
    if ($it.Current.Name) { $names += $it.Current.Name }
  }
  Write-Output ('dropdown items: ' + ($names -join ' | '))

  ($combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Collapse()
  Start-Sleep -Seconds 1
  $p.Refresh()
  Write-Output ('alive after collapse: ' + (-not $p.HasExited))
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
