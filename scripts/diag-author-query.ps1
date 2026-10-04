$settingsPath = Join-Path $env:APPDATA 'GitUI\settings.json'
$proj = @{ path = 'D:\Code\Gitter'; name = 'Gitter'; addedAt = (Get-Date).ToString('o'); lastOpenedAt = (Get-Date).ToString('o') }
@{ currentProjectPath = 'D:\Code\Gitter'; theme = 2; projects = @($proj) } | ConvertTo-Json -Depth 4 | Set-Content $settingsPath -Encoding UTF8
Add-Type -AssemblyName UIAutomationClient

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
  $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  $search = Find-ByName $main ([System.Windows.Automation.ControlType]::Edit) 'Log 搜索'
  if ($null -eq $search) { Write-Output 'FAIL: 搜索框未找到'; return }

  foreach ($q in @('author:wyndam', 'author:nonexistent-xyz', 'author:wyndam')) {
    ($search.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($q)
    $btn = Find-ByName $main ([System.Windows.Automation.ControlType]::Button) '搜索'
    ($btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Start-Sleep -Seconds 8
    $main = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
    $texts = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Text)))
    $status = ''
    foreach ($t in $texts) {
      $n = $t.Current.Name
      if ($n -and $n.StartsWith('已加载')) { $status = $n; break }
    }
    Write-Output ("query=" + $q + " → " + $status)
  }
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
