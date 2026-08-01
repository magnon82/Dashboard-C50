'use client';

import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { filterControlClass, filterSelectClass } from '@/app/components/SectionHeader';
import {
  EVENTOS_MIN_PAX_GRUPOS,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  formatMxn,
  type EventClient,
  type EventLead,
  type LeadStage,
} from '@/app/lib/eventos';
import { EventosPaxCounter } from '@/app/components/eventos/EventosPaxCounter';
import {
  EventosFollowUpAlertsStrip,
  EventosLeadAlertBadge,
  EventosLeadFollowUpChecklist,
} from '@/app/components/eventos/EventosFollowUpPanel';
import { getTheme, SUITE } from '@/app/lib/themes';
import { useSession } from '@/app/lib/useSession';

const theme = getTheme('suite');

const SOURCE_LABELS: Record<string, string> = {
  seguimiento: 'Seguimiento',
  anticipos_c50: 'Anticipos C50',
  os_pdf: 'OS / PDF',
  excel_seed: 'Excel',
  manual: 'Manual',
};

type ActivityHistRow = {
  client_key: string;
  company_name: string | null;
  contact_name?: string | null;
  last_activity_at: string | null;
  last_activity_source: string | null;
  activity_count: number;
  matched_seed?: boolean;
  sources?: string[];
  timeline?: Array<{
    date: string;
    source: string;
    label?: string | null;
    detail?: string | null;
  }>;
};

