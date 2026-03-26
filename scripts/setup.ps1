# brosearch setup script (Windows PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = "Continue"
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ROOT = Split-Path -Parent $ScriptDir
Set-Location $ROOT

Write-Host "=== brosearch setup ===" -ForegroundColor Cyan
Write-Host "Root: $ROOT"
Write-Host ""

# ── Pre-flight: check dependencies ──────────────────────────────────────────
Write-Host "Checking dependencies..."
$missing = 0

# Python
$pyCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pyCmd = "python"
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    $pyCmd = "python3"
}

if (-not $pyCmd) {
    Write-Host "  [x] Python not found" -ForegroundColor Red
    Write-Host "      Install: https://www.python.org/downloads/ (>= 3.10)"
    $missing++
} else {
    $pyVer = & $pyCmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
    $pyMajor = & $pyCmd -c "import sys; print(sys.version_info.major)" 2>$null
    $pyMinor = & $pyCmd -c "import sys; print(sys.version_info.minor)" 2>$null
    if ([int]$pyMajor -lt 3 -or ([int]$pyMajor -eq 3 -and [int]$pyMinor -lt 10)) {
        Write-Host "  [x] Python $pyVer too old, need >= 3.10" -ForegroundColor Red
        Write-Host "      Install: https://www.python.org/downloads/"
        $missing++
    } else {
        Write-Host "  [ok] Python $pyVer" -ForegroundColor Green
    }
}

# pip
$pipCmd = $null
$pipIsModule = $false
if (Get-Command pip -ErrorAction SilentlyContinue) {
    $pipCmd = "pip"
    Write-Host "  [ok] pip" -ForegroundColor Green
} elseif (Get-Command pip3 -ErrorAction SilentlyContinue) {
    $pipCmd = "pip3"
    Write-Host "  [ok] pip3" -ForegroundColor Green
} elseif ($pyCmd) {
    & $pyCmd -m pip --version 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $pipCmd = $pyCmd
        $pipIsModule = $true
        Write-Host "  [ok] $pyCmd -m pip" -ForegroundColor Green
    } else {
        Write-Host "  [x] pip not found" -ForegroundColor Red
        Write-Host "      Install: $pyCmd -m ensurepip --upgrade"
        $missing++
    }
} else {
    Write-Host "  [x] pip not found" -ForegroundColor Red
    $missing++
}

# Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = (node -v 2>$null) -replace '^v', ''
    $nodeMajor = [int]($nodeVer -split '\.')[0]
    if ($nodeMajor -lt 18) {
        Write-Host "  [x] Node.js $nodeVer too old, need >= 18" -ForegroundColor Red
        Write-Host "      Install: https://nodejs.org/"
        $missing++
    } else {
        Write-Host "  [ok] Node.js $nodeVer" -ForegroundColor Green
    }
} else {
    Write-Host "  [x] Node.js not found" -ForegroundColor Red
    Write-Host "      Install: https://nodejs.org/ (>= 18)"
    $missing++
}

# npm
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmVer = npm -v 2>$null
    Write-Host "  [ok] npm $npmVer" -ForegroundColor Green
} else {
    Write-Host "  [x] npm not found (should come with Node.js)" -ForegroundColor Red
    $missing++
}

Write-Host ""
if ($missing -gt 0) {
    Write-Host "Setup aborted: missing dependencies. Install them and retry." -ForegroundColor Red
    exit 1
}

# ── Step 1: Python package ──────────────────────────────────────────────────
Write-Host "[1/3] Installing Python package..." -ForegroundColor Yellow
if ($pipIsModule) {
    $pipOut = & $pipCmd -m pip install -e $ROOT 2>&1 | Out-String
} else {
    $pipOut = & $pipCmd install -e $ROOT 2>&1 | Out-String
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED: pip install error:" -ForegroundColor Red
    Write-Host ($pipOut.Trim() -split "`n" | Select-Object -Last 3 | ForEach-Object { "  $_" }) -ForegroundColor Red
    exit 1
}
& $pyCmd -m brosearch --help 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED: 'python -m brosearch' not working after install" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: python -m brosearch works" -ForegroundColor Green

# ── Step 2: Build daemon ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/3] Building daemon..." -ForegroundColor Yellow
Set-Location "$ROOT\packages\daemon"

# npm install
Write-Host "  Running npm install..."
npm install --include=dev 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED: npm install error (exit code $LASTEXITCODE)" -ForegroundColor Red
    Set-Location $ROOT
    exit 1
}

# Verify typescript installed
$tscBin = "$ROOT\packages\daemon\node_modules\.bin\tsc"
$tscNode = "$ROOT\packages\daemon\node_modules\typescript\bin\tsc"
if (-not (Test-Path "$ROOT\packages\daemon\node_modules\typescript")) {
    Write-Host "  FAILED: typescript not found in node_modules after npm install" -ForegroundColor Red
    Write-Host "  Try manually: cd packages\daemon && npm install typescript" -ForegroundColor Yellow
    Set-Location $ROOT
    exit 1
}

# Compile - use node to call tsc directly (bypasses npx/npm script resolution)
Write-Host "  Compiling TypeScript..."
$tscOut = node "$tscNode" 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED: TypeScript compile error:" -ForegroundColor Red
    Write-Host $tscOut -ForegroundColor Red
    Set-Location $ROOT
    exit 1
}
Write-Host "  OK: daemon built" -ForegroundColor Green
Set-Location $ROOT

# ── Step 3: Start daemon ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/3] Starting daemon..." -ForegroundColor Yellow
& $pyCmd -m brosearch daemon --stop 2>&1 | Out-Null
& $pyCmd -m brosearch daemon -b 2>&1

# ── Chrome extension reminder ───────────────────────────────────────────────
Write-Host ""
Write-Host "=== Chrome extension (manual step) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Open chrome://extensions/"
Write-Host "  2. Enable 'Developer mode' (top-right toggle)"
Write-Host "  3. Click 'Load unpacked'"
Write-Host "  4. Select: $ROOT\packages\extension"
Write-Host ""
Write-Host "  # Verify"
Write-Host "  python -m brosearch doctor"
Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
