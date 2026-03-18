"""
Tests for brosearch/host.py — daemon URL detection, WSL handling.
"""
import os
import pytest
from unittest.mock import patch, mock_open, MagicMock
from brosearch.host import get_daemon_url, _wsl_host_ip, _is_wsl


class TestWslHostIp:
    def test_reads_nameserver_from_resolv_conf(self):
        content = "# comment\nnameserver 172.22.16.1\nnameserver 8.8.8.8\n"
        with patch('builtins.open', mock_open(read_data=content)):
            assert _wsl_host_ip() == '172.22.16.1'

    def test_returns_localhost_when_file_missing(self):
        with patch('builtins.open', side_effect=OSError):
            assert _wsl_host_ip() == 'localhost'

    def test_returns_localhost_when_no_nameserver_line(self):
        with patch('builtins.open', mock_open(read_data='# no nameserver\n')):
            assert _wsl_host_ip() == 'localhost'


class TestIsWsl:
    def test_detects_wsl(self):
        content = 'Linux version 5.15.0-Microsoft (gcc...)'
        with patch('builtins.open', mock_open(read_data=content)):
            assert _is_wsl() is True

    def test_not_wsl_on_regular_linux(self):
        content = 'Linux version 5.15.0-generic (Ubuntu)'
        with patch('builtins.open', mock_open(read_data=content)):
            assert _is_wsl() is False

    def test_not_wsl_when_proc_version_missing(self):
        with patch('builtins.open', side_effect=OSError):
            assert _is_wsl() is False


class TestGetDaemonUrl:
    def test_env_var_override(self):
        with patch.dict(os.environ, {'BROSEARCH_DAEMON': 'http://myhost:1234'}):
            assert get_daemon_url() == 'http://myhost:1234'

    def test_env_var_strips_trailing_slash(self):
        with patch.dict(os.environ, {'BROSEARCH_DAEMON': 'http://myhost:1234/'}):
            assert get_daemon_url() == 'http://myhost:1234'

    def test_default_port_localhost(self):
        env = {k: v for k, v in os.environ.items()
               if k not in ('BROSEARCH_DAEMON', 'BROSEARCH_PORT')}
        with patch.dict(os.environ, env, clear=True), \
             patch('brosearch.host._is_wsl', return_value=False):
            url = get_daemon_url()
        assert url == 'http://localhost:19824'

    def test_custom_port_env(self):
        with patch.dict(os.environ, {'BROSEARCH_PORT': '9999'},
                        clear=True), \
             patch('brosearch.host._is_wsl', return_value=False):
            url = get_daemon_url()
        assert url == 'http://localhost:9999'

    def test_wsl_with_localhost_reachable(self):
        with patch('brosearch.host._is_wsl', return_value=True), \
             patch('brosearch.host._daemon_reachable', return_value=True), \
             patch.dict(os.environ, {}, clear=True):
            url = get_daemon_url()
        assert url == 'http://localhost:19824'

    def test_wsl_falls_back_to_windows_ip(self):
        with patch('brosearch.host._is_wsl', return_value=True), \
             patch('brosearch.host._daemon_reachable', return_value=False), \
             patch('brosearch.host._wsl_host_ip', return_value='172.22.16.1'), \
             patch.dict(os.environ, {}, clear=True):
            url = get_daemon_url()
        assert url == 'http://172.22.16.1:19824'
