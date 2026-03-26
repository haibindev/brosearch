#!/usr/bin/env bash
# brosearch update script
# Usage: bash scripts/update.sh

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "=== brosearch update ==="
echo "Root: $ROOT"
echo ""

# ── Step 1: Pull latest code ─────────────────────────────────────────────────
echo "[1/3] Pulling latest code..."
if git rev-parse --is-inside-work-tree &>/dev/null; then
    BEFORE=$(git rev-parse HEAD)
    git pull --ff-only 2>&1 | tail -3
    AFTER=$(git rev-parse HEAD)
    if [ "$BEFORE" = "$AFTER" ]; then
        echo "  Already up to date."
    else
        echo "  Updated: $(git log --oneline "$BEFORE".."$AFTER" | wc -l) new commits"
    fi
else
    echo "  WARNING: Not a git repo, skipping pull"
fi

# ── Step 2: Rebuild Python package ───────────────────────────────────────────
echo ""
echo "[2/3] Updating Python package..."
if command -v pip &>/dev/null; then
    pip install -e "$ROOT" --quiet 2>&1 | tail -1
    echo "  OK"
elif command -v pip3 &>/dev/null; then
    pip3 install -e "$ROOT" --quiet 2>&1 | tail -1
    echo "  OK"
else
    echo "  SKIP: pip not found"
fi

# ── Step 3: Rebuild daemon ───────────────────────────────────────────────────
echo ""
echo "[3/3] Rebuilding daemon..."
if command -v node &>/dev/null; then
    cd "$ROOT/packages/daemon"
    npm install --include=dev --silent 2>&1 | tail -1
    npm run build 2>&1 | tail -1
    echo "  OK: daemon rebuilt"
    cd "$ROOT"
else
    echo "  SKIP: node not found (WSL-only install, no daemon needed)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== Update complete ==="
echo ""
echo "Next steps:"
echo "  1. Restart daemon if running:  node packages/daemon/dist/index.js"
echo "  2. Refresh Chrome extension:   chrome://extensions/ → click refresh icon"
echo ""
