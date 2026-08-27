import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import { parseAttendanceWorkbook } from '@/app/lib/hr-attendance-import';
import { reconcileAttendanceWeek } from '@/app/lib/hr-attendance-reconcile';
import { matchEmployeeId, normalizePersonKey } from '@/app/lib/hr-person-match';
import { mondayOfWeek, sundayOfWeek } from '@/app/lib/hr-schedule-propose';
import { todayIsoCdmx } from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/attendance — lista reportes importados.
 * POST multipart — sube xlsx del checador, guarda checadas y devuelve cotejo.
 */
export async function GET() {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_attendance_reports')
      .select(
        'id, week_start, week_end, week_number, source_filename, uploaded_by, status, punch_count, notes, created_at'
      )
      .order('week_start', { ascending: false })
      .limit(40);

    if (error) {
      if (hrSchemaMissing(error.message)) {
        return NextResponse.json({
          ready: false,
          reports: [],
          message:
            'Ejecuta supabase/hr_attendance.sql en Supabase (proyecto Dashbord Financiero C50).',
        });
      }
      return NextResponse.json(
        { ready: false, error: error.message, reports: [] },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ready: true,
      reports: data || [],
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        error: e instanceof Error ? e.message : 'Error',
        reports: [],
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file requerido' }, { status: 400 });
    }
    if (!/\.xlsx$/i.test(file.name)) {
      return NextResponse.json(
        { error: 'Solo se acepta .xlsx del reloj checador' },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseAttendanceWorkbook(buf, { filename: file.name });
    if (!parsed.punches.length) {
      return NextResponse.json(
        {
          error: 'Sin checadas en el archivo',
          warnings: parsed.warnings,
        },
        { status: 400 }
      );
    }

    const weekStart =
      parsed.week_start ||
      mondayOfWeek(parsed.punches[0]?.punch_date || todayIsoCdmx());
    const weekEnd = parsed.week_end || sundayOfWeek(weekStart);

    const sb = getServiceSupabase();

    const { data: empData } = await sb
      .from('hr_employees')
      .select('id, full_name')
      .neq('status', 'baja');
    const employees = (empData || []) as { id: string; full_name: string }[];
    const byKey = new Map(
      employees.map((e) => [normalizePersonKey(e.full_name), e] as const)
    );

    const { data: report, error: repErr } = await sb
      .from('hr_attendance_reports')
      .insert({
        week_start: weekStart,
        week_end: weekEnd,
        week_number: parsed.week_number,
        source_filename: file.name,
        uploaded_by: auth.username,
        status: 'importado',
        punch_count: parsed.punches.length,
        notes: parsed.warnings.length
          ? parsed.warnings.slice(0, 5).join(' · ')
          : null,
        updated_at: new Date().toISOString(),
      })
      .select(
        'id, week_start, week_end, week_number, source_filename, uploaded_by, status, punch_count, notes, created_at'
      )
      .single();

    if (repErr) {
      if (hrSchemaMissing(repErr.message)) {
        return NextResponse.json(
          {
            error:
              'Ejecuta supabase/hr_attendance.sql en Supabase antes de importar.',
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: repErr.message }, { status: 500 });
    }

    const rows = parsed.punches.map((p) => ({
      report_id: report.id,
      employee_id: matchEmployeeId(p.employee_name_raw, byKey, employees),
      employee_name_raw: p.employee_name_raw,
      punch_date: p.punch_date,
      punch_time: p.punch_time.length === 5 ? `${p.punch_time}:00` : p.punch_time,
      punch_kind: p.punch_kind,
    }));

    // Batch insert
    const chunk = 400;
    for (let i = 0; i < rows.length; i += chunk) {
      const { error: pErr } = await sb
        .from('hr_attendance_punches')
        .insert(rows.slice(i, i + chunk));
      if (pErr) {
        await sb.from('hr_attendance_reports').delete().eq('id', report.id);
        return NextResponse.json({ error: pErr.message }, { status: 500 });
      }
    }

    const reconcile = await reconcileAttendanceWeek(sb, {
      weekStart,
      weekEnd,
      punches: parsed.punches,
    });

    return NextResponse.json({
      ready: true,
      report,
      warnings: parsed.warnings,
      reconcile,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al importar' },
      { status: 500 }
    );
  }
}
