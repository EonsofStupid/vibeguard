"""Environment loading that survives real-world .env files: quotes, CRLF, and SRV-less DNS.

Reads .env from the repo root (or VIBEGUARD_ENV_FILE) without overriding variables already set.
If MONGODB_SEEDLIST is set, the SRV URI is rewritten to a direct-host URI so venues that drop
DNS SRV lookups still connect.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

_SRV = re.compile(r"^mongodb\+srv://(?P<auth>[^@]+@)?(?P<host>[^/?]+)(?P<rest>.*)$")


def load_env(path: str | Path | None = None) -> dict[str, str]:
    p = Path(path or os.environ.get("VIBEGUARD_ENV_FILE", ".env"))
    loaded: dict[str, str] = {}
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v
                loaded[k] = v
    uri, seeds = os.environ.get("MONGODB_URI", ""), os.environ.get("MONGODB_SEEDLIST", "")
    m = _SRV.match(uri)
    if m and seeds:
        rs = os.environ.get("MONGODB_REPLICA_SET", "")
        rest = m.group("rest") or "/"
        sep = "&" if "?" in rest else "?"
        extra = "ssl=true" + (f"&replicaSet={rs}" if rs else "")
        os.environ["MONGODB_URI"] = f"mongodb://{m.group('auth') or ''}{seeds}{rest}{sep}{extra}"
    return loaded
