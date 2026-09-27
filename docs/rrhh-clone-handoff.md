# Handoff — clonar módulo RR.HH. (Carranza 50 / BMS)

**Para:** otro agente / otro repo de otra empresa  
**Origen:** `mi-dashboard-financiero` (Dashboard C50)  
**Alcance:** solo Recursos Humanos. **No** clonar Finanzas, Eventos, Cortes, TPV, Socios, Master sync de bancos.

Fecha de empaque: 2026-09-24  
Commit de referencia en producción al empaquetar: `96d22fc` (+ WIP local de tope 2.5 MB fotos en `hr-doc-scan` / API perfil).

---

## 1. Qué es el producto

Dos caras:

| Superficie | Quién | Ruta |
|------------|-------|------|
| Gestión RH | Gerentes / RH (módulo permiso `rrhh`) | `/rrhh` |
| Staff | Personal | `/staff` (+ `/staff/horario`, etc.) |

Tabs en `/rrhh` (shell): **Plantilla · Horarios · Asistencia · Nómina · Vacaciones · Cumpleaños · Biblioteca**.

Reglas de negocio clave (no inventar otras):

1. **Plantilla vigente** = unión de (última nómina conciliada `pagado`→`cerrado`) ∪ (última semana de horarios con turnos reales). Ver `app/lib/hr-plantilla.ts`.
2. **Horarios:** semanas pasadas = `publicado` solo lectura; en curso = publicado; futuras = `borrador` hasta Publicar explícito. Despublicar rechazado.
3. **Nómina:** `borrador` → `cerrado` → `pagado`. Soft-load desde xlsx/Sheet.
4. **Docs:** fotos ≤ **2.5 MB** (`app/lib/hr-doc-limits.ts` + `hr-doc-scan.ts`). PDF hasta 10 MB.
5. **Staff** no mete el editor de gestión dentro de `/rrhh`; excepción: editores con `rrhh` o `rrhh.schedules_edit` ven el mismo `RrhhHorarios` en `/staff/horario`.

Detalle de fases: `.cursor/rules/hr-dashboard-pending.mdc` (incluido en el zip).

---

## 2. Mapa de archivos (incluido en `rrhh-export/`)

```
app/rrhh/                          # página shell
app/components/rrhh/               # UI de gestión
app/api/hr/                        # APIs REST
app/lib/hr*.ts                     # dominio (plantilla, nómina, horarios, docs…)
app/lib/hr-doc-scan.ts
app/lib/hr-doc-limits.ts
supabase/hr_*.sql                  # schema + patches (arrancar con hr_module.sql)

# Staff ligado a RH (sin Cortes/Propinas)
app/staff/page.tsx
app/staff/horario/
app/staff/vacaciones/
app/staff/cumpleanos/
app/staff/resguardo/
app/staff/perfil/
app/components/staff/StaffHorarioClient.tsx
app/components/staff/StaffVacacionesClient.tsx
app/components/staff/StaffCumpleanosClient.tsx
app/components/staff/StaffResguardoClient.tsx

scripts/hr-*.mjs                   # utilidades ops (opcional)
.cursor/rules/hr-dashboard-pending.mdc
```

**No incluido a propósito:** `StaffCorteClient`, `staff/corte`, `staff/propinas`, finanzas, eventos, TPV.

---

## 3. APIs (`/api/hr/*`)

| Área | Rutas típicas |
|------|----------------|
| Empleados / perfil / docs | `GET/POST /api/hr/employees`, `/employees/[id]/profile`, `doc-alerts`, `pull-docs`, `docs-review` |
| Expedientes | `GET /api/hr/expedientes` |
| Horarios | `/schedules`, `/schedules/[weekId]`, `/schedules/mine`, `/availability`, `propose`, `import`, `cell-notes` |
| Nómina | `/payroll`, `/payroll/import` |
| Vacaciones | `/leave-requests`, `/leave-balances`, `/leave-balances/mine` |
| Asistencia | `/attendance`, `/attendance/[id]` |
| Biblioteca / sync | `/docs`, `/sync` |
| Resguardo | `/resguardo`, `/resguardo/mine` |
| Otros | `/summary`, `/birthdays`, `/alerts/mine` |

