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

- `.github/workflows/sync-saldos.yml` — cada ~15 min (`7,22,37,52`) + manual
- `.github/workflows/sync-gmail.yml` — lun–sáb 4:00 AM CDMX (+ respaldo ~5:17 AM); domingo 8:00 PM CDMX; + manual

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

Actions: `.github/workflows/sync-gmail.yml` → `sync_gmail_diario.py --newer-than 7 --skip-facturas`
(lun–sáb 4:00 AM / respaldo ~5:17 AM CDMX; domingo 8:00 PM CDMX). Requiere los 4 secrets de la tabla arriba.

Sin el backfill, años como 2023 muestran WI/Eventos (Acumulado) pero
«Sin datos de efectivo/tarjetas».

## CLI local — facturas CFDI (Gmail)

Mismo OAuth que Infocaja (`credentials.json` + `token.json`). Indexa PDF/XML
hacia `source_file=factura_cfdi` y guarda adjuntos en `FACTURAS_PATH`
(default `I:\Mi unidad\FACTURAS CFDI`).

```bash
# Solo facturas (últimos 90 días)
python ingest_facturas_gmail.py
python ingest_facturas_gmail.py --newer-than 30 --dry-run

# Junto con Infocaja + CORTE
python sync_gmail_diario.py --newer-than 7
python sync_gmail_diario.py --skip-facturas   # no tocar facturas
```

UI: Finanzas → **Facturas** (`/finanzas/facturas`) — lista + descarga + faltantes.

## CLI local — comprobantes (índice PDF)

```bash
python ingest_estados_cuenta.py --index-pdfs --pdf-only
```

Tras reindexar, la columna **Concepto** sale del nombre del archivo
(`mifel-NominaMeserosSem28(26)-$4,410.56.pdf` → `Nomina Meseros Sem 28`).

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
