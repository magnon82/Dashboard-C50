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

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
TOKEN_FILE = BASE_DIR / "token.json"
GMAIL_TOKEN_FILE = BASE_DIR / "token-gmail.json"

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

# Bandeja operativa (reemplaza sergio@carranza50.com.mx).
DEFAULT_GMAIL_SOURCE_MAILBOX = "admin@carranza50.com.mx"


def gmail_source_mailbox() -> str:
    raw = (
        os.environ.get("GMAIL_SOURCE_MAILBOX") or DEFAULT_GMAIL_SOURCE_MAILBOX
    ).strip().lower()
    if raw == "sergio@carranza50.com.mx":
        return DEFAULT_GMAIL_SOURCE_MAILBOX
    return raw or DEFAULT_GMAIL_SOURCE_MAILBOX


def _token_json_from_env(*names: str) -> str:
    for name in names:
        raw = (os.environ.get(name) or "").strip()
        if raw:
            return raw
    return ""


def _refresh_creds(creds: Credentials, persist_path: Path | None):
    """Refresca el token. None si Google lo revocó (hay que reautorizar)."""
    try:
        creds.refresh(Request())
    except RefreshError:
        return None
    if persist_path:
        try:
            persist_path.write_text(creds.to_json(), encoding="utf-8")
        except OSError:
            pass
    return creds


def _run_local_oauth(login_hint: str | None, persist_path: Path) -> Credentials:
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    kwargs = {"port": 0}
    if login_hint:
        kwargs["login_hint"] = login_hint
    creds = flow.run_local_server(**kwargs)
    persist_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


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
    token_env = _token_json_from_env("GOOGLE_OAUTH_TOKEN_JSON")
    if token_env:
        info = json.loads(token_env)
        creds = Credentials.from_authorized_user_info(info, SCOPES)
    elif TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    else:
        creds = None

    need_reauth = not creds or not creds.valid or not creds.has_scopes(SCOPES)

    if need_reauth:
        refreshed = None
        if creds and creds.refresh_token and creds.has_scopes(SCOPES):
            refreshed = _refresh_creds(creds, TOKEN_FILE)
        if refreshed:
            return refreshed
        if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
            raise SystemExit(
                "Token Google invalido/revocado en CI. "
                "Reautoriza admin@carranza50.com.mx y actualiza GOOGLE_OAUTH_TOKEN_JSON."
            )
        print(
            "Se abrira el navegador para autorizar Gmail + Sheets + Drive (solo lectura)."
        )
        creds = _run_local_oauth(gmail_source_mailbox(), TOKEN_FILE)

    return creds


def get_gmail_credentials():
    """OAuth de la bandeja operativa. Prefiere token de Gmail; si no, el compartido."""
    _ensure_credential_files()
    token_env = _token_json_from_env(
        "GMAIL_OAUTH_TOKEN_JSON", "GOOGLE_OAUTH_TOKEN_JSON"
    )
    token_file = GMAIL_TOKEN_FILE if GMAIL_TOKEN_FILE.exists() else TOKEN_FILE

    if token_env:
        info = json.loads(token_env)
        creds = Credentials.from_authorized_user_info(info, SCOPES)
    elif token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    else:
        creds = None

    need_reauth = not creds or not creds.valid or not creds.has_scopes(SCOPES)
    mailbox = gmail_source_mailbox()

    if need_reauth:
        refreshed = None
        if creds and creds.refresh_token and creds.has_scopes(SCOPES):
            refreshed = _refresh_creds(creds, token_file)
        if refreshed:
            return refreshed
        if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
            raise SystemExit(
                "Token Gmail invalido/revocado en CI. "
                f"Autoriza {mailbox} y actualiza GMAIL_OAUTH_TOKEN_JSON "
                "(o GOOGLE_OAUTH_TOKEN_JSON) con refresh_token."
            )
        print(
            f"Se abrira el navegador para autorizar la bandeja {mailbox} "
            f"(Gmail + Sheets + Drive, solo lectura). Entra con {mailbox}."
        )
        creds = _run_local_oauth(mailbox, GMAIL_TOKEN_FILE)
        try:
            TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
        except OSError:
            pass

    return creds


def require_gmail_mailbox(service) -> str:
    profile = service.users().getProfile(userId="me").execute()
    email = str(profile.get("emailAddress") or "").strip().lower()
    wanted = gmail_source_mailbox()
    if email != wanted:
        raise SystemExit(
            f"Gmail OAuth esta en {email or '(desconocido)'}; "
            f"el origen de correo debe ser {wanted} "
            "(reemplaza sergio@carranza50.com.mx). "
            "Reautoriza con esa cuenta y actualiza GMAIL_OAUTH_TOKEN_JSON."
        )
    return email


def gmail_service():
    service = build("gmail", "v1", credentials=get_gmail_credentials())
    require_gmail_mailbox(service)
    return service


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


def list_drive_children(folder_id: str, page_size: int = 1000) -> list[dict]:
    """Hijos directos de una carpeta (paginado)."""
    drive = drive_service()
    out: list[dict] = []
    page_token: str | None = None
    safe_id = folder_id.replace("'", "\\'")
    q = f"'{safe_id}' in parents and trashed = false"
    while True:
        res = (
            drive.files()
            .list(
                q=q,
                spaces="drive",
                fields="nextPageToken, files(id, name, modifiedTime, mimeType)",
                pageSize=page_size,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                pageToken=page_token,
            )
            .execute()
        )
        out.extend(res.get("files") or [])
        page_token = res.get("nextPageToken")
        if not page_token:
            break
    return out


def find_drive_folder_by_name(name: str) -> dict | None:
    """Primera carpeta con ese nombre exacto (Mi unidad + shared)."""
    safe = name.replace("'", "\\'")
    q = (
        f"name = '{safe}' and trashed = false "
        f"and mimeType = 'application/vnd.google-apps.folder'"
    )
    found = _drive_list(q, page_size=10)
    return found[0] if found else None


def list_drive_pdfs_under_folder(
    folder_id: str, *, max_depth: int = 6
) -> list[dict]:
    """
    PDFs bajo folder_id (recursivo). Cada ítem:
      id, name, modifiedTime, parents_path (lista de nombres carpeta → archivo).
    """
    folder_mime = "application/vnd.google-apps.folder"
    # stack: (folder_id, path_names)
    stack: list[tuple[str, list[str]]] = [(folder_id, [])]
    pdfs: list[dict] = []
    depth = 0
    while stack and depth <= max_depth:
        next_stack: list[tuple[str, list[str]]] = []
        for fid, path_names in stack:
            for f in list_drive_children(fid):
                name = str(f.get("name") or "")
                mime = str(f.get("mimeType") or "")
                if mime == folder_mime:
                    next_stack.append((str(f["id"]), [*path_names, name]))
                    continue
                lower = name.lower()
                if lower.endswith(".pdf") or mime == "application/pdf":
                    pdfs.append(
                        {
                            "id": f["id"],
                            "name": name,
                            "modifiedTime": f.get("modifiedTime"),
                            "parents_path": path_names,
                        }
                    )
        stack = next_stack
        depth += 1
    return pdfs


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
