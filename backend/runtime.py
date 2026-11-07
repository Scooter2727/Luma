"""Read-only source data and writable, disposable deployment caches."""
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def is_vercel():
    return os.environ.get('VERCEL') == '1'


def cache_directory():
    configured = os.environ.get('LUMA_CACHE_DIR')
    path = Path(configured) if configured else (Path(tempfile.gettempdir()) / 'luma-cache' if is_vercel() else ROOT / 'data/out')
    path.mkdir(parents=True, exist_ok=True)
    return path
