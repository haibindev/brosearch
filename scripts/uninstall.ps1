# brosearch uninstall script (Windows PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 [-All]

param(
    [switch]$All
)

$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ROOT = Split-Path -Parent $ScriptDir

Write-Host "=== brosearch uninstall ===" -ForegroundColor Cyan
Write-Host "Root: $ROOT"
Write-Host ""

# Step 1: Stop daemon
Write-Host "[1/4] Stopping daemon..." -ForegroundColor Yellow
$procs = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*brosearch*daemon*"
}
if ($procs) {
    $procs | Stop-Process -Force
    Write-Host "  Daemon stopped" -ForegroundColor Green
} else {
    Write-Host "  Daemon not running"
}

# Step 2: Uninstall Python package
Write-Host ""
Write-Host "[2/4] Uninstalling Python package..." -ForegroundColor Yellow
$installed = pip show brosearch 2>$null
if ($installed) {
    pip uninstall brosearch -y 2>&1 | Select-Object -Last 1
    Write-Host "  OK: pip package removed" -ForegroundColor Green
} else {
    Write-Host "  SKIP: brosearch not installed via pip"
}

# Step 3: Clean build artifacts
Write-Host ""
Write-Host "[3/4] Cleaning build artifacts..." -ForegroundColor Yellow
$ErrorActionPreference = "SilentlyContinue"
if (Test-Path "$ROOT\packages\daemon\node_modules") {
    Remove-Item "$ROOT\packages\daemon\node_modules" -Recurse -Force
    Write-Host "  Removed daemon node_modules"
}
if (Test-Path "$ROOT\packages\daemon\dist") {
    Remove-Item "$ROOT\packages\daemon\dist" -Recurse -Force
    Write-Host "  Removed daemon dist"
}
if (Test-Path "$ROOT\brosearch.egg-info") {
    Remove-Item "$ROOT\brosearch.egg-info" -Recurse -Force
    Write-Host "  Removed egg-info"
}
Get-ChildItem "$ROOT" -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
Write-Host "  Cleaned __pycache__"

# Step 4: Remove source (optional)
Write-Host ""
if ($All) {
    Write-Host "[4/4] Removing source directory..." -ForegroundColor Yellow
    Write-Host "  Will remove: $ROOT"
    Set-Location $env:USERPROFILE
    Remove-Item $ROOT -Recurse -Force
    Write-Host "  OK: source directory removed" -ForegroundColor Green
} else {
    Write-Host "[4/4] Source code kept at: $ROOT"
    Write-Host "  Run with -All to also remove source code"
}

# Done
Write-Host ""
Write-Host "=== Uninstall complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Manual step: remove Chrome extension"
Write-Host "  chrome://extensions/ -> find brosearch -> click 'Remove'"
Write-Host ""
