"""Small, bounded shared caches for public feeds (including disposable Vercel disk)."""
import json
import os
import time
from threading import Lock
from .runtime import cache_directory


class CachedFeed:
    def __init__(self, name, ttl, fetch, max_stale=0):
        self.name, self.ttl, self.fetch, self.max_stale = name, ttl, fetch, max_stale
        self.lock = Lock()
        self.value = None
        self.checked = 0
        self.fetched = 0
        self.error = None

    def get(self):
        if os.environ.get('LUMA_EXTERNAL_DATA') == '0':
            return dict(data=None, available=False, stale=False, fetched_at=None)
        with self.lock:
            now = time.time()
            path = cache_directory() / (self.name + '.json')
            if self.value is None and not self.checked:
                try:
                    saved = json.loads(path.read_text(encoding='utf-8'))
                    self.value, self.fetched = saved['data'], saved['fetched_at']
                    self.checked = self.fetched
                except (OSError, ValueError, KeyError):
                    pass
            if now - self.checked >= (15 if self.error else self.ttl):
                self.checked = now
                try:
                    value = self.fetch()
                    self.value, self.fetched, self.error = value, now, None
                    temporary = path.with_suffix('.building')
                    try:
                        temporary.write_text(json.dumps(dict(data=value, fetched_at=now)), encoding='utf-8')
                        temporary.replace(path)
                    except OSError:
                        pass
                except Exception as exc:
                    # Feed failures must not take down otherwise usable routing.
                    self.error = type(exc).__name__
            age = now - self.fetched
            usable = self.value is not None and age <= self.ttl + self.max_stale
            return dict(data=self.value if usable else None, available=usable,
                        stale=bool(self.error) or age > self.ttl, fetched_at=self.fetched or None)
