#!/usr/bin/env bash
# brosearch uninstall script
# Usage: bash scripts/uninstall.sh [--all]
#
# Without --all: removes installed packages only (keeps source code)
# With --all:    also removes the brosearch source directory

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

ALL=false
if [ "$1" = "--all" ]; then ALL=true; fi

echo "=== brosearch uninstall ==="
echo "Root: $ROOT"
echo ""

# ── Step 1: Stop daemon ──────────────────────────────────────────────────────
echo "[1/4] Stopping daemon..."
if command -v pkill &>/dev/null; then
    pkill -f "node.*brosearch.*daemon" 2>/dev/null && echo "  Daemon stopped" || echo "  Daemon not running"
else
    echo "  SKIP: pkill not available, stop daemon manually"
fi

# ── Step 2: Uninstall Python package ─────────────────────────────────────────
echo ""
echo "[2/4] Uninstalling Python package..."
if pip show brosearch &>/dev/null 2>&1; then
    pip uninstall brosearch -y 2>&1 | tail -1
    echo "  OK: pip package removed"
elif pip3 show brosearch &>/dev/null 2>&1; then
    pip3 uninstall brosearch -y 2>&1 | tail -1
    echo "  OK: pip package removed"
else
    echo "  SKIP: brosearch not installed via pip"
fi

# ── Step 3: Clean build artifacts ────────────────────────────────────────────
echo ""
echo "[3/4] Cleaning build artifacts..."
rm -rf "$ROOT/packages/daemon/node_modules" && echo "  Removed daemon node_modules"
rm -rf "$ROOT/packages/daemon/dist" && echo "  Removed daemon dist"
rm -rf "$ROOT/brosearch.egg-info" && echo "  Removed egg-info"
find "$ROOT" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
echo "  Cleaned __pycache__"

# ── Step 4: Remove source (optional) ────────────────────────────────────────
echo ""
if [ "$ALL" = true ]; then
    echo "[4/4] Removing source directory..."
    echo "  Will remove: $ROOT"
    cd /
    rm -rf "$ROOT"
    echo "  OK: source directory removed"
else
    echo "[4/4] Source code kept at: $ROOT"
    echo "  Run with --all to also remove source code"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== Uninstall complete ==="
echo ""
echo "Manual step: remove Chrome extension"
echo "  chrome://extensions/ → find brosearch → click 'Remove'"
echo ""
