# brosearch one-line setup script (Windows PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $ROOT) { $ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
Set-Location $ROOT

Write-Host "=== brosearch setup ===" -ForegroundColor Cyan
Write-Host "Root: $ROOT"
Write-Host ""

# Step 1: Python
Write-Host "[1/3] Installing Python package..." -ForegroundColor Yellow
try {
    pip install -e $ROOT --quiet 2>&1 | Select-Object -Last 1
    python -m brosearch --help | Out-Null
    Write-Host "  OK: python -m brosearch works" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: pip install failed. Set PYTHONPATH=$ROOT manually." -ForegroundColor Red
}

# Step 2: Node daemon
Write-Host ""
Write-Host "[2/3] Building daemon..." -ForegroundColor Yellow
try {
    Set-Location "$ROOT\packages\daemon"
    if (-not (Test-Path "node_modules")) {
        npm install --silent 2>&1 | Select-Object -Last 1
    }
    npx -p typescript tsc 2>&1 | Select-Object -Last 1
    Write-Host "  OK: daemon built" -ForegroundColor Green
    Set-Location $ROOT
} catch {
    Write-Host "  WARNING: Node.js not found or build failed." -ForegroundColor Red
    Write-Host "  Install Node.js >= 18: https://nodejs.org/"
    Set-Location $ROOT
}

# Step 3: Instructions
Write-Host ""
Write-Host "[3/3] Chrome extension (manual step)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Open chrome://extensions/"
Write-Host "  2. Enable 'Developer mode' (top-right toggle)"
Write-Host "  3. Click 'Load unpacked'"
Write-Host "  4. Select: $ROOT\packages\extension"
Write-Host ""
Write-Host "=== Quick start ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  # Start daemon"
Write-Host "  node $ROOT\packages\daemon\dist\index.js"
Write-Host ""
Write-Host "  # Verify"
Write-Host "  python -m brosearch doctor"
Write-Host ""
Write-Host "Done!" -ForegroundColor Green
