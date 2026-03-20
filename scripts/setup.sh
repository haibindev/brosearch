#!/usr/bin/env bash
# brosearch one-line setup script
# Usage: bash scripts/setup.sh
#
# What it does:
# 1. Install Python package (pip install -e .)
# 2. Install Node dependencies & build daemon
# 3. Print next steps (Chrome extension must be loaded manually)

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "=== brosearch setup ==="
echo "Root: $ROOT"
echo ""

# ── Step 1: Python package ──────────────────────────────────────────────────
echo "[1/3] Installing Python package..."
if command -v pip &>/dev/null; then
    pip install -e "$ROOT" --quiet 2>&1 | tail -1
elif command -v pip3 &>/dev/null; then
    pip3 install -e "$ROOT" --quiet 2>&1 | tail -1
else
    echo "  WARNING: pip not found, add to PYTHONPATH manually:"
    echo "  export PYTHONPATH=$ROOT:\$PYTHONPATH"
fi
# Verify
python -m brosearch --help >/dev/null 2>&1 && echo "  OK: python -m brosearch works" || echo "  WARNING: python -m brosearch not working"

# ── Step 2: Node daemon ────────────────────────────────────────────────────
echo ""
echo "[2/3] Building daemon..."
if command -v node &>/dev/null; then
    cd "$ROOT/packages/daemon"
    if [ ! -d node_modules ]; then
        npm install --silent 2>&1 | tail -1
    fi
    npx -p typescript tsc 2>&1 | tail -1
    echo "  OK: daemon built at packages/daemon/dist/"
    cd "$ROOT"
else
    echo "  WARNING: node not found. Daemon requires Node.js >= 18."
    echo "  Install: https://nodejs.org/"
fi

# ── Step 3: Instructions ───────────────────────────────────────────────────
echo ""
echo "[3/3] Chrome extension (manual step)"
echo ""
echo "  1. Open chrome://extensions/"
echo "  2. Enable 'Developer mode' (top-right toggle)"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $ROOT/packages/extension"
echo ""
echo "=== Quick start ==="
echo ""
echo "  # Start daemon (keep running in background)"
if command -v node &>/dev/null; then
    echo "  node $ROOT/packages/daemon/dist/index.js &"
fi
echo ""
echo "  # Verify everything"
echo "  python -m brosearch doctor"
echo ""
echo "  # Test (after loading extension & opening any tab)"
echo "  python -m brosearch eval --js 'return document.title'"
echo ""
echo "Done!"