export function EventosCrm({
  clients,
  leads,
  loading,
  onRefresh,
  dbReady = true,
}: {
  clients: EventClient[];
  leads: EventLead[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  /** false si las tablas Eventos aún no existen en Supabase */
  dbReady?: boolean;
}) {
  const { user } = useSession();
  const canEdit = !!user?.canEdit;
  const [q, setQ] = useState('');
  const [view, setView] = useState<'pipeline' | 'clientes' | 'historial'>(
    'pipeline'
  );
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Lead con checklist de seguimiento abierto en el pipeline. */
  const [followUpOpen, setFollowUpOpen] = useState<string | null>(null);
  const [hist, setHist] = useState<ActivityHistRow[]>([]);
  const [histMeta, setHistMeta] = useState<{
    generated_at?: string;
    ready?: boolean;
    error?: string;
    stats?: { with_activity?: number; events_total?: number };
  } | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  const [clientForm, setClientForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
  });
  const [leadForm, setLeadForm] = useState({
    contact_name: '',
    phone: '',
    email: '',
    company: '',
    celebration: '',
    event_date: '',
    pax: EVENTOS_MIN_PAX_GRUPOS,
    estimated_amount: '',
    notes: '',
    place_hold: false,
  });

  const filteredClients = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((c) =>
      [c.company_name, c.contact_name, c.email, c.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [clients, q]);

  const withActivityCount = useMemo(
    () => clients.filter((c) => c.last_activity_at).length,
    [clients]
  );

  useEffect(() => {
    if (view !== 'historial') return;
    let cancelled = false;
    (async () => {
      setHistLoading(true);
      try {
        const res = await fetch('/api/eventos/activity?limit=120', {
          cache: 'no-store',
        });
        const json = await res.json();
        if (cancelled) return;
        setHistMeta({
          generated_at: json.generated_at,
          ready: json.ready,
          error: json.error,
          stats: json.stats,
        });
        setHist(json.clients || []);
      } catch {
        if (!cancelled) {
          setHistMeta({
            ready: false,
            error: 'Error de red al cargar historial',
          });
          setHist([]);
        }
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  async function seedClients() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/eventos/clients/seed', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo importar');
        return;
      }
      setMsg(
        `Importados ${json.inserted} clientes (omitidos ${json.skipped} de ${json.totalSeed}).`
      );
      await onRefresh();
    } catch {
      setErr('Error de red al importar seed');
    } finally {
      setBusy(false);
    }
  }

  async function createClient(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/eventos/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientForm),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo crear cliente');
        return;
      }
      setMsg(`Cliente ${clientForm.company_name} creado`);
      setClientForm({
        company_name: '',
        contact_name: '',
        email: '',
        phone: '',
      });
      await onRefresh();
    } catch {
      setErr('Error de red al crear cliente');
    } finally {
      setBusy(false);
    }
  }

  async function createLead(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const celebration = leadForm.celebration.trim();
      const res = await fetch('/api/eventos/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          celebration,
          title: celebration,
          contact_name: leadForm.contact_name.trim() || null,
          phone: leadForm.phone.trim() || null,
          email: leadForm.email.trim() || null,
          company: leadForm.company.trim() || null,
          event_date: leadForm.event_date || null,
          pax: leadForm.pax,
          estimated_amount: leadForm.estimated_amount
            ? Number(leadForm.estimated_amount)
            : null,
          notes: leadForm.notes.trim() || null,
          place_hold: leadForm.place_hold,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo crear lead');
        return;
      }
      let holdNote = '';
      if (leadForm.place_hold && json.lead?.id) {
        try {
          const holdRes = await fetch('/api/eventos/holds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: celebration,
              event_date: leadForm.event_date || null,
              client: leadForm.company.trim() || null,
              lead_id: json.lead.id,
              hold_until: json.lead.hold_until || null,
              notes: leadForm.notes.trim() || null,
            }),
          });
          const holdJson = await holdRes.json();
          if (holdJson.message) holdNote = ` · ${holdJson.message}`;
        } catch {
          holdNote =
            ' · Hold local ok; sync GCal no disponible (revisa GCAL_CALENDAR_ID).';
        }
      }
      setMsg(`Lead creado${holdNote}`);
      setLeadForm({
        contact_name: '',
        phone: '',
        email: '',
        company: '',
        celebration: '',
        event_date: '',
        pax: EVENTOS_MIN_PAX_GRUPOS,
        estimated_amount: '',
        notes: '',
        place_hold: false,
      });
      await onRefresh();
    } catch {
      setErr('Error de red al crear lead');
    } finally {
      setBusy(false);
    }
  }

  async function moveLead(id: string, stage: LeadStage) {
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/eventos/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, stage }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo mover lead');
        return;
      }
      await onRefresh();
    } catch {
      setErr('Error de red al actualizar lead');
    } finally {
      setBusy(false);
    }
  }

  async function patchLeadFollowUp(body: {
    id: string;
    follow_up_done?: string[];
    next_follow_up_at?: string | null;
  }) {
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/eventos/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo actualizar seguimiento');
        return;
      }
      await onRefresh();
    } catch {
      setErr('Error de red al actualizar seguimiento');
    } finally {
      setBusy(false);
    }
  }

  const filteredHist = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? hist.filter((c) =>
          [c.company_name, c.contact_name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
      : hist;
    // Garantiza más reciente → más antiguo
    return [...rows].sort((a, b) =>
      String(b.last_activity_at || '').localeCompare(
        String(a.last_activity_at || '')
      )
    );
  }, [hist, q]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setView('pipeline')}
          className="rounded-xl px-3 py-2 text-sm font-semibold"
          style={
            view === 'pipeline'
              ? { backgroundColor: SUITE.orangeSoft, color: SUITE.orangeDeep }
              : { backgroundColor: '#fff', color: SUITE.navy }
          }
        >
          Pipeline
        </button>
        <button
          type="button"
          onClick={() => setView('clientes')}
          className="rounded-xl px-3 py-2 text-sm font-semibold"
          style={
            view === 'clientes'
              ? { backgroundColor: SUITE.orangeSoft, color: SUITE.orangeDeep }
              : { backgroundColor: '#fff', color: SUITE.navy }
          }
        >
          Clientes ({clients.length}
          {withActivityCount ? ` · ${withActivityCount} c/act.` : ''})
        </button>
        <button
          type="button"
          onClick={() => setView('historial')}
          className="rounded-xl px-3 py-2 text-sm font-semibold"
          style={
            view === 'historial'
              ? { backgroundColor: SUITE.orangeSoft, color: SUITE.orangeDeep }
              : { backgroundColor: '#fff', color: SUITE.navy }
          }
        >
          Historial
        </button>
        <label className={`${filterControlClass} ml-auto bg-white`}>
          <span className="text-slate-500">Buscar</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${filterSelectClass} min-w-[160px]`}
            placeholder="Empresa, contacto…"
          />
        </label>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={seedClients}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Importar Excel seed
          </button>
        )}
      </div>

      {(err || msg) && (
        <p
          className="text-sm font-medium"
          style={{ color: err ? '#b91c1c' : SUITE.navy }}
        >
          {err || msg}
        </p>
      )}

      {!loading && !dbReady && clients.length === 0 && (
        <SuiteCard accent>
          <p className="text-sm font-semibold" style={{ color: theme.title }}>
            Supabase pendiente
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Ejecuta <code className="text-xs">supabase/eventos_module.sql</code>{' '}
            en el SQL Editor (crea CRM + catálogo + cotizaciones). Después usa
            «Importar Excel seed» para cargar clientes desde la lista Excel.
          </p>
        </SuiteCard>
      )}

      {view === 'pipeline' ? (
        <>
          <EventosFollowUpAlertsStrip
            leads={leads}
            onFocusLead={(id) => setFollowUpOpen(id)}
          />

          {canEdit && (
            <SuiteCard>
              <h3 className="text-base font-bold" style={{ color: theme.title }}>
                Nuevo lead
              </h3>
              <form
                onSubmit={createLead}
                className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                <label className="block text-xs font-medium text-slate-600">
                  Nombre de contacto
                  <input
                    required
                    placeholder="Nombre de contacto"
                    value={leadForm.contact_name}
                    onChange={(e) =>
                      setLeadForm((f) => ({
                        ...f,
                        contact_name: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Teléfono
                  <input
                    type="tel"
                    placeholder="Teléfono"
                    value={leadForm.phone}
                    onChange={(e) =>
                      setLeadForm((f) => ({ ...f, phone: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Correo
                  <input
                    type="email"
                    placeholder="Correo"
                    value={leadForm.email}
                    onChange={(e) =>
                      setLeadForm((f) => ({ ...f, email: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Empresa (si aplica)
                  <input
                    placeholder="Empresa"
                    value={leadForm.company}
                    onChange={(e) =>
                      setLeadForm((f) => ({ ...f, company: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Fecha del evento
                  <input
                    type="date"
                    value={leadForm.event_date}
                    onChange={(e) =>
                      setLeadForm((f) => ({
                        ...f,
                        event_date: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Número de personas (pax)
                  <EventosPaxCounter
                    value={leadForm.pax}
                    onChange={(pax) => setLeadForm((f) => ({ ...f, pax }))}
                    disabled={busy}
                    size="sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Presupuesto por persona
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="MXN"
                    value={leadForm.estimated_amount}
                    onChange={(e) =>
                      setLeadForm((f) => ({
                        ...f,
                        estimated_amount: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600 sm:col-span-2 lg:col-span-2">
                  ¿Qué celebran?
                  <input
                    required
                    placeholder="Boda, XV años, corporativo…"
                    value={leadForm.celebration}
                    onChange={(e) =>
                      setLeadForm((f) => ({
                        ...f,
                        celebration: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600 sm:col-span-2 lg:col-span-3">
                  Notas (requisiciones del cliente)
                  <textarea
                    rows={2}
                    placeholder="Menú especial, horarios, setup, restricciones…"
                    value={leadForm.notes}
                    onChange={(e) =>
                      setLeadForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={leadForm.place_hold}
                    onChange={(e) =>
                      setLeadForm((f) => ({
                        ...f,
                        place_hold: e.target.checked,
                      }))
                    }
                  />
                  Hold 72 h
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-60 sm:col-span-2 lg:col-span-2"
                  style={{ backgroundColor: SUITE.navy }}
                >
                  Agregar lead
                </button>
              </form>
            </SuiteCard>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {LEAD_STAGES.map((stage) => {
              const column = leads.filter((l) => l.stage === stage);
              return (
                <div
                  key={stage}
                  className="rounded-[20px] bg-white p-3"
                  style={{ boxShadow: SUITE.shadow }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-bold" style={{ color: theme.title }}>
                      {LEAD_STAGE_LABELS[stage]}
                    </h4>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {column.length}
                    </span>
                  </div>
                  <div className="max-h-[420px] space-y-2 overflow-y-auto">
                    {loading && column.length === 0 ? (
                      <p className="text-xs text-slate-400">Cargando…</p>
                    ) : column.length === 0 ? (
                      <p className="text-xs text-slate-400">Vacío</p>
                    ) : (
                      column.map((lead) => {
                        const headline =
                          lead.celebration || lead.title || 'Lead';
                        const company =
                          lead.company ||
                          lead.client?.company_name ||
                          null;
                        return (
                        <div
                          key={lead.id}
                          className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                        >
                          <p className="text-sm font-semibold text-slate-800">
                            {headline}
                          </p>
                          {(lead.contact_name || lead.phone || lead.email) && (
                            <p className="mt-0.5 text-xs text-slate-600">
                              {[lead.contact_name, lead.phone, lead.email]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-slate-500">
                            {company || 'Sin empresa'}
                            {lead.event_date ? ` · ${lead.event_date}` : ''}
                            {lead.pax ? ` · ${lead.pax} pax` : ''}
                          </p>
                          {lead.estimated_amount != null && (
                            <p className="mt-1 text-xs font-semibold text-slate-700">
                              Presupuesto por persona ·{' '}
                              {formatMxn(Number(lead.estimated_amount))}
                            </p>
                          )}
                          {lead.notes && (
                            <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                              {lead.notes}
                            </p>
                          )}
                          {lead.hold_until && (
                            <p className="mt-1 text-[11px] font-medium text-amber-700">
                              Hold hasta{' '}
                              {new Date(lead.hold_until).toLocaleString('es-MX')}
                            </p>
                          )}
                          <EventosLeadAlertBadge lead={lead} />
                          {canEdit && (
                            <select
                              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                              value={lead.stage}
                              onChange={(e) =>
                                moveLead(lead.id, e.target.value as LeadStage)
                              }
                            >
                              {LEAD_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {LEAD_STAGE_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          )}
                          <EventosLeadFollowUpChecklist
                            lead={lead}
                            canEdit={canEdit}
                            busy={busy}
                            open={followUpOpen === lead.id}
                            onToggleOpen={() =>
                              setFollowUpOpen((cur) =>
                                cur === lead.id ? null : lead.id
                              )
                            }
                            onPatch={patchLeadFollowUp}
                          />
                        </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : view === 'historial' ? (
        <>
          <SuiteCard>
            <h3 className="text-base font-bold" style={{ color: theme.title }}>
              Relación más reciente → antiguo
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              OS locales + Anticipos EVENTOS C50 + Seguimiento (Sheets API). Los
              atajos .gsheet no se leen en disco; regenera el JSON con el
              ingestor.
            </p>
            {histMeta?.generated_at && (
              <p className="mt-2 text-xs text-slate-500">
                Generado {histMeta.generated_at}
                {histMeta.stats?.events_total != null
                  ? ` · ${histMeta.stats.events_total} eventos indexados`
                  : ''}
              </p>
            )}
            {histMeta?.error && (
              <p className="mt-2 text-sm text-red-700">{histMeta.error}</p>
            )}
          </SuiteCard>

          <SuiteCard className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead style={{ backgroundColor: SUITE.navy, color: '#fff' }}>
                  <tr>
                    <th className="px-4 py-3 font-semibold">Última act.</th>
                    <th className="px-4 py-3 font-semibold">Cliente / evento</th>
                    <th className="px-4 py-3 font-semibold">Fuente</th>
                    <th className="px-4 py-3 font-semibold">#</th>
                    <th className="px-4 py-3 font-semibold">Seed</th>
                  </tr>
                </thead>
                <tbody>
                  {histLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-slate-500">
                        Cargando historial…
                      </td>
                    </tr>
                  ) : filteredHist.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-slate-500">
                        <p className="font-medium text-slate-700">
                          Sin historial indexado
                        </p>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
                          <li>
                            Desde la raíz del repo:{' '}
                            <code>
                              python ingestor/build_event_client_activity.py
                            </code>
                            {` `}(usa{' '}
                            <code>--skip-sheets</code> si solo quieres OS
                            locales).
                          </li>
                          <li>
                            Genera{' '}
                            <code>
                              supabase/seed_event_client_activity.json
                            </code>{' '}
                            y recarga esta pestaña.
                          </li>
                          <li>
                            Los atajos <code>.gsheet</code> no se leen en disco;
                            Seguimiento/Anticipos van por Sheets API.
                          </li>
                        </ol>
                      </td>
                    </tr>
                  ) : (
                    filteredHist.map((c) => {
                      const id = c.client_key;
                      const open = expanded === id;
                      const timeline = [...(c.timeline || [])].sort((a, b) =>
                        String(b.date || '').localeCompare(String(a.date || ''))
                      );
                      return (
                        <Fragment key={id}>
                          <tr
                            className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                            onClick={() =>
                              setExpanded((cur) => (cur === id ? null : id))
                            }
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                              {c.last_activity_at || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-700">
                              {c.company_name || '—'}
                              {c.contact_name ? (
                                <span className="block text-xs text-slate-500">
                                  {c.contact_name}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">
                              {SOURCE_LABELS[c.last_activity_source || ''] ||
                                c.last_activity_source ||
                                '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">
                              {c.activity_count}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">
                              {c.matched_seed ? 'Sí' : '—'}
                            </td>
                          </tr>
                          {open && timeline.length > 0 ? (
                            <tr className="border-t border-slate-50 bg-slate-50/80">
                              <td colSpan={5} className="px-4 py-3">
                                <ul className="space-y-1 text-xs text-slate-600">
                                  {timeline.slice(0, 20).map((t, i) => (
                                    <li key={`${t.date}-${t.source}-${i}`}>
                                      <span className="font-semibold text-slate-800">
                                        {t.date}
                                      </span>
                                      {' · '}
                                      {SOURCE_LABELS[t.source] || t.source}
                                      {t.label ? ` · ${t.label}` : ''}
                                      {t.detail ? (
                                        <span className="text-slate-400">
                                          {' '}
                                          — {t.detail}
                                        </span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </SuiteCard>
        </>
      ) : (
        <>
          {canEdit && (
            <SuiteCard>
              <h3 className="text-base font-bold" style={{ color: theme.title }}>
                Agregar cliente
              </h3>
              <form
                onSubmit={createClient}
                className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5"
              >
                <input
                  required
                  placeholder="Empresa"
                  value={clientForm.company_name}
                  onChange={(e) =>
                    setClientForm((f) => ({
                      ...f,
                      company_name: e.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Contacto"
                  value={clientForm.contact_name}
                  onChange={(e) =>
                    setClientForm((f) => ({
                      ...f,
                      contact_name: e.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="email"
                  placeholder="Correo"
                  value={clientForm.email}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Teléfono"
                  value={clientForm.phone}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                  style={{ backgroundColor: SUITE.navy }}
                >
                  Guardar
                </button>
              </form>
            </SuiteCard>
          )}

          <p className="text-xs text-slate-500">
            Orden: última actividad (OS / Anticipos / Seguimiento) → más antiguo.
            Sin match histórico al final.
          </p>

          <SuiteCard className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead style={{ backgroundColor: SUITE.navy, color: '#fff' }}>
                  <tr>
                    <th className="px-4 py-3 font-semibold">Última act.</th>
                    <th className="px-4 py-3 font-semibold">Empresa</th>
                    <th className="px-4 py-3 font-semibold">Contacto</th>
                    <th className="px-4 py-3 font-semibold">Correo</th>
                    <th className="px-4 py-3 font-semibold">Teléfono</th>
                    <th className="px-4 py-3 font-semibold">Fuente act.</th>
                    <th className="px-4 py-3 font-semibold">#</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-slate-500">
                        {loading ? (
                          'Cargando…'
                        ) : (
                          <>
                            <p className="font-medium text-slate-700">
                              Sin clientes en CRM
                            </p>
                            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
                              <li>
                                Si falla la API: corre{' '}
                                <code>supabase/eventos_module.sql</code> en
                                Supabase.
                              </li>
                              <li>
                                Con sesión de edición: botón «Importar Excel
                                seed» (lista Carranza 50).
                              </li>
                              <li>
                                O agrega un cliente manualmente arriba.
                              </li>
                              <li>
                                Para enriquecer con OS/Anticipos/Seguimiento:{' '}
                                <code>
                                  python
                                  ingestor/build_event_client_activity.py
                                </code>
                              </li>
                            </ol>
                          </>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredClients.map((c) => {
                      const open = expanded === c.id;
                      return (
                        <Fragment key={c.id}>
                          <tr
                            className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                            onClick={() =>
                              setExpanded((cur) =>
                                cur === c.id ? null : c.id
                              )
                            }
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                              {c.last_activity_at || '—'}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-slate-800">
                              {c.company_name}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">
                              {c.contact_name || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">
                              {c.email || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">
                              {c.phone || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">
                              {SOURCE_LABELS[c.last_activity_source || ''] ||
                                c.last_activity_source ||
                                '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">
                              {c.activity_count || '—'}
                            </td>
                          </tr>
                          {open && (c.activity_timeline?.length || 0) > 0 ? (
                            <tr className="border-t border-slate-50 bg-slate-50/80">
                              <td colSpan={7} className="px-4 py-3">
                                <ul className="space-y-1 text-xs text-slate-600">
                                  {[...(c.activity_timeline || [])]
                                    .sort((a, b) =>
                                      String(b.date || '').localeCompare(
                                        String(a.date || '')
                                      )
                                    )
                                    .map((t, i) => (
                                    <li key={`${t.date}-${t.source}-${i}`}>
                                      <span className="font-semibold text-slate-800">
                                        {t.date}
                                      </span>
                                      {' · '}
                                      {SOURCE_LABELS[t.source] || t.source}
                                      {t.label ? ` · ${t.label}` : ''}
                                      {t.detail ? (
                                        <span className="text-slate-400">
                                          {' '}
                                          — {t.detail}
                                        </span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </SuiteCard>
        </>
      )}
    </div>
  );
}