Auth: sesión Suite + `requireRrhhSession` / writes vía `app/lib/hr-api.ts`. Permiso módulo: **`rrhh`**. Capacidad Master opcional: `rrhh.schedules_edit`.

---

## 4. Datos (Supabase)

1. Ejecutar **`supabase/hr_module.sql`** primero.
2. Luego patches `supabase/hr_*.sql` según necesidad (puestos, baja, docs, leave form, attendance, drive sync, etc.).
3. Storage bucket docs: constante `HR_DOCS_BUCKET` en `hr-employee-profile.ts`.
4. Tablas núcleo (nombres orientativos): `hr_employees`, `hr_payroll_periods` / `hr_payroll_lines`, `hr_schedule_weeks` / shifts, `hr_leave_*`, `hr_doc_links`, resguardo, attendance, exams, contracts.

Producción C50: datos viven en Supabase; Drive File Stream solo en PC admin para refrescar/abrir. Vercel no monta `I:\`.

---

## 5. Dependencias del BMS que habrá que reimplementar o stubbear

El código importa módulos compartidos **fuera** de este zip. Al clonar, sustituir o copiar mínimo:

| Dependencia | Uso en RRHH |
|-------------|-------------|
| `@/app/lib/themes` (`SUITE`) | Colores UI |
| `@/app/lib/auth` / `users` | Sesión, `canSeeModule`, service Supabase |
| `@/app/lib/hr-api` | Ya va en el pack; depende de auth |
| `@/app/lib/google-drive-auth` | Sync Drive / export nómina (opcional) |
| Layout / nav del BMS | Link a `/rrhh` y permiso `rrhh` |
| Next.js App Router | Mismo patrón `app/` |

**No** hace falta clonar ingestors de bancos, Infocaja, eventos, TPV OCR.

Env útiles (C50; renombrar para la otra empresa):

- `HR_NOMINA_DRIVE_FOLDER_ID`, `HR_EXPEDIENTES_DRIVE_FOLDER_ID`, `HR_DOCS_VIGENTE_DRIVE_FOLDER_ID`
- Supabase URL + service role
- OAuth Google si usan Drive/Sheets

---

## 6. Cómo usar este pack (instrucciones al otro agente)

1. Leer este archivo completo y `hr-dashboard-pending.mdc`.
2. Montar schema SQL en un proyecto Supabase limpio.
3. Copiar árboles `app/rrhh`, `components/rrhh`, `api/hr`, `lib/hr*` al nuevo repo.
4. Adaptar branding (`SUITE` / nombre empresa) y permiso `rrhh`.
5. Cablear auth; stubear Drive si no lo usan al inicio.
6. **No** portar datos de empleados C50 (PII). Solo código + schema.
7. Validar flujos: alta en Plantilla → docs ≤2.5 MB → semana horarios → nómina borrador→pagado → vacaciones RH.

---

## 7. Fuera de alcance / diferido en C50

- Propuesta automática de horarios (UI) — `hr-schedule-propose` existe, UI diferida.
- Self-serve vacaciones Staff (UI lista; card hub oculta hasta `suite_username` por empleado).
- CLUSTER / finanzas / 8% facturas — **no** parte de RRHH.

---

## 8. Inventario rápido UI

| Tab | Componente principal |
|-----|----------------------|
| Plantilla | `RrhhPlantilla` + `RrhhEmployeeProfile` + expedientes/resguardo |
| Horarios | `RrhhHorarios` (+ mobile) |
| Asistencia | `RrhhAsistencia` |
| Nómina | `RrhhNomina` |
| Vacaciones | `RrhhVacaciones` |
| Cumpleaños | `RrhhCumpleanos` |
| Biblioteca | `RrhhBiblioteca` |
| Escaneo docs | `HrDocScanPicker` + `HrDocViewer` |

---

## 9. Contenido del zip

- `README.md` → este handoff  
- `MANIFEST.txt` → lista de archivos copiados  
- Árbol `app/`, `supabase/`, `scripts/`, `.cursor/rules/` según §2  

Ruta local del pack:  
`C:\Users\magno\OneDrive\Documentos\Cursor Proyects\mi-dashboard-financiero\rrhh-export\`  
Zip: `rrhh-export-c50.zip` (misma carpeta padre del repo o dentro de `rrhh-export`).
