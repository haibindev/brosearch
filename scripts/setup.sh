#!/usr/bin/env bash
# brosearch setup script
# Usage: bash scripts/setup.sh

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "=== brosearch setup ==="
echo "Root: $ROOT"
echo ""

# ── Pre-flight: check dependencies ───────────────────────────────────────────
echo "Checking dependencies..."
MISSING=0

# Python
if command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo "  [x] Python not found" >&2
    echo "      Install: https://www.python.org/downloads/ (>= 3.10)" >&2
    MISSING=1
fi

if [ "$MISSING" -eq 0 ]; then
    PY_VER=$($PY -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
    PY_MAJOR=$($PY -c "import sys; print(sys.version_info.major)" 2>/dev/null)
    PY_MINOR=$($PY -c "import sys; print(sys.version_info.minor)" 2>/dev/null)
    if [ "${PY_MAJOR:-0}" -lt 3 ] || { [ "${PY_MAJOR:-0}" -eq 3 ] && [ "${PY_MINOR:-0}" -lt 10 ]; }; then
        echo "  [x] Python $PY_VER too old, need >= 3.10" >&2
        echo "      Install: https://www.python.org/downloads/" >&2
        MISSING=1
    else
        echo "  [ok] Python $PY_VER"
    fi
fi

# pip
if command -v pip &>/dev/null; then
    PIP=pip
    echo "  [ok] pip"
elif command -v pip3 &>/dev/null; then
    PIP=pip3
    echo "  [ok] pip3"
elif [ -n "$PY" ] && $PY -m pip --version &>/dev/null; then
    PIP="$PY -m pip"
    echo "  [ok] $PY -m pip"
else
    echo "  [x] pip not found" >&2
    echo "      Install: $PY -m ensurepip --upgrade" >&2
    MISSING=1
fi

# Node.js
if command -v node &>/dev/null; then
    NODE_VER=$(node -v 2>/dev/null | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
    if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
        echo "  [x] Node.js $NODE_VER too old, need >= 18" >&2
        echo "      Install: https://nodejs.org/" >&2
        MISSING=1
    else
        echo "  [ok] Node.js $NODE_VER"
    fi
else
    echo "  [x] Node.js not found" >&2
    echo "      Install: https://nodejs.org/ (>= 18)" >&2
    MISSING=1
fi

# npm
if command -v npm &>/dev/null; then
    echo "  [ok] npm $(npm -v 2>/dev/null)"
else
    echo "  [x] npm not found (should come with Node.js)" >&2
    MISSING=1
fi

echo ""
if [ "$MISSING" -ne 0 ]; then
    echo "Setup aborted: missing dependencies. Install them and retry." >&2
    exit 1
fi

# ── Step 1: Python package ───────────────────────────────────────────────────
echo "[1/3] Installing Python package..."
$PIP install -e "$ROOT" --quiet 2>&1 | tail -3
$PY -m brosearch --help >/dev/null 2>&1
echo "  OK: python -m brosearch works"

# ── Step 2: Build daemon ─────────────────────────────────────────────────────
echo ""
echo "[2/3] Building daemon..."
cd "$ROOT/packages/daemon"

echo "  Running npm install..."
npm install 2>&1 | sed 's/^/  /'
if [ $? -ne 0 ]; then
    echo "  FAILED: npm install error" >&2
    exit 1
fi

# Verify typescript installed
TSC_NODE="$ROOT/packages/daemon/node_modules/typescript/bin/tsc"
if [ ! -f "$TSC_NODE" ]; then
    echo "  FAILED: typescript not found in node_modules after npm install" >&2
    echo "  Try manually: cd packages/daemon && npm install typescript" >&2
    exit 1
fi

echo "  Compiling TypeScript..."
node "$TSC_NODE" 2>&1 | sed 's/^/  /'
if [ $? -ne 0 ]; then
    echo "  FAILED: TypeScript compile error" >&2
    exit 1
fi
echo "  OK: daemon built"
cd "$ROOT"

# ── Step 3: Start daemon ─────────────────────────────────────────────────────
echo ""
echo "[3/3] Starting daemon..."
$PY -m brosearch daemon --stop 2>/dev/null || true
$PY -m brosearch daemon -b

# ── Chrome extension reminder ────────────────────────────────────────────────
echo ""
echo "=== Chrome extension (manual step) ==="
echo ""
echo "  1. Open chrome://extensions/"
echo "  2. Enable 'Developer mode' (top-right toggle)"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $ROOT/packages/extension"
echo ""
echo "  # Verify"
echo "  python -m brosearch doctor"
echo ""
echo "Setup complete!"
