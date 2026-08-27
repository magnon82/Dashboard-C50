import type { SupabaseClient } from '@supabase/supabase-js';
import type { DualRoleTrack, PersonRow } from '@/app/lib/hr-schedule-grid';

export type ScheduleNotesPanel = 'rrhh' | 'staff';

export type HrScheduleCellNote = {
  id: string;
  week_id: string;
  employee_id: string;
  shift_date: string;
  dual_track: DualRoleTrack | null;
  note: string;
  created_by: string | null;
  updated_at: string;
  employee_name?: string | null;
};

export function cellNotesTableMissing(err: { message?: string } | null): boolean {
  const msg = String(err?.message || '');
  return /hr_schedule_cell_notes|hr_schedule_note_reads|does not exist|42P01|42703/i.test(
    msg
  );
}

export function unreadCellNotes(
  notes: HrScheduleCellNote[],
  seenAt: string | null | undefined
): HrScheduleCellNote[] {
  if (!notes.length) return [];
  if (!seenAt) return [...notes];
  const seenMs = Date.parse(seenAt);
  if (Number.isNaN(seenMs)) return [...notes];
  return notes.filter((n) => {
    const t = Date.parse(n.updated_at);
    return !Number.isNaN(t) && t > seenMs;
  });
}

export function applyCellNotesToRows(
  rows: PersonRow[],
  dates: string[],
  notes: HrScheduleCellNote[]
): PersonRow[] {
  if (!notes.length) return rows;
  const byKey = new Map<string, HrScheduleCellNote>();
  for (const n of notes) {
    const track = n.dual_track ?? '';
    byKey.set(`${n.employee_id}|${n.shift_date.slice(0, 10)}|${track}`, n);
  }
  return rows.map((row) => ({
    ...row,
    days: row.days.map((d, di) => {
      const date = dates[di]?.slice(0, 10);
      if (!date) return d;
      const track = row.dualTrack ?? '';
      const hit = byKey.get(`${row.employee_id}|${date}|${track}`);
      if (!hit) return d;
      return {
        ...d,
        staffNote: hit.note,
        staffNoteAt: hit.updated_at,
        staffNoteBy: hit.created_by,
      };
    }),
  }));
}

function dualTrackDb(track: DualRoleTrack | null): string {
  return track ?? '';
}

function dualTrackFromDb(raw: unknown): DualRoleTrack | null {
  const t = String(raw ?? '');
  return t === 'limpieza' || t === 'servicio' ? t : null;
}

function mapNoteRow(raw: Record<string, unknown>): HrScheduleCellNote {
  const emp = raw.hr_employees as { full_name?: string } | null | undefined;
  return {
    id: String(raw.id),
    week_id: String(raw.week_id),
    employee_id: String(raw.employee_id),
    shift_date: String(raw.shift_date).slice(0, 10),
    dual_track: dualTrackFromDb(raw.dual_track),
    note: String(raw.note || '').trim(),
    created_by: raw.created_by != null ? String(raw.created_by) : null,
    updated_at: String(raw.updated_at || new Date().toISOString()),
    employee_name: emp?.full_name ?? null,
  };
}

export async function fetchScheduleCellNotes(
  sb: SupabaseClient,
  weekId: string
): Promise<{ notes: HrScheduleCellNote[]; tableMissing: boolean }> {
  const res = await sb
    .from('hr_schedule_cell_notes')
    .select(
      'id, week_id, employee_id, shift_date, dual_track, note, created_by, updated_at, hr_employees(full_name)'
    )
    .eq('week_id', weekId)
    .order('updated_at', { ascending: false });
  if (res.error) {
    if (cellNotesTableMissing(res.error)) {
      return { notes: [], tableMissing: true };
    }
    throw new Error(res.error.message);
  }
  return {
    notes: (res.data || []).map((r) =>
      mapNoteRow(r as Record<string, unknown>)
    ),
    tableMissing: false,
  };
}

export async function fetchScheduleNotesSeenAt(
  sb: SupabaseClient,
  weekId: string,
  username: string,
  panel: ScheduleNotesPanel
): Promise<{ seenAt: string | null; tableMissing: boolean }> {
  const res = await sb
    .from('hr_schedule_note_reads')
    .select('seen_at')
    .eq('week_id', weekId)
    .eq('username', username.trim().toLowerCase())
    .eq('panel', panel)
    .maybeSingle();
  if (res.error) {
    if (cellNotesTableMissing(res.error)) {
      return { seenAt: null, tableMissing: true };
    }
    throw new Error(res.error.message);
  }
  return {
    seenAt: res.data?.seen_at ? String(res.data.seen_at) : null,
    tableMissing: false,
  };
}

export async function markScheduleNotesSeen(
  sb: SupabaseClient,
  weekId: string,
  username: string,
  panel: ScheduleNotesPanel
): Promise<void> {
  const now = new Date().toISOString();
  const user = username.trim().toLowerCase();
  const { error } = await sb.from('hr_schedule_note_reads').upsert(
    {
      username: user,
      panel,
      week_id: weekId,
      seen_at: now,
    },
    { onConflict: 'username,panel,week_id' }
  );
  if (error && !cellNotesTableMissing(error)) {
    throw new Error(error.message);
  }
}

export async function upsertScheduleCellNote(
  sb: SupabaseClient,
  input: {
    weekId: string;
    employeeId: string;
    shiftDate: string;
    dualTrack: DualRoleTrack | null;
    note: string;
    username: string;
  }
): Promise<HrScheduleCellNote> {
  const trimmed = input.note.trim();
  if (!trimmed) {
    throw new Error('La nota no puede estar vacía');
  }
  const now = new Date().toISOString();
  const row = {
    week_id: input.weekId,
    employee_id: input.employeeId,
    shift_date: input.shiftDate.slice(0, 10),
    dual_track: dualTrackDb(input.dualTrack),
    note: trimmed,
    created_by: input.username.trim().toLowerCase(),
    updated_at: now,
  };
  const { data, error } = await sb
    .from('hr_schedule_cell_notes')
    .upsert(row, {
      onConflict: 'week_id,employee_id,shift_date,dual_track',
    })
    .select(
      'id, week_id, employee_id, shift_date, dual_track, note, created_by, updated_at, hr_employees(full_name)'
    )
    .single();
  if (error) throw new Error(error.message);
  return mapNoteRow(data as Record<string, unknown>);
}

export async function deleteScheduleCellNote(
  sb: SupabaseClient,
  input: {
    weekId: string;
    employeeId: string;
    shiftDate: string;
    dualTrack: DualRoleTrack | null;
  }
): Promise<void> {
  let q = sb
    .from('hr_schedule_cell_notes')
    .delete()
    .eq('week_id', input.weekId)
    .eq('employee_id', input.employeeId)
    .eq('shift_date', input.shiftDate.slice(0, 10));
  if (input.dualTrack) q = q.eq('dual_track', input.dualTrack);
  else q = q.eq('dual_track', '');
  const { error } = await q;
  if (error) throw new Error(error.message);
}
