# Sync en la nube (GitHub Actions)

Las ventas (Gmail 5:00 AM CDMX) y los **Saldos al día** (cada 5 min) corren en GitHub Actions.
Ya no dependen de que tu PC esté encendido ni abren ventanas de PowerShell.

## Secrets del repo (Settings → Secrets and variables → Actions)

| Secret | Contenido |
|--------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `GOOGLE_OAUTH_CLIENT_JSON` | Contenido completo de `ingestor/credentials.json` |
| `GOOGLE_OAUTH_TOKEN_JSON` | Contenido completo de `ingestor/token.json` (debe incluir `refresh_token`) |

## Workflows

- `.github/workflows/sync-saldos.yml` — cada 5 minutos + manual
- `.github/workflows/sync-gmail.yml` — diario 11:00 UTC (~5:00 AM Ciudad de México en horario estándar) + manual

## Tareas Windows locales

Quedaron **deshabilitadas** (`DashboardC50-SyncSaldosAlDia`, `DashboardC50-SyncGmailDiario`).
Si quieres volver a local: Programador de tareas → Habilitar.
