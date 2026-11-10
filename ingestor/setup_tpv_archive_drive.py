"""
Una vez: OAuth admin@ con drive.file → carpeta «Cortes TPV archivo» → .env.local
Uso (desde repo root o ingestor):
  python ingestor/setup_tpv_archive_drive.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
CREDENTIALS = BASE / "credentials.json"
TOKEN = BASE / "token-tpv-archive.json"
ENV_LOCAL = ROOT / ".env.local"
FOLDER_NAME = "Cortes TPV archivo"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
LOGIN_HINT = "admin@carranza50.com.mx"


def upsert_env(key: str, value: str) -> None:
    text = ENV_LOCAL.read_text(encoding="utf-8") if ENV_LOCAL.exists() else ""
    line = f"{key}={value}"
    pat = re.compile(rf"^{re.escape(key)}\s*=.*$", re.M)
    if pat.search(text):
        text = pat.sub(line, text)
    else:
        text = text.rstrip() + f"\n\n# Cortes TPV archivo Drive\n{line}\n"
    ENV_LOCAL.write_text(text, encoding="utf-8")


def get_creds() -> Credentials:
    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN.write_text(creds.to_json(), encoding="utf-8")
            return creds
        except Exception:
            creds = None
    if not CREDENTIALS.exists():
        raise SystemExit(f"Falta {CREDENTIALS}")
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS), SCOPES)
    print(f"Abre el navegador e inicia sesión como {LOGIN_HINT}…", flush=True)
    creds = flow.run_local_server(
        port=0,
        login_hint=LOGIN_HINT,
        open_browser=True,
        authorization_prompt_message="Autoriza Drive (drive.file) en el navegador…",
        success_message="Listo. Ya puedes cerrar esta pestaña y volver a Cursor.",
    )
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    print(f"Token guardado: {TOKEN.name}", flush=True)
    return creds


def main() -> int:
    creds = get_creds()
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    q = (
        "mimeType = 'application/vnd.google-apps.folder' and "
        f"name = '{FOLDER_NAME}' and 'root' in parents and trashed = false"
    )
    listed = (
        drive.files()
        .list(q=q, fields="files(id,name)", pageSize=5, spaces="drive")
        .execute()
    )
    files = listed.get("files") or []
    if files:
        folder_id = files[0]["id"]
        print(f"Carpeta existente: {FOLDER_NAME}")
    else:
        created = (
            drive.files()
            .create(
                body={"name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"},
                fields="id,name",
            )
            .execute()
        )
        folder_id = created["id"]
        print(f"Carpeta creada: {FOLDER_NAME}")
    upsert_env("TPV_ARCHIVE_DRIVE_FOLDER_ID", folder_id)
    upsert_env("TPV_ARCHIVE_USE_OAUTH", "1")
    print(f"OK TPV_ARCHIVE_DRIVE_FOLDER_ID len={len(folder_id)} → .env.local")
    print("Siguiente: aplica supabase/tpv_cortes_archive.sql en SQL Editor y corre archive.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
