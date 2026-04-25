"""Shared runtime caches for the Governance Atlas API.

Holds module-level TTL caches plus a threading lock so mutations remain safe
under FastAPI's default threaded worker. Pure container: no dependencies on
AppConfig or UCSQLClient.
"""

from __future__ import annotations

import hashlib
import threading
import time
from typing import Any, Callable, Dict, Tuple


_CACHE_LOCK = threading.Lock()

_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}

_OBO_CLIENT_CACHE: Dict[str, Tuple[float, Any]] = {}
_OBO_CLIENT_TTL_SECONDS = 120
_OBO_CLIENT_MAX_ENTRIES = 32


def _obo_token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]


def _ttl_value(key: str, ttl_s: int, loader: Callable[[], Any]) -> Any:
    now = time.time()
    cached = _TTL_CACHE.get(key)
    if cached and now - cached[0] < ttl_s:
        return cached[1]
    value = loader()
    with _CACHE_LOCK:
        _TTL_CACHE[key] = (now, value)
    return value


def _ttl_cache_pop(key: str) -> None:
    with _CACHE_LOCK:
        _TTL_CACHE.pop(key, None)


def _invalidate_cache_prefix(prefix: str) -> None:
    with _CACHE_LOCK:
        for key in list(_TTL_CACHE.keys()):
            if key.startswith(prefix):
                _TTL_CACHE.pop(key, None)
