"""Reintentos para wrappers de sync (Google / red intermitente)."""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent

# Errores típicos transitorios (Sheets/Gmail/Drive/httpx).
TRANSIENT_HINTS = (
    "currently unavailable",
    "backenderror",
    "ratelimit",
    "rate limit",
    "quota",
    "connectionreset",
    "connection terminated",
    "remoteprotocolerror",
    "ssl",
    "timed out",
    "timeout",
    "503",
    "500",
    "502",
    "429",
)


def run_once(script: str, extra: list[str] | None = None) -> tuple[int, str]:
    cmd = [sys.executable, str(BASE / script), *(extra or [])]
    print(f"\n>>> {' '.join(cmd)}")
    proc = subprocess.run(
        cmd,
        cwd=str(BASE),
        capture_output=False,
    )
    return proc.returncode, ""


def run_with_retries(
    script: str,
    extra: list[str] | None = None,
    *,
    attempts: int = 3,
    delay_sec: float = 25.0,
) -> int:
    """
    Ejecuta un script hijo; si falla, reintenta (útil ante 503 Google / cortes HTTP/2).
    """
    last = 1
    for i in range(max(1, attempts)):
        if i > 0:
            wait = delay_sec * i
            print(f"  Reintento {i + 1}/{attempts} en {wait:.0f}s…")
            time.sleep(wait)
        last, _ = run_once(script, extra)
        if last == 0:
            return 0
        print(f"  !! {script} salió con código {last}")
    return last
