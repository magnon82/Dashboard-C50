"""
Autenticación OAuth compartida (Gmail + Sheets + Drive).

Primera vez (o si cambian los scopes): borra token.json y vuelve a autorizar.
"""

from __future__ import annotations

from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
TOKEN_FILE = BASE_DIR / "token.json"

# Gmail + Sheets + Drive (solo lectura)
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]


def get_credentials():
    if not CREDENTIALS_FILE.exists():
        raise SystemExit(
            f"Falta {CREDENTIALS_FILE}. Descarga el OAuth Desktop JSON en esa ruta."
        )

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    need_reauth = (
        not creds
        or not creds.valid
        or not creds.has_scopes(SCOPES)
    )

    if need_reauth:
        if creds and creds.expired and creds.refresh_token and creds.has_scopes(SCOPES):
            creds.refresh(Request())
        else:
            print(
                "Se abrira el navegador para autorizar Gmail + Sheets + Drive (solo lectura)."
            )
            if TOKEN_FILE.exists() and (not creds or not creds.has_scopes(SCOPES)):
                print(
                    "Nota: scopes ampliados. Si falla el refresh, borra token.json y reautoriza."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return creds


def gmail_service():
    return build("gmail", "v1", credentials=get_credentials())


def sheets_service():
    return build("sheets", "v4", credentials=get_credentials())


def drive_service():
    return build("drive", "v3", credentials=get_credentials())
