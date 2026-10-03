# verify-s3.ps1 — S3 · DiffCanvas 渲染一键验证
# 用法:  powershell -ExecutionPolicy Bypass -File scripts\verify-s3.ps1
# 输出:  构建（零警告）→ 全量测试 → 渲染管线测试清单 → 性能基准数值
#
# 渲染视觉检查（10 个真实仓库 20 个真实 diff）为人工步骤：
#   运行 scripts\smoke-diff-preview.ps1 自动化链路冒烟后，
#   通过 设置 → "打开 Diff 渲染预览（S3 验证）" 人眼核对行对齐。

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$fail = 0

function Step($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }

# ---- 1. 构建（零警告零错误）----
Step '1. dotnet build (Core + Diff + Controls + App + Git + Shell + Tests)'
$buildOut = @()
foreach ($proj in @(
    'src/GitUI.Core/GitUI.Core.csproj',
    'src/GitUI.Diff/GitUI.Diff.csproj',
    'src/GitUI.Controls/GitUI.Controls.csproj',
    'src/GitUI.Git/GitUI.Git.csproj',
    'src/GitUI.Shell/GitUI.Shell.csproj',
    'src/GitUI.App/GitUI.App.csproj',
    'tests/GitUI.Core.Tests/GitUI.Core.Tests.csproj',
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

# ---- 2. 全量测试 ----
Step '2. dotnet test (全解决方案)'
dotnet test GitUI.sln --nologo --no-build 2>&1 | Tee-Object -Variable testOut
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$testOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }

# ---- 3. 渲染管线测试（Headless：模型 + 几何 + 像素）----
Step '3. Headless 渲染管线测试（GitUI.Render.Tests）'
dotnet test tests/GitUI.Render.Tests/GitUI.Render.Tests.csproj --nologo --no-build 2>&1 | Tee-Object -Variable renderOut | Out-Null
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$renderOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }

# ---- 4. 性能基准（RenderPerformanceTests 写入临时日志）----
Step '4. 性能基准（10k 行 diff 首帧 / 滚动帧预算）'
$perfLog = Join-Path $env:TEMP 'gitui-render-perf.log'
if (Test-Path $perfLog) { Remove-Item $perfLog -Force }
dotnet test tests/GitUI.Render.Tests/GitUI.Render.Tests.csproj --nologo --no-build `
    --filter "FullyQualifiedName~RenderPerformanceTests" 2>&1 | Tee-Object -Variable perfOut | Out-Null
if ($LASTEXITCODE -ne 0) { $fail = 1 }
$perfOut | Select-String '已通过!|失败!' | ForEach-Object { Write-Host $_ }
if (Test-Path $perfLog) {
    Write-Host '--- 基准数值 ---'
    Get-Content $perfLog | ForEach-Object { Write-Host $_ }
} else {
    Write-Host '警告: 未找到性能日志' -ForegroundColor Yellow
}

Write-Host ''
if ($fail -ne 0) {
    Write-Host 'VERIFY-S3 FAIL' -ForegroundColor Red
    exit 1
}
Write-Host 'VERIFY-S3 PASS' -ForegroundColor Green
