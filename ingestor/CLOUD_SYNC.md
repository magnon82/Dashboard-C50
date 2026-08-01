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

## CLI local — flujo efectivo (saldo + semanas + movimientos)

Desde `ingestor/`:

```bash
# Saldos diarios + agregados semanales + líneas (flujo_efectivo_mov)
python ingest_saldos_flujo.py
python ingest_saldos_flujo.py --year 2026
python ingest_saldos_flujo.py --dry-run

# Wrapper usado por Actions (efectivo + CXP)
python sync_saldos_al_dia.py
```

Fuentes escritas: `flujo_efectivo_saldo`, `flujo_efectivo_semana`, `flujo_efectivo_mov`.
La semana de cada movimiento sale del texto en **Concepto** (`SEMANA #N` / `SEM #N`); si no hay semana, se usa la fecha.
Las filas **CAJA CHICA SEMANA #N** son el desglose semanal del presupuesto en efectivo.

## CLI local — presupuesto (incl. ingresos Mifel/BBVA)

Desde `ingestor/`:

```bash
# Incremental (~40 días recientes)
python ingest_presupuesto.py

# Un mes concreto
python ingest_presupuesto.py --file "I:\...\PRESUPUESTOS 2026\PRESUPUESTO MENSUAL JULIO 2026.xlsx"

# Dry-run
python ingest_presupuesto.py --file "...JULIO 2026.xlsx" --dry-run
```

**Ingresos bancarios en `/finanzas/ingresos`:** no vienen solo del estado de cuenta.
Se tipan a mano en el Excel de presupuesto (hoja **TOTAL**, panel derecho Mifel/BBVA: ventas SEM + anticipos entradas) y se publican como `source_file=presupuesto_ingreso` (una fila por banco × SEM con monto > 0). Las hojas SEM no tienen líneas de ingreso bancario; solo pagos/gastos.

Tras editar el Excel, vuelve a correr `ingest_presupuesto.py` para ese mes.

## Tareas Windows locales

Quedaron **deshabilitadas** (`DashboardC50-SyncSaldosAlDia`, `DashboardC50-SyncGmailDiario`).
Si quieres volver a local: Programador de tareas → Habilitar.
