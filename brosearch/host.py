"""
Detect daemon host for the current environment.
- Windows / Mac / Linux native: localhost
- WSL: try localhost first (modern WSL2 mirrored mode),
       fall back to Windows host IP from /etc/resolv.conf
"""
import os
import re
import socket


def _wsl_host_ip() -> str:
    """Read Windows host IP from /etc/resolv.conf (WSL2 NAT mode fallback)."""
    try:
        with open('/etc/resolv.conf') as f:
            for line in f:
                m = re.match(r'nameserver\s+([\d.]+)', line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return 'localhost'


def _is_wsl() -> bool:
    try:
        with open('/proc/version') as f:
            return 'microsoft' in f.read().lower()
    except OSError:
        return False


def _daemon_reachable(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def get_daemon_url() -> str:
    """Return the daemon base URL for this environment."""
    env = os.environ.get('BROSEARCH_DAEMON')
    if env:
        return env.rstrip('/')

    port_str = os.environ.get('BROSEARCH_PORT', '19824')
    port = int(port_str)

    if _is_wsl():
        # Try localhost first (WSL2 mirrored mode / port forwarding)
        if _daemon_reachable('localhost', port):
            return f'http://localhost:{port}'
        # Fall back to Windows host IP
        host_ip = _wsl_host_ip()
        return f'http://{host_ip}:{port}'

    return f'http://localhost:{port}'
