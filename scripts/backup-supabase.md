# Respaldo Supabase (Postgres + Storage)

Objetivo del proyecto: **caber en plan Free** (un solo proyecto; sin Pro).
DB suele ser pequeña; el peso está en Storage (`tpv-cortes` + `hr-employee-docs`).
Fotos TPV >60 días → Drive `admin@carranza50.com.mx` (ver abajo).

Solo lectura de producción en el dump: este flujo **no** modifica el schema ni los datos; solo descarga un dump.

## Secret / variable

| Nombre | Dónde | Qué es |
| --- | --- | --- |
| `SUPABASE_DB_URL` | GitHub → Settings → Secrets and variables → Actions | URI **directa** Postgres (puerto **5432**, no pooler 6543) |

En el Dashboard de Supabase: **Project Settings → Database → Connection string → URI**, modo **Direct connection**. Sustituye la contraseña del rol `postgres` (Database password).

Formato esperado (no copies la tuya aquí):

```text
postgresql://postgres.[PROJECT_REF]:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

En algunos proyectos el host sigue siendo `db.<ref>.supabase.co` con usuario `postgres`. Usa la que muestre el panel.

Variables del suite que **no** sirven para `pg_dump` (API, no Postgres):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Cómo crear el secret en GitHub

1. Repo `Dashboard-C50` → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**.
3. Name: `SUPABASE_DB_URL`
4. Value: la URI Direct connection (con contraseña).
5. Save.

## Dump local (mismo comando que Actions)

Requisitos: [PostgreSQL client](https://www.postgresql.org/download/) (`pg_dump` en el PATH).

```bash
# PowerShell / bash — exporta la URI a una variable de entorno local (no la pegues en el chat)
# $env:SUPABASE_DB_URL = "postgresql://..."   # PowerShell
# export SUPABASE_DB_URL='postgresql://...'   # bash

mkdir -p backups
pg_dump "$SUPABASE_DB_URL" \
  -Fc \
  --no-owner \
  --no-privileges \
  -f "backups/supabase-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

PowerShell (Windows), si no tienes `date` GNU:

```powershell
New-Item -ItemType Directory -Force -Path backups | Out-Null
$stamp = Get-Date -Format "yyyyMMddTHHmmssZ"
pg_dump $env:SUPABASE_DB_URL -Fc --no-owner --no-privileges -f "backups/supabase-$stamp.dump"
```

Flags:

| Flag | Motivo |
| --- | --- |
| `-Fc` | Formato custom (comprimido; restaura con `pg_restore`) |
| `--no-owner` | Evita fallar al restaurar en otro rol/proyecto |
| `--no-privileges` | Idem con grants |

El dump incluye tablas `public.*` y, en la práctica, también objetos del schema `storage` (metadata de buckets/objetos). **No** incluye los binarios de Storage (archivos en S3); ver sección Storage abajo.

## Restaurar

Solo en un proyecto **vacío o de prueba**. No corras esto contra producción sin intención explícita.

```bash
# Crear DB destino / proyecto Supabase nuevo, luego:
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  -d "$SUPABASE_DB_URL_DESTINO" \
  backups/supabase-YYYYMMDDTHHMMSSZ.dump
```

Notas:

- `--clean --if-exists` borra objetos que choquen antes de recrearlos.
- Tras restaurar, vuelve a crear políticas/secrets de la app (`SUPABASE_SERVICE_ROLE_KEY`, etc.) en el proyecto destino.
- Storage: los paths en tablas (`storage_path`) apuntarán a objetos que **no** existen hasta que copies los buckets (abajo).

## Workflow semanal

Archivo: `.github/workflows/backup-semanal.yml`

- Cron semanal + `workflow_dispatch`.
- Artefacto `supabase-dump` con retención **30 días**.
- Lee solo el secret `SUPABASE_DB_URL`.

Primera corrida: Actions → **Backup semanal Supabase** → **Run workflow**.

## Storage (binarios)

Buckets usados por el código (todos privados vía service role):

| Bucket | Contenido |
| --- | --- |
| `hr-employee-docs` | Expedientes, contratos, exámenes, justif./reembolsos |
| `tpv-cortes` | Fotos venta/propina por terminal (hasta 8 MB/archivo) |
| `eventos-os-docs` | PDFs de órdenes de servicio (hasta 25 MB) |
| `calidad-encuestas` | Snapshot JSON de encuestas (`encuestas.json`) |

`pg_dump` **no** respalda esos archivos. Opciones (elige una; no automatizada en este PR):

1. **Dashboard** → Storage → descargar manual por bucket (poco práctico a escala).
2. **CLI / script** con service role: listar objetos y `storage.download` a un zip local o a un bucket S3/Drive tuyo (recomendada para `hr-employee-docs` y `tpv-cortes`).
3. Confiar en **Drive** como origen de muchos docs RH/OS (el suite ya sincroniza desde Drive) y tratar Storage como caché operativa — **no** aplica a fotos TPV ni a lo que solo vive en Supabase.

Propuesta mínima de respaldo Storage (manual o Action futura):

```bash
# Pseudocódigo — usa SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
# 1) Listar objetos de cada bucket
# 2) Descargar a backups/storage/<bucket>/...
# 3) Subir el zip como artefacto o a Drive
```

Prioridad: `hr-employee-docs` (PII) y `tpv-cortes` (evidencia diaria). `calidad-encuestas` es un JSON pequeño; `eventos-os-docs` si no están ya en Drive.

## Archivo TPV → Drive (mantener Free)

1. Ejecuta `supabase/tpv_cortes_archive.sql` en SQL Editor.
2. En Drive de **admin@carranza50.com.mx** crea p. ej. `Cortes TPV archivo` y copia el ID → secret/env `TPV_ARCHIVE_DRIVE_FOLDER_ID`.
3. Google Admin → Delegación a nivel de dominio → al Client ID del SA añade scope  
   `https://www.googleapis.com/auth/drive.file` (junto a calendar si aplica).
4. Impersonación: `GCAL_IMPERSONATE_USER=admin@carranza50.com.mx` (o `TPV_ARCHIVE_IMPERSONATE_USER`).
5. Corrida manual: Master → Cortes TPV → **Archivar lote**, o  
   `node scripts/archive-tpv-to-drive.mjs`  
   Workflow: `.github/workflows/archive-tpv-drive.yml` (días 1 y 15).

El historial se consulta en Master (`/admin/cortes-tpv` → fecha); fotos archivadas abren en Drive.

## Medir tamaño (SQL Editor, solo lectura)

Pega en Supabase → **SQL Editor** (no modifica datos):

```sql
-- Tamaño DB por tabla (public)
select
  n.nspname as schema,
  c.relname as relation,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total,
  pg_total_relation_size(c.oid) as bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'm')
order by pg_total_relation_size(c.oid) desc
limit 40;

-- Totales DB
select
  pg_size_pretty(pg_database_size(current_database())) as db_total,
  pg_database_size(current_database()) as db_bytes;

-- Storage: objetos por bucket
select
  bucket_id,
  count(*) as objects,
  pg_size_pretty(coalesce(sum(metadata->>'size')::bigint, 0)) as approx_size,
  coalesce(sum((metadata->>'size')::bigint), 0) as approx_bytes
from storage.objects
group by bucket_id
order by approx_bytes desc nulls last;
```

También: Master Panel → Almacenamiento (usa `admin_relation_size` sobre `financial_records`) o Usage en el dashboard de Supabase.
