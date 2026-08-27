import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  canAccessModule,
  canEditHrSchedules,
  type SessionUser,
} from '@/app/lib/auth';
import {
  hrSchemaMissing,
  requireSchedulesSession,
  requireSchedulesWrite,
  requireStaffOrRrhhSession,
} from '@/app/lib/hr-api';
import {
  deleteScheduleCellNote,
  fetchScheduleCellNotes,
  fetchScheduleNotesSeenAt,
  markScheduleNotesSeen,
  upsertScheduleCellNote,
  type ScheduleNotesPanel,
} from '@/app/lib/hr-schedule-cell-notes';
import type { DualRoleTrack } from '@/app/lib/hr-schedule-grid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ weekId: string }> };

function parsePanel(raw: unknown): ScheduleNotesPanel | null {
  if (raw === 'rrhh' || raw === 'staff') return raw;
  return null;
}

function parseDualTrack(raw: unknown): DualRoleTrack | null {
  if (raw === 'limpieza' || raw === 'servicio') return raw;
  return null;
}

async function canReadWeekNotes(
  auth: SessionUser,
  weekId: string
): Promise<NextResponse | null> {
  if (canEditHrSchedules(auth)) return null;
  if (!canAccessModule(auth, 'staff') && !canAccessModule(auth, 'rrhh')) {
    return NextResponse.json({ error: 'Sin acceso a horarios' }, { status: 403 });
  }
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('hr_schedule_weeks')
    .select('status')
    .eq('id', weekId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Semana no encontrada' }, { status: 404 });
  }
  if (String(data.status) !== 'publicado' && !canAccessModule(auth, 'rrhh')) {
    return NextResponse.json(
      { error: 'Semana no publicada' },
      { status: 403 }
    );
  }
  return null;
}

/**
 * GET /api/hr/schedules/[weekId]/cell-notes?panel=rrhh|staff
 */
export async function GET(request: Request, ctx: Ctx) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const { weekId } = await ctx.params;
  if (!weekId) {
    return NextResponse.json({ error: 'weekId requerido' }, { status: 400 });
  }

  const url = new URL(request.url);
  const panel = parsePanel(url.searchParams.get('panel')) ?? 'rrhh';
  const denied = await canReadWeekNotes(auth, weekId);
  if (denied) return denied;

  try {
    const sb = getServiceSupabase();
    const [notesRes, seenRes] = await Promise.all([
      fetchScheduleCellNotes(sb, weekId),
      fetchScheduleNotesSeenAt(sb, weekId, auth.username, panel),
    ]);
    return NextResponse.json({
      ready: true,
      notes: notesRes.notes,
      notesSeenAt: seenRes.seenAt,
      tableMissing: notesRes.tableMissing || seenRes.tableMissing,
      hint: notesRes.tableMissing
        ? 'Ejecuta supabase/hr_schedule_cell_notes.sql en Supabase.'
        : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hr/schedules/[weekId]/cell-notes
 * Body: { employee_id, shift_date, dual_track?, note }
 */
export async function PUT(request: Request, ctx: Ctx) {
  const auth = await requireSchedulesSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireSchedulesWrite(auth);
  if (denied) return denied;

  const { weekId } = await ctx.params;
  if (!weekId) {
    return NextResponse.json({ error: 'weekId requerido' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const employeeId = String(body.employee_id || '').trim();
  const shiftDate = String(body.shift_date || '').slice(0, 10);
  const note = String(body.note ?? '');
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
    return NextResponse.json(
      { error: 'employee_id y shift_date (YYYY-MM-DD) requeridos' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const saved = await upsertScheduleCellNote(sb, {
      weekId,
      employeeId,
      shiftDate,
      dualTrack: parseDualTrack(body.dual_track),
      note,
      username: auth.username,
    });
    return NextResponse.json({
      ok: true,
      note: saved,
      message: 'Nota guardada · alerta enviada al panel',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (/does not exist|42P01/i.test(msg)) {
      return NextResponse.json(
        {
          error: 'Falta schema de notas de horario',
          hint: 'Ejecuta supabase/hr_schedule_cell_notes.sql en Supabase.',
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * DELETE /api/hr/schedules/[weekId]/cell-notes
 * Body: { employee_id, shift_date, dual_track? }
 */
export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await requireSchedulesSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireSchedulesWrite(auth);
  if (denied) return denied;

  const { weekId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const employeeId = String(body.employee_id || '').trim();
  const shiftDate = String(body.shift_date || '').slice(0, 10);
  if (!employeeId || !shiftDate) {
    return NextResponse.json({ error: 'Parámetros incompletos' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    await deleteScheduleCellNote(sb, {
      weekId,
      employeeId,
      shiftDate,
      dualTrack: parseDualTrack(body.dual_track),
    });
    return NextResponse.json({ ok: true, message: 'Nota eliminada' });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 400 }
    );
  }
}

/**
 * POST /api/hr/schedules/[weekId]/cell-notes
 * Body: { action: 'mark_seen', panel: 'rrhh'|'staff' }
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const { weekId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.action !== 'mark_seen') {
    return NextResponse.json({ error: 'action no soportada' }, { status: 400 });
  }

  const panel = parsePanel(body.panel) ?? 'rrhh';
  const denied = await canReadWeekNotes(auth, weekId);
  if (denied) return denied;

  try {
    const sb = getServiceSupabase();
    await markScheduleNotesSeen(sb, weekId, auth.username, panel);
    return NextResponse.json({
      ok: true,
      notesSeenAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 400 }
    );
  }
}
