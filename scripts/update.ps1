# brosearch update script (Windows PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\update.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ROOT = Split-Path -Parent $ScriptDir
Set-Location $ROOT

Write-Host "=== brosearch update ===" -ForegroundColor Cyan
Write-Host "Root: $ROOT"
Write-Host ""

# Step 1: Pull
Write-Host "[1/3] Pulling latest code..." -ForegroundColor Yellow
try {
    $before = git rev-parse HEAD 2>$null
    git pull --ff-only 2>&1 | Select-Object -Last 3
    $after = git rev-parse HEAD 2>$null
    if ($before -eq $after) {
        Write-Host "  Already up to date."
    } else {
        Write-Host "  Updated." -ForegroundColor Green
    }
} catch {
    Write-Host "  WARNING: git pull failed" -ForegroundColor Red
}

# Step 2: Python
Write-Host ""
Write-Host "[2/3] Updating Python package..." -ForegroundColor Yellow
try {
    pip install -e $ROOT --quiet 2>&1 | Select-Object -Last 1
    Write-Host "  OK" -ForegroundColor Green
} catch {
    Write-Host "  SKIP: pip not available" -ForegroundColor Red
}

# Step 3: Daemon
Write-Host ""
Write-Host "[3/3] Rebuilding daemon..." -ForegroundColor Yellow
try {
    Set-Location "$ROOT\packages\daemon"
    npm install --include=dev --silent 2>&1 | Select-Object -Last 1
    npm run build 2>&1 | Select-Object -Last 1
    Write-Host "  OK: daemon rebuilt" -ForegroundColor Green
    Set-Location $ROOT
} catch {
    Write-Host "  WARNING: daemon build failed" -ForegroundColor Red
    Set-Location $ROOT
}

# Done
Write-Host ""
Write-Host "=== Update complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart daemon:          node $ROOT\packages\daemon\dist\index.js"
Write-Host "  2. Refresh Chrome extension: chrome://extensions/ -> click refresh icon"
Write-Host ""
