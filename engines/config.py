"""Minimal environment helper — replaces the ..core.config dependency."""
import os


def get_env(key: str, default: str = None) -> str:
    return os.environ.get(key, default)
