# Sync en la nube (GitHub Actions)

Las ventas (Gmail), **Facturas CFDI** (mismo workflow), los **Saldos al día** (cada hora)
y el **soft-sync RR.HH.** (diario 12:00 PM CDMX) corren en GitHub Actions.
Ya no dependen de que tu PC esté encendido ni abren ventanas de PowerShell.

CDMX sin DST desde 2022 → UTC-6 year-round.

## Secrets del repo (Settings → Secrets and variables → Actions)

| Secret | Contenido |
|--------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `GOOGLE_OAUTH_CLIENT_JSON` | Contenido completo de `ingestor/credentials.json` |
| `GOOGLE_OAUTH_TOKEN_JSON` | Contenido completo de `ingestor/token.json` (debe incluir `refresh_token`) |

`GOOGLE_*` hace falta para Gmail y Saldos (Drive/Sheets). El soft-sync RH solo usa Supabase.

## Workflows

| Workflow | Cadencia (CDMX) | Cron UTC | Qué hace |
|----------|-----------------|----------|----------|
| `sync-gmail.yml` | Cada ~3 h + anclas L–S 4:00/5:17 AM y Dom 20:00–21:00 | `5 */3 * * *` + anclas | Infocaja + CORTE; luego CFDI → `financial_records` (best-effort) |
| `sync-saldos.yml` | Cada hora (:07) | `7 * * * *` | Flujo efectivo + `cxp_por_pagar` |
| `sync-hr-drive.yml` | Diario 12:00 PM | `0 18 * * *` | Soft-check `hr_*` + `hr_drive_sync_state` |

### Certeza del sync de ventas (no solo “confiar en el cron”)

GitHub Actions **no garantiza** la hora exacta: el cron puede retrasarse o, si faltan secrets, fallar en silencio hasta que lo revises.

Para **saber** que está bien (y no depender de pedirlo a mano):

1. **Secrets Actions** (repo → Settings → Secrets): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_JSON`, `GOOGLE_OAUTH_TOKEN_JSON`.
2. **Notificaciones**: GitHub → Settings → Notifications → Actions → avisar si el workflow falla.
3. **Suite**: hub / Socios muestran alerta si el último día Infocaja está atrasado (`/api/ventas-sync-status`).
4. **Rescate**: Actions → Sync Gmail diario → **Run workflow** (o botón admin si configuras `GH_WORKFLOW_DISPATCH_TOKEN` en Vercel).
5. Tras cambiar secrets o el YAML, corre **Run workflow** una vez y confirma en el log `OK YYYY-MM-DD: Venta Total=…`.

Tras agregar o cambiar secrets, dispara **Run workflow** una vez en Actions (el cron de GitHub es best-effort y puede saltarse el primer día).

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
Se tipan a mano en el Excel de presupuesto (hoja **TOTAL**, panel derecho Mifel/BBVA):
- filas **SEM n** → `tipo: ventas` (depósitos reales, p. ej. «Ventas MIFEL · SEM 3»)
- filas **ANTICIPOS SEM n** con comentario/nota Excel que contiene «Entre cuentas» → `tipo: entre_cuentas` (solo transferencias MIFEL↔BBVA)
- otros anticipos → `tipo: otro`

Fuente: `source_file=presupuesto_ingreso` (una fila por componente con monto > 0). Las hojas SEM no tienen líneas de ingreso bancario; solo pagos/gastos.

**Ventas en efectivo** (`flujo_efectivo_mov`): conceptos `EFECTIVO SEMANA #N` / columna Ventas → `tipo: ventas`, etiqueta «Ventas efectivo · SEM n» (mismo filtro **Tipo ingreso → Ventas** que MIFEL).

Tras editar el Excel, vuelve a correr `ingest_presupuesto.py` para ese mes.
Para refrescar etiquetas de efectivo: `python ingest_saldos_flujo.py --year 2026`.

<!-- TODO(automate): presupuesto / ventas_semana / estados de cuenta siguen MANUAL.
     Automatizar con Actions (cron + Drive API) cuando se priorice; no inventar jobs aún. -->

## CLI local — Infocaja (Gmail → efectivo / tarjetas / comensales)

Mismo OAuth (`credentials.json` + `token.json`). Cada correo «Fin de Día»
guarda `Venta Total` + `Infocaja Efectivo` + `Infocaja Bancarias` (+ propina)
+ `Infocaja Personas` (comensales) en `source_file=infocaja`.

