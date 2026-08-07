-- =============================================================================
-- Staff Corte — semántica efectivo recibido vs tómbola
-- =============================================================================
-- No agrega columnas nuevas: reutiliza las existentes.
--
--   efectivo_contado  = Efectivo recibido del día (captura MANUAL al cerrar)
--   efectivo_tombola  = Efectivo depositado en tómbola DESPUÉS de propinas (manual)
--   efectivo_infocaja = Snapshot Infocaja Efectivo cuando ya existe el reporte
--
-- Flujo ops: Infocaja casi nunca llega antes del cierre → ambos montos se
-- capturan a mano. Cuando llega el correo Infocaja, se concilia
-- efectivo_contado ≈ Infocaja Efectivo (tolerancia $1).
--
-- Filas antiguas: contado y tómbola se guardaban iguales (un solo campo UI).
-- Cómo aplicar: SQL Editor → Run (idempotente; solo comentarios).
-- =============================================================================

comment on column public.staff_rpt_diario.efectivo_contado is
  'Efectivo recibido del día (manual en cierre Staff). Se concilia post-hoc vs Infocaja Efectivo.';

comment on column public.staff_rpt_diario.efectivo_tombola is
  'Efectivo depositado en tómbola después de propinas (manual en cierre Staff).';

comment on column public.staff_rpt_diario.efectivo_infocaja is
  'Snapshot Infocaja Efectivo al momento del cierre (null si el reporte aún no había llegado).';
