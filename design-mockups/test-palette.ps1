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
  $palBtn = $null
  for ($i = 1; $i -le 8; $i++) {
    Start-Sleep -Seconds 2
    $p.Refresh()
    if ($p.HasExited) { Write-Output ("DIED at ~{0}s" -f ($i * 2)); return }
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    $palBtn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '命令面板'
    if ($null -ne $palBtn) { Write-Output ("palette button at ~{0}s" -f ($i * 2)); break }
  }
  if ($null -eq $palBtn) { Write-Output 'palette button never found'; return }

  ($palBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 2

  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $input = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) '输入命令…'
  Write-Output ('palette input found: ' + ($null -ne $input))
  if ($null -eq $input) { return }

  ($input.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('分支')
  Start-Sleep -Seconds 2

  $items = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
  Write-Output ('list items: ' + $items.Count)
  foreach ($it in $items) { Write-Output ('  item: ' + $it.Current.Name) }
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
