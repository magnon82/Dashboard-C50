import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import type { HrScheduleStatus, HrScheduleWeek } from '@/app/lib/hr';
import {
  statusForImportedWeek,
  weekNumberForHorariosMonday,
} from '@/app/lib/hr-schedule-import';
import {
  mondayOfWeek,
  shiftMinutes,
  sundayOfWeek,
} from '@/app/lib/hr-schedule-propose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEEK_SELECT =
  'id, week_start, week_end, status, notes, created_by, published_by, published_at, created_at, updated_at';

/**
 * GET /api/hr/schedules — lista todas las semanas (RH).
 * ?status=propuesta|borrador|publicado
 * ?week_start=YYYY-MM-DD — filtra a esa semana ISO (lunes normalizado)
 * ?year=YYYY — filtra por año civil de week_start
 * ?limit=&offset= — paginación (default limit 500)
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const weekStartRaw = url.searchParams.get('week_start');
  const yearRaw = url.searchParams.get('year');
  const year =
    yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
  const limitRaw = Number(url.searchParams.get('limit') || 500);
  const offsetRaw = Number(url.searchParams.get('offset') || 0);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, Math.floor(limitRaw)), 500)
    : 500;
  const offset = Number.isFinite(offsetRaw)
    ? Math.max(0, Math.floor(offsetRaw))
    : 0;

  try {
    const sb = getServiceSupabase();
    let q = sb
      .from('hr_schedule_weeks')
      .select(WEEK_SELECT, { count: 'exact' })
      .order('week_start', { ascending: false })
      .range(offset, offset + limit - 1);

    if (
      status &&
      ['propuesta', 'borrador', 'publicado'].includes(status)
    ) {
      q = q.eq('status', status as HrScheduleStatus);
    }

    if (weekStartRaw && /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw.slice(0, 10))) {
      q = q.eq('week_start', mondayOfWeek(weekStartRaw.slice(0, 10)));
    }

    if (year != null) {
      q = q
        .gte('week_start', `${year}-01-01`)
        .lte('week_start', `${year}-12-31`);
    }

    const { data, error, count } = await q;
    if (error) {
      const missing = hrSchemaMissing(error.message);
      return NextResponse.json({
        ready: false,
        schemaMissing: missing,
        weeks: [] as HrScheduleWeek[],
        total: 0,
        years: year != null ? [year] : [],
        ...(year != null ? { year } : {}),
        message: missing
          ? 'Faltan tablas de RR.HH. Ejecuta supabase/hr_module.sql en Supabase.'
          : error.message,
      });
    }

    const weeks = (data || []) as HrScheduleWeek[];
    const ids = weeks.map((w) => w.id);

    // Conteos de turnos + años del filtro UI en paralelo
    const [shiftsRes, yearRowsRes] = await Promise.all([
      ids.length > 0
        ? sb
            .from('hr_schedule_shifts')
            .select('week_id, start_time, end_time')
            .in('week_id', ids)
        : Promise.resolve({ data: [] as { week_id: string; start_time: string | null; end_time: string | null }[] }),
      !weekStartRaw
        ? sb
            .from('hr_schedule_weeks')
            .select('week_start')
            .order('week_start', { ascending: false })
            .limit(500)
        : Promise.resolve({ data: null as { week_start: string }[] | null }),
    ]);

    const counts = new Map<string, number>();
    const hoursByWeek = new Map<string, number>();
    for (const s of shiftsRes.data || []) {
      const row = s as {
        week_id: string;
        start_time: string | null;
        end_time: string | null;
      };
      const wid = String(row.week_id);
      counts.set(wid, (counts.get(wid) || 0) + 1);
      const mins = shiftMinutes(row.start_time, row.end_time);
      if (mins > 0) {
        hoursByWeek.set(wid, (hoursByWeek.get(wid) || 0) + mins);
      }
    }

    let years: number[] = [];
    if (!weekStartRaw && yearRowsRes.data) {
      const set = new Set<number>();
      for (const r of yearRowsRes.data) {
        const y = Number(
          String((r as { week_start: string }).week_start).slice(0, 4)
        );
        if (Number.isFinite(y)) set.add(y);
      }
      years = [...set].sort((a, b) => b - a);
    }

    const total = count ?? weeks.length;
    const emptyHint =
      total === 0 && year != null
        ? `Sin semanas en ${year}. Si tienes «HORARIOS C50 ${year}.xlsx» en Descargas, se cargará automáticamente o usa «Importar horarios ${year}».`
        : total === 0
          ? 'Sin semanas de horario. Importa HORARIOS C50 desde Descargas o crea una semana nueva.'
          : null;

    return NextResponse.json({
      ready: true,
      schemaMissing: false,
      weeks: weeks.map((w) => {
        const ws = String(w.week_start).slice(0, 10);
        const mins = hoursByWeek.get(w.id) || 0;
        return {
          ...w,
          week_start: ws,
          week_end: String(w.week_end).slice(0, 10),
          shift_count: counts.get(w.id) || 0,
          hours_total: Math.round((mins / 60) * 10) / 10,
          week_number: weekNumberForHorariosMonday(ws),
        };
      }),
      total,
      limit,
      offset,
      years: years.length ? years : year != null ? [year] : [],
      message: emptyHint,
      ...(weekStartRaw
        ? { week_start: mondayOfWeek(weekStartRaw.slice(0, 10)) }
        : {}),
      ...(year != null ? { year } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    const missing = hrSchemaMissing(msg);
    return NextResponse.json(
      {
        ready: false,
        schemaMissing: missing,
        weeks: [],
        total: 0,
        message: missing
          ? 'Faltan tablas de RR.HH. Ejecuta supabase/hr_module.sql en Supabase.'
          : msg,
      },
      { status: 200 }
    );
  }
}

/**
 * POST /api/hr/schedules — crea semana vacía para planificar.
 * Pasado/en curso → publicado; futuras → borrador (hasta Publicar explícito).
 * Body: { week_start: YYYY-MM-DD, notes?: string }
 */
