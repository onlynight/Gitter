# verify-s1.ps1 — S1 · 领域模型与 Git 读取层 一键验证
# 用法:  powershell -ExecutionPolicy Bypass -File scriptserify-s1.ps1
#        powershell -ExecutionPolicy Bypass -File scriptserify-s1.ps1 -FullSolution
# 输出:  构建（零警告）→ 全量测试 → 20 拓扑清单 → 性能基准数值
#
# 默认只构建 S1 范围（GitUI.Core / GitUI.Git / 测试项目）。
# -FullSolution 构建整个 GitUI.sln（含 GitUI.App / GitUI.Shell，作为阶段门禁时使用）。

param(
    [switch]$FullSolution
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$fail = 0

function Step($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }

# ---- 1. 构建（零警告零错误）----
if ($FullSolution) {
    Step '1. dotnet build (GitUI.sln 全解决方案)'
    dotnet build GitUI.sln --nologo -v q 2>&1 | Tee-Object -Variable buildOut | Out-Null
} else {
    Step '1. dotnet build (Core + Git + Tests)'
    $buildOut = @()
    foreach ($proj in @(
        'src/GitUI.Core/GitUI.Core.csproj',
        'src/GitUI.Git/GitUI.Git.csproj',
        'tests/GitUI.Core.Tests/GitUI.Core.Tests.csproj',
        'tests/GitUI.Git.Tests/GitUI.Git.Tests.csproj')) {
        dotnet build $proj --nologo -v q 2>&1 | Tee-Object -Variable oneOut | Out-Null
        $buildOut += $oneOut
        if ($LASTEXITCODE -ne 0) { break }
    }
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
Step '2. dotnet test (全部测试项目)'
dotnet test GitUI.sln --nologo --no-build 2>&1 | Tee-Object -Variable testOut
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$testOut | Select-String '已通过|失败' | ForEach-Object { Write-Host $_ }

# ---- 3. 20 拓扑参数化清单 ----
Step '3. 20 拓扑参数化测试（每个拓扑 2 个用例）'
dotnet test tests/GitUI.Git.Tests/GitUI.Git.Tests.csproj --nologo --no-build `
    --filter "FullyQualifiedName~TopologyParameterizedTests" 2>&1 | Tee-Object -Variable topoOut
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$topoOut | Select-String '已通过|失败' | ForEach-Object { Write-Host $_ }

# ---- 4. 性能基准 ----
Step '4. 性能基准（10k 提交：GetLog 首屏 < 500ms）'
Remove-Item (Join-Path $env:TEMP 'gitui-perf.log') -Force -ErrorAction SilentlyContinue
dotnet test tests/GitUI.Git.Tests/GitUI.Git.Tests.csproj --nologo --no-build `
    --filter "FullyQualifiedName~PerformanceTests" 2>&1 | Tee-Object -Variable perfOut
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$perfOut | Select-String '已通过|失败' | ForEach-Object { Write-Host $_ }

$perfLog = Join-Path $env:TEMP 'gitui-perf.log'
if (Test-Path $perfLog) {
    Write-Host "`n--- 基准数值 ($perfLog) ---"
    Get-Content $perfLog
}

# ---- 结果 ----
Step '结果'
if ($fail -ne 0) {
    Write-Host 'S1 验证失败 X' -ForegroundColor Red
    exit 1
} else {
    Write-Host 'S1 验证通过 V（构建零警告 / 测试全绿 / 20 拓扑 / 性能达标）' -ForegroundColor Green
    exit 0
}
