# publish.ps1 - S7 自包含单目录发布（design.md §3.1：自包含 exe，无沙箱）
# 用法: powershell -ExecutionPolicy Bypass -File scripts\publish.ps1
# 产物: publish\GitUI.App.exe（含 .NET 运行时与 Windows App SDK 自包含，可直接拷贝运行）

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$sw = [System.Diagnostics.Stopwatch]::StartNew()
dotnet publish src/GitUI.App/GitUI.App.csproj `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -o publish `
    --nologo -v q
if ($LASTEXITCODE -ne 0) {
    Write-Host 'PUBLISH FAIL' -ForegroundColor Red
    exit 1
}
$sw.Stop()

$exe = Join-Path $root 'publish\GitUI.App.exe'
if (-not (Test-Path $exe)) {
    Write-Host "PUBLISH FAIL: 未找到 $exe" -ForegroundColor Red
    exit 1
}
$size = [math]::Round((Get-ChildItem (Join-Path $root 'publish') -Recurse | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ("PUBLISH OK: publish\GitUI.App.exe ({0} MB, {1}s)" -f $size, [int]$sw.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host '提示: 冒烟验证发布产物 → scripts\smoke-log-page.ps1 -Exe publish\GitUI.App.exe'
