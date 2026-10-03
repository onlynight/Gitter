# verify-s4.ps1 — S4 · Log 页一键验证
# 用法:  powershell -ExecutionPolicy Bypass -File scripts\verify-s4.ps1
# 输出:  构建（零警告）→ 全量测试（除性能）→ 100k 性能基准数值
#
# UIA 冒烟（搜索 → 分组 → 点击 → 显示 diff 全链路）为独立步骤：
#   powershell -ExecutionPolicy Bypass -File scripts\smoke-log-page.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$fail = 0

function Step($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }

# ---- 1. 构建（零警告零错误）----
Step '1. dotnet build (Core + ViewModels + Diff + Controls + App + Git + Shell + Tests)'
$buildOut = @()
foreach ($proj in @(
    'src/GitUI.Core/GitUI.Core.csproj',
    'src/GitUI.ViewModels/GitUI.ViewModels.csproj',
    'src/GitUI.Diff/GitUI.Diff.csproj',
    'src/GitUI.Controls/GitUI.Controls.csproj',
    'src/GitUI.Git/GitUI.Git.csproj',
    'src/GitUI.Shell/GitUI.Shell.csproj',
    'src/GitUI.App/GitUI.App.csproj',
    'tests/GitUI.Core.Tests/GitUI.Core.Tests.csproj',
    'tests/GitUI.ViewModels.Tests/GitUI.ViewModels.Tests.csproj',
    'tests/GitUI.Diff.Tests/GitUI.Diff.Tests.csproj',
    'tests/GitUI.Render.Tests/GitUI.Render.Tests.csproj',
    'tests/GitUI.Git.Tests/GitUI.Git.Tests.csproj',
    'tests/GitUI.Shell.Tests/GitUI.Shell.Tests.csproj')) {
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

# ---- 2. 全量测试（性能基准单独跑，避免并行争抢导致基准抖动）----
Step '2. dotnet test (全解决方案, Category != Perf)'
dotnet test GitUI.sln --nologo --no-build --filter "Category!=Perf" 2>&1 | Tee-Object -Variable testOut
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$testOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }

# ---- 3. 性能基准（10 万提交：首屏 50 条 / 下一页）----
Step '3. 性能基准（10 万提交仓库，Log 页全链路）'
$perfLog = Join-Path $env:TEMP 'gitui-log-perf.log'
if (Test-Path $perfLog) { Remove-Item $perfLog -Force }
dotnet test GitUI.sln --nologo --no-build --filter "Category=Perf" 2>&1 | Tee-Object -Variable perfOut | Out-Null
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$perfOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }
if (Test-Path $perfLog) {
    Write-Host '--- 基准数值 ---'
    Get-Content $perfLog | Where-Object { $_ -match '100k|GetLog|fast-import' } | ForEach-Object { Write-Host $_ }
} else {
    Write-Host '警告: 未找到性能日志' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'UIA 冒烟（需 GUI，独立执行）: scripts\smoke-log-page.ps1'
if ($fail -ne 0) {
    Write-Host 'VERIFY-S4 FAIL' -ForegroundColor Red
    exit 1
}
Write-Host 'VERIFY-S4 PASS' -ForegroundColor Green
