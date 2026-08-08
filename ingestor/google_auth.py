"""
Autenticacion OAuth compartida (Gmail + Sheets + Drive).

Local: ingestor/credentials.json + token.json
CI/nube: variables GOOGLE_OAUTH_CLIENT_JSON + GOOGLE_OAUTH_TOKEN_JSON
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
TOKEN_FILE = BASE_DIR / "token.json"

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]


def _write_json_from_env(env_name: str, dest: Path) -> bool:
    raw = (os.environ.get(env_name) or "").strip()
    if not raw:
        return False
    dest.write_text(raw, encoding="utf-8")
    return True


def _ensure_credential_files() -> None:
    """En CI escribe credentials/token desde env si no existen en disco."""
    if not CREDENTIALS_FILE.exists():
        if not _write_json_from_env("GOOGLE_OAUTH_CLIENT_JSON", CREDENTIALS_FILE):
            raise SystemExit(
                f"Falta {CREDENTIALS_FILE} o la env GOOGLE_OAUTH_CLIENT_JSON."
            )
    if not TOKEN_FILE.exists():
        _write_json_from_env("GOOGLE_OAUTH_TOKEN_JSON", TOKEN_FILE)


def get_credentials():
    _ensure_credential_files()

    # Prefer env token (siempre fresco en CI) sobre archivo viejo
    token_env = (os.environ.get("GOOGLE_OAUTH_TOKEN_JSON") or "").strip()
    if token_env:
        info = json.loads(token_env)
        creds = Credentials.from_authorized_user_info(info, SCOPES)
    elif TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    else:
        creds = None

    need_reauth = not creds or not creds.valid or not creds.has_scopes(SCOPES)

    if need_reauth:
        if creds and creds.expired and creds.refresh_token and creds.has_scopes(SCOPES):
            creds.refresh(Request())
            # Persistir refresh localmente si hay archivo
            try:
                TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
            except OSError:
                pass
        else:
            if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
                raise SystemExit(
                    "Token Google invalido/expirado en CI. "
                    "Actualiza el secret GOOGLE_OAUTH_TOKEN_JSON (con refresh_token)."
                )
            print(
                "Se abrira el navegador para autorizar Gmail + Sheets + Drive (solo lectura)."
            )
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE), SCOPES
            )
            creds = flow.run_local_server(port=0)
            TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return creds


def gmail_service():
    return build("gmail", "v1", credentials=get_credentials())


def sheets_service():
    return build("sheets", "v4", credentials=get_credentials())


def drive_service():
    return build("drive", "v3", credentials=get_credentials())


def _drive_list(q: str, page_size: int = 25) -> list[dict]:
    """Lista archivos en Mi unidad + shared drives."""
    drive = drive_service()
    res = (
        drive.files()
        .list(
            q=q,
            spaces="drive",
            fields="files(id, name, modifiedTime, mimeType)",
            pageSize=page_size,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            corpora="allDrives",
        )
        .execute()
    )
    return list(res.get("files") or [])


def download_drive_file_by_id(file_id: str, dest: Path) -> Path:
    drive = drive_service()
    data = (
        drive.files()
        .get_media(fileId=file_id, supportsAllDrives=True)
        .execute()
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def download_drive_file_by_name(name: str, dest: Path | None = None) -> Path:
    """Descarga el primer archivo de Drive con ese nombre exacto."""
    safe = name.replace("'", "\\'")
    q = f"name = '{safe}' and trashed = false"
    files = _drive_list(q, page_size=5)
    if not files:
        raise FileNotFoundError(f"No se encontro en Drive: {name}")
    file_id = files[0]["id"]
    if dest is None:
        dest = Path(tempfile.gettempdir()) / name
    return download_drive_file_by_id(file_id, dest)


def find_drive_files_by_name_contains(
    *needles: str, page_size: int = 40
) -> list[dict]:
    """Busca archivos cuyo nombre contiene todos los needles (AND)."""
    parts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"]
    for n in needles:
        safe = n.replace("'", "\\'")
        parts.append(f"name contains '{safe}'")
    return _drive_list(" and ".join(parts), page_size=page_size)
