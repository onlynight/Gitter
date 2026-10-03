# check-uia-conventions.ps1 - UIA 无障碍约定静态检查（known-issues 2.4）
# 规则：承载文本的 TextBlock 变量不得传入 AutomationProperties.SetName ——
# WinUI 投影下显式 Name 会覆盖 TextBlock 的动态内容（屏幕阅读器读不到真实文本，
# UIA 冒烟的"Name=内容"锚点也会失效，§11.14/§11.15 两次踩中）。
# 用法: powershell -ExecutionPolicy Bypass -File scripts\check-uia-conventions.ps1
# 退出码: 0 = 通过；1 = 存在违规

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$files = Get-ChildItem (Join-Path $root 'src\GitUI.App') -Recurse -Filter *.cs

$violations = New-Object System.Collections.Generic.List[string]

foreach ($f in $files) {
    $content = [IO.File]::ReadAllText($f.FullName)
    $lines = $content -split "`n"

    # 收集声明为 TextBlock 的变量/字段名（_x = new TextBlock / TextBlock x = new ...）
    $textBlockVars = New-Object System.Collections.Generic.HashSet[string]
    foreach ($line in $lines) {
        if ($line -match '([A-Za-z_]\w*)\s*=\s*new\s+TextBlock\b') {
            [void]$textBlockVars.Add($Matches[1])
        }
        if ($line -match '\bTextBlock\s+([A-Za-z_]\w*)\s*[=;]') {
            [void]$textBlockVars.Add($Matches[1])
        }
    }
    if ($textBlockVars.Count -eq 0) { continue }

    # SetName 第一参为 TextBlock 变量 → 违规
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match 'AutomationProperties\.SetName\(\s*([A-Za-z_]\w*)\s*,') {
            $target = $Matches[1]
            if ($textBlockVars.Contains($target)) {
                $violations.Add("$($f.Name):$($i + 1): SetName 目标 '$target' 是 TextBlock（动态文本不得设显式 Name）")
            }
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Output 'UIA 约定违规：'
    $violations | ForEach-Object { Write-Output ("  " + $_) }
    exit 1
}
Write-Output 'UIA 约定检查通过（无 TextBlock 显式 SetName）'
exit 0
