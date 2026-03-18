"""
Tests for all adapter JS files — structure validation via Node.js.
Verifies: required fields present, buildJs is callable, tabQuery has url.
No Chrome or daemon needed.
"""
import subprocess
import json
import os
import pytest
from pathlib import Path

ADAPTERS_DIR = Path(__file__).parent.parent / 'adapters'

# Collect all (platform, command) pairs
def _get_adapters():
    pairs = []
    for platform_dir in ADAPTERS_DIR.iterdir():
        if not platform_dir.is_dir() or platform_dir.name == 'custom':
            continue
        for js_file in platform_dir.glob('*.js'):
            pairs.append((platform_dir.name, js_file.stem, js_file))
    return pairs

_ADAPTERS = _get_adapters()


# Node.js validator script
_VALIDATE_SCRIPT = r"""
const adapterPath = process.argv[2];
let adapter;
try {
  adapter = require(adapterPath);
} catch(e) {
  process.stdout.write(JSON.stringify({ok: false, error: 'require failed: ' + e.message}) + '\n');
  process.exit(0);
}

const errors = [];

if (!adapter.description || typeof adapter.description !== 'string') {
  errors.push('missing or invalid description');
}
if (typeof adapter.tabQuery !== 'object') {
  errors.push('tabQuery must be an object');
}
// tabQuery.url is optional for public-API adapters (arxiv, npm, stackoverflow…)
if (!adapter.buildJs || typeof adapter.buildJs !== 'function') {
  errors.push('missing or invalid buildJs');
} else {
  try {
    const js = adapter.buildJs({});
    if (typeof js !== 'string' || js.trim().length === 0) {
      errors.push('buildJs({}) returned empty or non-string');
    }
  } catch(e) {
    errors.push('buildJs({}) threw: ' + e.message);
  }
}

if (errors.length) {
  process.stdout.write(JSON.stringify({ok: false, errors}) + '\n');
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    description: adapter.description,
    tabQuery: adapter.tabQuery,
    buildJsLength: adapter.buildJs({}).length
  }) + '\n');
}
"""

_VALIDATOR_PATH = Path(__file__).parent / '_validate_adapter.js'


def _write_validator():
    _VALIDATOR_PATH.write_text(_VALIDATE_SCRIPT, encoding='utf-8')


def _run_validator(adapter_path: Path) -> dict:
    _write_validator()
    result = subprocess.run(
        ['node', str(_VALIDATOR_PATH), str(adapter_path.resolve())],
        capture_output=True, encoding='utf-8', errors='replace', timeout=10
    )
    if result.returncode != 0:
        return {'ok': False, 'error': (result.stderr or '').strip()}
    raw = (result.stdout or '').strip()
    if not raw:
        return {'ok': False, 'error': f'no output (stderr: {result.stderr!r})'}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {'ok': False, 'error': f'bad JSON: {raw!r}'}


@pytest.mark.parametrize('platform,command,js_file', _ADAPTERS,
                         ids=[f'{p}/{c}' for p, c, _ in _ADAPTERS])
def test_adapter_structure(platform, command, js_file):
    """Every adapter must have valid description, tabQuery.url, and buildJs()."""
    result = _run_validator(js_file)
    assert result.get('ok'), (
        f"Adapter {platform}/{command} failed validation:\n"
        + '\n'.join(str(e) for e in result.get('errors', [result.get('error', 'unknown')]))
    )
    assert len(result.get('description', '')) > 0, f"{platform}/{command}: description is empty"
    assert result.get('buildJsLength', 0) > 0, f"{platform}/{command}: buildJs returns empty"


def test_adapter_count():
    """Sanity check: project has at least 15 built-in adapters."""
    assert len(_ADAPTERS) >= 15, f"Only {len(_ADAPTERS)} adapters found, expected ≥15"


@pytest.mark.parametrize('platform,command,js_file', _ADAPTERS,
                         ids=[f'{p}/{c}' for p, c, _ in _ADAPTERS])
def test_adapter_buildjs_with_common_args(platform, command, js_file):
    """buildJs must not throw when called with common optional args."""
    script = f"""
const adapter = require({json.dumps(str(js_file.resolve()))});
const args = {{limit: 10, query: 'test', sub: 'MachineLearning', market: 'CN'}};
try {{
  const js = adapter.buildJs(args);
  if (typeof js !== 'string') throw new Error('not a string');
  console.log(JSON.stringify({{ok: true, length: js.length}}));
}} catch(e) {{
  console.log(JSON.stringify({{ok: false, error: e.message}}));
}}
"""
    _VALIDATOR_PATH.write_text(script, encoding='utf-8')
    result = subprocess.run(
        ['node', str(_VALIDATOR_PATH)],
        capture_output=True, encoding='utf-8', errors='replace', timeout=10
    )
    raw = (result.stdout or '').strip()
    data = json.loads(raw) if raw else {'ok': False, 'error': result.stderr}
    assert data.get('ok'), f"{platform}/{command}: buildJs(commonArgs) failed: {data.get('error')}"
