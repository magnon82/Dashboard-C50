import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireStaffOrRrhhSession,
} from '@/app/lib/hr-api';
import {
  todayIsoCdmx,
  upcomingBirthdays,
  type HrBirthdayUpcoming,
} from '@/app/lib/hr';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function probeFechaNacimientoColumn(
  sb: ReturnType<typeof getServiceSupabase>
): Promise<boolean> {
  const { error } = await sb
    .from('hr_employees')
    .select('fecha_nacimiento')
    .limit(1);
  if (
    error &&
    /fecha_nacimiento|column .* does not exist|42703/i.test(error.message || '')
  ) {
    return false;
  }
  return true;
}

/**
 * GET /api/hr/birthdays
 * Próximos cumpleaños (plantilla vigente), solo nombre + puesto + DOB.
 * Acceso: módulo `staff` o `rrhh` (sin email/sueldo/PII extra).
 */
export async function GET() {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const today = todayIsoCdmx();
    const nacimientoColumnOk = await probeFechaNacimientoColumn(sb);

    const resolved = await resolvePlantillaVigente(sb, {
      allowSeed: false,
      username: auth.username,
    });

    const lean = resolved.employees.map((e) => ({
      id: e.id,
      full_name: e.full_name,
      puesto: e.puesto ?? null,
      area: e.area ?? null,
      fecha_nacimiento: e.fecha_nacimiento
        ? String(e.fecha_nacimiento).slice(0, 10)
        : null,
    }));

    const upcoming: HrBirthdayUpcoming[] = nacimientoColumnOk
      ? upcomingBirthdays(lean, today)
      : [];

    const code = !nacimientoColumnOk
      ? 'nacimiento_schema_missing'
      : resolved.seedCode ?? 'ok';

    return NextResponse.json({
      ready: true,
      today,
      upcoming,
      count: upcoming.length,
      plantillaCount: lean.length,
      source: resolved.source,
      message: !nacimientoColumnOk
        ? 'Ejecuta supabase/hr_employee_nacimiento.sql en Supabase.'
        : resolved.seedMessage ||
          (lean.length === 0
            ? 'Sin plantilla vigente (nómina conciliada u horarios).'
            : null),
      code,
      nacimientoColumnMissing: !nacimientoColumnOk,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cargar cumpleaños';
    if (hrSchemaMissing(msg)) {
      return NextResponse.json({
        ready: false,
        today: todayIsoCdmx(),
        upcoming: [] as HrBirthdayUpcoming[],
        count: 0,
        plantillaCount: 0,
        message: msg,
        code: 'schema_missing',
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
