import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { hrSchemaMissing, requireRrhhSession } from '@/app/lib/hr-api';
import { reconcileAttendanceWeek } from '@/app/lib/hr-attendance-reconcile';
import type { ParsedAttendancePunch } from '@/app/lib/hr-attendance-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/attendance/[id] — detalle + cotejo vs horario + narrativa incidencias.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data: report, error } = await sb
      .from('hr_attendance_reports')
      .select(
        'id, week_start, week_end, week_number, source_filename, uploaded_by, status, punch_count, notes, created_at'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (hrSchemaMissing(error.message)) {
        return NextResponse.json({
          ready: false,
          message: 'Ejecuta supabase/hr_attendance.sql en Supabase.',
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!report) {
      return NextResponse.json({ error: 'Reporte no encontrado' }, { status: 404 });
    }

    const { data: punches, error: pErr } = await sb
      .from('hr_attendance_punches')
      .select(
        'id, employee_id, employee_name_raw, punch_date, punch_time, punch_kind'
      )
      .eq('report_id', id)
      .order('punch_date', { ascending: true })
      .order('punch_time', { ascending: true });

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 });
    }

    const parsed: ParsedAttendancePunch[] = (punches || []).map((p) => ({
      employee_name_raw: String(p.employee_name_raw),
      punch_date: String(p.punch_date).slice(0, 10),
      punch_time: String(p.punch_time).slice(0, 5),
      punch_kind: (p.punch_kind as 'in' | 'out' | 'unknown') || 'unknown',
    }));

    const reconcile = await reconcileAttendanceWeek(sb, {
      weekStart: String(report.week_start).slice(0, 10),
      weekEnd: String(report.week_end).slice(0, 10),
      punches: parsed,
    });

    return NextResponse.json({
      ready: true,
      report,
      punchCount: parsed.length,
      reconcile,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
