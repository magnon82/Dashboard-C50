'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatHrDate } from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import { DAY_HEADERS } from '@/app/lib/hr-schedule-grid';
import type {
  HrScheduleCellNote,
  ScheduleNotesPanel,
} from '@/app/lib/hr-schedule-cell-notes';
import { unreadCellNotes } from '@/app/lib/hr-schedule-cell-notes';
import { SUITE } from '@/app/lib/themes';

export function HrScheduleNotesAlert({
  weekId,
  panel,
  notes,
  notesSeenAt,
  dates,
  employeeNames,
  onSeen,
}: {
  weekId: string;
  panel: ScheduleNotesPanel;
  notes: HrScheduleCellNote[];
  notesSeenAt: string | null;
  dates: string[];
  employeeNames: Map<string, string>;
  onSeen: (seenAt: string) => void;
}) {
  const unread = useMemo(
    () => unreadCellNotes(notes, notesSeenAt),
    [notes, notesSeenAt]
  );
  const [busy, setBusy] = useState(false);

  if (!unread.length) return null;

  async function markSeen() {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/schedules/${weekId}/cell-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_seen', panel }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        onSeen(String(json.notesSeenAt || new Date().toISOString()));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">
            {unread.length === 1
              ? '1 nota nueva en horarios'
              : `${unread.length} notas nuevas en horarios`}
          </p>
          <p className="mt-0.5 text-xs text-amber-900/80">
            Visible para quien tenga acceso a este panel.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void markSeen()}
          className="rounded-full bg-amber-800 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          Entendido
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {unread.slice(0, 6).map((n) => {
          const di = dates.findIndex((d) => d.slice(0, 10) === n.shift_date);
          const dayLabel = di >= 0 ? DAY_HEADERS[di] : n.shift_date.slice(5);
          const name =
            employeeNames.get(n.employee_id) ||
            (n.employee_name ? formatHrListName(n.employee_name) : 'Colaborador');
          return (
            <li
              key={n.id}
              className="rounded-lg border border-amber-100 bg-white/80 px-2.5 py-2 text-xs"
            >
              <p className="font-semibold">
                {name} · {dayLabel}{' '}
                {formatHrDate(n.shift_date).replace(/^\w+\s/, '')}
                {n.dual_track ? ` · ${n.dual_track}` : ''}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{n.note}</p>
              {n.created_by ? (
                <p className="mt-1 text-[10px] text-slate-500">@{n.created_by}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {unread.length > 6 ? (
        <p className="mt-1 text-[11px] text-amber-900/70">
          + {unread.length - 6} más en la grilla (ícono de nota).
        </p>
      ) : null}
    </section>
  );
}

export function HrScheduleCellNoteEditor({
  open,
  title,
  subtitle,
  initialNote,
  canEdit,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  initialNote?: string | null;
  canEdit: boolean;
  busy?: boolean;
  onClose: () => void;
  onSave: (note: string) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [text, setText] = useState(initialNote || '');

  useEffect(() => {
    if (open) setText(initialNote || '');
  }, [open, initialNote]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-label="Nota de horario"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <h3 className="text-base font-bold" style={{ color: SUITE.navy }}>
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        ) : null}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canEdit || busy}
          rows={5}
          placeholder={
            canEdit
              ? 'Ej. Se presenta 13–19 h por ausencia de…'
              : 'Sin permiso de edición'
          }
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
        />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {canEdit && onDelete && initialNote ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete()}
              className="mr-auto rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:opacity-50"
            >
              Eliminar
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
          >
            Cerrar
          </button>
          {canEdit ? (
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={() => void onSave(text.trim())}
              className="rounded-full px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: SUITE.navy }}
            >
              Guardar nota
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function HrScheduleCellNoteButton({
  hasNote,
  disabled,
  onClick,
}: {
  hasNote: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={hasNote ? 'Ver o editar nota' : 'Agregar nota'}
      aria-label={hasNote ? 'Nota en este día' : 'Agregar nota'}
      onClick={onClick}
      className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold disabled:opacity-40 ${
        hasNote
          ? 'bg-violet-100 text-violet-900 ring-1 ring-violet-300'
          : 'bg-slate-100 text-slate-500'
      }`}
    >
      {hasNote ? 'N' : '+N'}
    </button>
  );
}