export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const weekStartRaw = String(body.week_start || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw)) {
    return NextResponse.json(
      { error: 'week_start (YYYY-MM-DD) es obligatorio' },
      { status: 400 }
    );
  }

  const weekStart = mondayOfWeek(weekStartRaw);
  const weekEnd = sundayOfWeek(weekStart);
  const status = statusForImportedWeek(weekStart);
  const notes =
    body.notes != null && String(body.notes).trim()
      ? String(body.notes).trim()
      : 'Semana vacía creada para planificación.';

  try {
    const sb = getServiceSupabase();
    const existing = await sb
      .from('hr_schedule_weeks')
      .select('id, status')
      .eq('week_start', weekStart)
      .maybeSingle();

    if (existing.data) {
      return NextResponse.json(
        {
          error: 'semana_existe',
          message: 'Ya existe una semana para esa fecha.',
          weekId: existing.data.id,
          status: existing.data.status,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const insert: Record<string, unknown> = {
      week_start: weekStart,
      week_end: weekEnd,
      status,
      notes,
      created_by: auth.username,
      updated_at: nowIso,
    };
    if (status === 'publicado') {
      insert.published_by = auth.username;
      insert.published_at = nowIso;
    }

    const { data: weekRow, error: weekErr } = await sb
      .from('hr_schedule_weeks')
      .insert(insert)
      .select(WEEK_SELECT)
      .single();

    if (weekErr || !weekRow) {
      return NextResponse.json(
        {
          error: hrSchemaMissing(weekErr?.message)
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : weekErr?.message || 'No se pudo crear la semana',
        },
        { status: 400 }
      );
    }

    const ws = String(weekRow.week_start).slice(0, 10);
    return NextResponse.json({
      ready: true,
      week: {
        ...weekRow,
        week_start: ws,
        week_end: String(weekRow.week_end).slice(0, 10),
        shift_count: 0,
        hours_total: 0,
        week_number: weekNumberForHorariosMonday(ws),
      },
      shifts: [],
      message:
        status === 'publicado'
          ? 'Semana vacía creada (publicada / en curso).'
          : 'Semana vacía creada (borrador).',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