**Fuente de verdad:** Gmail → Supabase (diario vía Actions). El Sheet histórico
[REPORTE CHEQUE PROMEDIO](https://docs.google.com/spreadsheets/d/15w9-oXEjg_GvIz_p4ADDo3Aj5exB0o85dh50ItYsLNQ)
(promedios mensuales / meseros) es referencia manual; **no** se escribe desde el sync.
Los mismos campos (Venta, Personas → cheque promedio) salen del correo Infocaja.

La gráfica **Efectivo/Tarjetas** en `/ventas` solo usa esas categorías Infocaja
(no el Acumulado `ventas_semana`, que sí alimenta WI/Eventos en 2021–2025).
**Cheque promedio** (UI, no se guarda en BD) = `Venta Total` ÷ `Infocaja Personas`
(Venta Total Infocaja ya va sin propina).

```bash
# Sync diario (default: últimos 90 días) — re-upsert incluye Personas
python ingest_infocaja_gmail.py
python sync_gmail_diario.py --newer-than 7

# Backfill histórico (Gmail tiene reportes ~2022+ con efectivo/bancarias/personas)
python ingest_infocaja_gmail.py --after 2023/01/01
python ingest_infocaja_gmail.py --after 2022/01/01   # opcional, años previos
```

Actions: `.github/workflows/sync-gmail.yml`
1. `sync_gmail_diario.py --newer-than 7 --skip-facturas` (Infocaja + CORTE; debe pasar)
2. `ingest_facturas_gmail.py --newer-than 7` (CFDI → `factura_cfdi` en Supabase; **continue-on-error**)

Horario: lun–sáb 4:00 AM / respaldo ~5:17 AM CDMX; domingo 8:00 PM CDMX.
Requiere los 4 secrets de la tabla arriba.

Sin el backfill, años como 2023 muestran WI/Eventos (Acumulado) pero
«Sin datos de efectivo/tarjetas».

## CLI local — facturas CFDI (Gmail → ERP / financial_records)

Mismo OAuth que Infocaja (`credentials.json` + `token.json`). Indexa PDF/XML
hacia `source_file=factura_cfdi` (hub ERP = Supabase `financial_records`) y guarda
adjuntos en `FACTURAS_PATH` (default `I:\Mi unidad\FACTURAS CFDI`; en CI →
`ingestor/data/facturas`).

```bash
# Solo facturas (últimos 90 días)
python ingest_facturas_gmail.py
python ingest_facturas_gmail.py --newer-than 30 --dry-run

# Junto con Infocaja + CORTE (local completo)
python sync_gmail_diario.py --newer-than 7
python sync_gmail_diario.py --skip-facturas   # solo ventas, sin CFDI
```

UI: Finanzas → **Facturas** (`/finanzas/facturas`) — lista + descarga + faltantes.
Cloud: el workflow Gmail **sí** ingiere CFDI al ERP; el paso es best-effort para no tumbar ventas.

## CLI local — comprobantes (índice PDF)

```bash
python ingest_estados_cuenta.py --index-pdfs --pdf-only
```

Tras reindexar, la columna **Concepto** sale del nombre del archivo
(`mifel-NominaMeserosSem28(26)-$4,410.56.pdf` → `Nomina Meseros Sem 28`).

<!-- TODO(automate): ingest_estados_cuenta / ventas_semana — mismo backlog que presupuesto. -->

## Soft-sync RR.HH. (Actions)

`.github/workflows/sync-hr-drive.yml` → `python sync_hr_drive_cloud.py`

- **Cadencia:** diario 12:00 PM CDMX (`0 18 * * *` UTC).
- Cuenta filas en `hr_payroll_periods`, `hr_schedule_weeks`, `hr_employees` (paths),
  `hr_doc_links` y actualiza `hr_drive_sync_state` (`last_source=github_actions`).
- **No** monta File Stream ni importa xlsx nuevos. Para refrescar carpetas/import:
  PC admin, botones en `/rrhh`, o `POST /api/hr/sync` con sesión RH.
- SQL previo: `supabase/hr_drive_sync.sql` (tabla de estado).
- Secrets: solo `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

```bash
python sync_hr_drive_cloud.py
python sync_hr_drive_cloud.py --dry-run
```

## Cortes TPV (foto celular · local MVP)

UI: `/ventas/corte-tpv` (módulo Ventas). Flujo diario **Terminal 1 / 2 / 3**:
foto nítida **o** «No se utilizó la terminal N». Día incompleto hasta las 3.

1. En Supabase → SQL Editor, ejecuta `supabase/tpv_cortes.sql`
   (tabla `tpv_corte_uploads` + bucket Storage `tpv-cortes`).
2. Reinicia `npm run dev` local. **No** hace falta deploy.
3. Auth: login del suite con módulo `ventas` (o admin). Cuentas mesero/PIN: después.
4. Montos: **manuales** día 1 (`total_cobrado`, `propina`, `neto_banco`).
   `ocr_status=skipped` / `ocr_text` stub para OCR futuro.
5. Verificación semana: neto TPV vs `presupuesto_ingreso` (Ventas MIFEL/BBVA)
   + referencia Infocaja Bancarias/Propina.

APIs: `GET/POST /api/tpv-cortes`, `GET/PATCH /api/tpv-cortes/[id]`.

## Tareas Windows locales

Quedaron **deshabilitadas** (`DashboardC50-SyncSaldosAlDia`, `DashboardC50-SyncGmailDiario`).
Si quieres volver a local: Programador de tareas → Habilitar.
