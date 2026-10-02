# verify-s2.ps1 — S2 · Diff 引擎（无渲染）一键验证
# 用法:  powershell -ExecutionPolicy Bypass -File scripts\verify-s2.ps1
# 输出:  构建（零警告）→ 全量测试 → 黄金用例清单 → GNU diff -u oracle → 性能基准数值
#
# 默认构建 S2 范围（Core / Diff / Git + 测试项目）并跑全解决方案测试。

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$fail = 0

function Step($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }

# ---- 1. 构建（零警告零错误）----
Step '1. dotnet build (Core + Diff + Git + Tests)'
$buildOut = @()
foreach ($proj in @(
    'src/GitUI.Core/GitUI.Core.csproj',
    'src/GitUI.Diff/GitUI.Diff.csproj',
    'src/GitUI.Git/GitUI.Git.csproj',
    'tests/GitUI.Core.Tests/GitUI.Core.Tests.csproj',
    'tests/GitUI.Diff.Tests/GitUI.Diff.Tests.csproj',
    'tests/GitUI.Git.Tests/GitUI.Git.Tests.csproj')) {
    dotnet build $proj --nologo -v q 2>&1 | Tee-Object -Variable oneOut | Out-Null
    $buildOut += $oneOut
    if ($LASTEXITCODE -ne 0) { break }
}
if ($LASTEXITCODE -ne 0) {
    Write-Host '构建失败:' -ForegroundColor Red
    $buildOut | Select-String 'error' | ForEach-Object { Write-Host $_ }
    $fail = 1
} else {
    $warn = @($buildOut | Select-String 'warning').Count
    Write-Host "构建成功，警告 $warn 个"
    if ($warn -gt 0) { $fail = 1 }
}

# ---- 2. 全量测试 ----
Step '2. dotnet test (全解决方案)'
dotnet test GitUI.sln --nologo --no-build 2>&1 | Tee-Object -Variable testOut
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$testOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }

# ---- 3. 黄金用例清单 ----
Step '3. 黄金用例集（GoldenLineDiffTests，≥30 用例）'
dotnet test tests/GitUI.Diff.Tests/GitUI.Diff.Tests.csproj --nologo --no-build `
    --filter "FullyQualifiedName~GoldenLineDiffTests" 2>&1 | Tee-Object -Variable goldenOut | Out-Null
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$goldenOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }

# ---- 4. GNU diff -u oracle ----
Step '4. GNU diff -u oracle 对照（GnuDiffOracleTests）'
dotnet test tests/GitUI.Diff.Tests/GitUI.Diff.Tests.csproj --nologo --no-build `
    --filter "FullyQualifiedName~GnuDiffOracleTests" 2>&1 | Tee-Object -Variable oracleOut | Out-Null
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$oracleOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }

# ---- 5. 性能基准 ----
Step '5. 性能基准（20k 行 diff < 300ms）'
Remove-Item (Join-Path $env:TEMP 'gitui-diff-perf.log') -Force -ErrorAction SilentlyContinue
dotnet test tests/GitUI.Diff.Tests/GitUI.Diff.Tests.csproj --nologo --no-build `
    --filter "FullyQualifiedName~DiffPerformanceTests" 2>&1 | Tee-Object -Variable perfOut | Out-Null
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$perfOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }

$perfLog = Join-Path $env:TEMP 'gitui-diff-perf.log'
if (Test-Path $perfLog) {
    Write-Host "`n--- 基准数值 ($perfLog) ---"
    Get-Content $perfLog
}

# ---- 结果 ----
Step '结果'
if ($fail -ne 0) {
    Write-Host 'S2 验证失败 X' -ForegroundColor Red
    exit 1
} else {
    Write-Host 'S2 验证通过 V（构建零警告 / 测试全绿 / 黄金用例 / oracle / 性能达标）' -ForegroundColor Green
    exit 0
}
