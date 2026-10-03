# verify-s6.ps1 — S6 · Branches 页与危险操作确认一键验证
# 用法:  powershell -ExecutionPolicy Bypass -File scripts\verify-s6.ps1
# 输出:  构建（零警告）→ 全量测试（除性能）→ UIA 冒烟（检出 + 删除确认 N 值 + 终态）

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$fail = 0

function Step($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }

# ---- 1. 构建（零警告零错误）----
Step '1. dotnet build (全解决方案)'
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

# ---- 2. 全量测试（性能基准单独跑，避免并行争抢）----
Step '2. dotnet test (全解决方案, Category != Perf)'
dotnet test GitUI.sln --nologo --no-build --filter "Category!=Perf" 2>&1 | Tee-Object -Variable testOut
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$testOut | Select-String '已通过!|失败!' | Select-Object -Last 6 | ForEach-Object { Write-Host $_ }

# ---- 3. UIA 冒烟 ----
Step '3. UIA 冒烟（smoke-branches-page）'
powershell -ExecutionPolicy Bypass -File scripts/smoke-branches-page.ps1 2>&1 | Tee-Object -Variable smokeOut | Out-Null
$smokeOut | ForEach-Object { Write-Host $_ }
if (-not ($smokeOut -match 'SMOKE-BRANCHES-PAGE PASS')) { $fail = 1 }

Write-Host ''
if ($fail -ne 0) {
    Write-Host 'VERIFY-S6 FAIL' -ForegroundColor Red
    exit 1
}
Write-Host 'VERIFY-S6 PASS' -ForegroundColor Green
