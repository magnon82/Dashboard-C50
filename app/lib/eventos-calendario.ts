import { mexicoTodayIso } from '@/app/lib/eventos';
import {
  loadEventClientActivity,
  normalizeClientKey,
} from '@/app/lib/eventos-activity';
import { listEventOs } from '@/app/lib/eventos-os';
import { getServiceSupabase } from '@/app/lib/users';

export type CalendarSource = 'crm' | 'os' | 'activity';

export type CalendarEventItem = {
  id: string;
  event_date: string;
  title: string;
  client: string | null;
  pax: number | null;
  source: CalendarSource;
  source_label: string;
  detail: string | null;
  /** Etapa CRM (lead) si aplica */
  stage: string | null;
  /** PDF en disco (scan). Vacío si solo hay seed / Anticipos. */
  os_path: string | null;
  os_filename: string | null;
  /** id de event_service_orders (OS digital) */
  digital_os_id: string | null;
  /** id de event_quotes si hay match en Supabase */
  quote_id: string | null;
  lead_id: string | null;
  client_id: string | null;
};

export type CalendarPayload = {
  ready: boolean;
  today: string;
  events: CalendarEventItem[];
  count: number;
  sources: {
    activity: boolean;
    os: boolean;
    crm: boolean;
  };
  note: string;
  error?: string;
};

const SOURCE_PRIORITY: Record<CalendarSource, number> = {
  crm: 3,
  os: 2,
  activity: 1,
};

const ACTIVITY_SOURCE_LABELS: Record<string, string> = {
  os_pdf: 'OS (seed)',
  anticipos_c50: 'Anticipos C50',
  seguimiento: 'Seguimiento',
  seguimiento_eventos: 'Seguimiento',
};

function isoDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function paxFromText(...parts: Array<string | null | undefined>): number | null {
  for (const p of parts) {
    if (!p) continue;
    const m = String(p).match(/(\d+)\s*pax\b/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function dedupeKey(eventDate: string, title: string, client: string | null): string {
  const who =
    normalizeClientKey(client) ||
    normalizeClientKey(title) ||
    title.toLowerCase().trim();
  return `${eventDate}|${who}`;
}

function activitySourceLabel(source: string): string {
  return ACTIVITY_SOURCE_LABELS[source] || source || 'Actividad';
}

function mergeItem(
  map: Map<string, CalendarEventItem>,
  item: CalendarEventItem
): void {
  const key = dedupeKey(item.event_date, item.title, item.client);
  const prev = map.get(key);
  if (!prev) {
    map.set(key, item);
    return;
  }
  const preferNew =
    SOURCE_PRIORITY[item.source] > SOURCE_PRIORITY[prev.source] ||
    (SOURCE_PRIORITY[item.source] === SOURCE_PRIORITY[prev.source] &&
      (item.pax ?? 0) > (prev.pax ?? 0));
  const base = preferNew ? item : prev;
  const other = preferNew ? prev : item;
  map.set(key, {
    ...base,
    pax: base.pax ?? other.pax,
    client: base.client || other.client,
    detail: base.detail || other.detail,
    stage: base.stage || other.stage,
    os_path: base.os_path || other.os_path,
    os_filename: base.os_filename || other.os_filename,
    digital_os_id: base.digital_os_id || other.digital_os_id,
    quote_id: base.quote_id || other.quote_id,
    lead_id: base.lead_id || other.lead_id,
    client_id: base.client_id || other.client_id,
  });
}

function emptyLinks(): Pick<
  CalendarEventItem,
  | 'stage'
  | 'os_path'
  | 'os_filename'
  | 'digital_os_id'
  | 'quote_id'
  | 'lead_id'
  | 'client_id'
> {
  return {
    stage: null,
    os_path: null,
    os_filename: null,
    digital_os_id: null,
    quote_id: null,
    lead_id: null,
    client_id: null,
  };
}

/** Prefer accepted → enviada → borrador for the same event. */
const QUOTE_STATUS_RANK: Record<string, number> = {
  aceptada: 4,
  enviada: 3,
  borrador: 2,
  vencida: 1,
  rechazada: 0,
};

function pickBetterQuoteId(
  a: { id: string; status?: string | null } | null,
  b: { id: string; status?: string | null } | null
): string | null {
  if (!a) return b?.id || null;
  if (!b) return a.id;
  const ra = QUOTE_STATUS_RANK[String(a.status || '')] ?? 0;
  const rb = QUOTE_STATUS_RANK[String(b.status || '')] ?? 0;
  return rb > ra ? b.id : a.id;
}

/** Próximos eventos locales: hoy CDMX en adelante (sin pasado). */
export async function buildUpcomingCalendar(
  from: Date = new Date()
): Promise<CalendarPayload> {
  const today = mexicoTodayIso(from);
  const map = new Map<string, CalendarEventItem>();
  const sources = { activity: false, os: false, crm: false };
  const errors: string[] = [];

  // 1) Activity seed (todas las fuentes con fecha de evento)
  try {
    const activity = await loadEventClientActivity();
    if (activity) {
      sources.activity = true;
      for (const client of activity.clients) {
        for (const t of client.timeline || []) {
          const eventDate = isoDay(t.event_date) || isoDay(t.date);
          if (!eventDate || eventDate < today) continue;
          // OS PDF lo cubre mejor listEventOs (scan o seed); evita doble conteo
          if (t.source === 'os_pdf') continue;

          const title =
            (t.label || client.company_name || 'Evento').trim() || 'Evento';
          const company = client.company_name?.trim() || null;
          mergeItem(map, {
            id: `act:${client.client_key}:${eventDate}:${t.source}:${t.folio || ''}`,
            event_date: eventDate,
            title,
            client: company,
            pax: paxFromText(t.detail, t.label),
            source: 'activity',
            source_label: activitySourceLabel(t.source),
            detail: t.detail || null,
            ...emptyLinks(),
          });
        }
      }
    }
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : 'Error al leer seed de actividad'
    );
  }

  // 2) OS con event_date (disco o seed)
  const osIndex = new Map<
    string,
    { path: string | null; filename: string | null }
  >();
  try {
    const { items, source } = await listEventOs();
    sources.os = source !== 'none';
    for (const it of items) {
      const eventDate = isoDay(it.event_date);
      if (!eventDate || eventDate < today) continue;
      const label =
        it.label ||
        it.matched_client_name ||
        (it.folio ? `OS ${it.folio}` : null) ||
        'Orden de servicio';
      const osPath =
        it.source === 'scan' && it.path ? it.path : null;
      const osFilename = it.filename || null;
      const client = it.matched_client_name || null;
      // Índice para adjuntar OS a CRM/Anticipos del mismo día+cliente
      for (const who of [client, label]) {
        const k = dedupeKey(eventDate, who || '', who);
        const prev = osIndex.get(k);
        if (!prev?.path && osPath) {
          osIndex.set(k, { path: osPath, filename: osFilename });
        } else if (!prev) {
          osIndex.set(k, { path: osPath, filename: osFilename });
        }
      }
      mergeItem(map, {
        id: `os:${it.id}`,
        event_date: eventDate,
        title: label,
        client,
        pax: null,
        source: 'os',
        source_label: it.source === 'scan' ? 'OS (Drive)' : 'OS (seed)',
        detail: it.filename || it.rel_path || null,
        ...emptyLinks(),
        os_path: osPath,
        os_filename: osFilename,
      });
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Error al listar OS');
  }

  // 3) CRM leads con event_date (si Supabase está disponible)
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_leads')
      .select(
        'id, title, celebration, company, client_id, event_date, pax, stage, client:event_clients(company_name)'
      )
      .gte('event_date', today)
      .neq('stage', 'perdido')
      .order('event_date', { ascending: true })
      .limit(200);

    if (error) {
      errors.push(error.message);
    } else {
      sources.crm = true;
      for (const row of data || []) {
        const eventDate = isoDay(row.event_date);
        if (!eventDate || eventDate < today) continue;
        const clientRow = row.client as
          | { company_name?: string | null }
          | { company_name?: string | null }[]
          | null;
        const clientName = Array.isArray(clientRow)
          ? clientRow[0]?.company_name
          : clientRow?.company_name;
        const title =
          (row.celebration || row.title || 'Lead').trim() || 'Lead';
        const company =
          (row.company || clientName || null)?.toString().trim() || null;
        mergeItem(map, {
          id: `crm:${row.id}`,
          event_date: eventDate,
          title,
          client: company,
          pax:
            row.pax != null && Number.isFinite(Number(row.pax))
              ? Number(row.pax)
              : null,
          source: 'crm',
          source_label: 'CRM / lead',
          detail: row.stage ? `Etapa: ${row.stage}` : null,
          ...emptyLinks(),
          stage: row.stage ? String(row.stage) : null,
          lead_id: String(row.id),
          client_id: row.client_id ? String(row.client_id) : null,
        });
      }
    }
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : 'Supabase no disponible para leads'
    );
  }

  // Adjuntar OS PDF a filas CRM/Anticipos del mismo día+cliente
  for (const [key, item] of map) {
    if (item.os_path) continue;
    const k = dedupeKey(item.event_date, item.title, item.client);
    const hit = osIndex.get(k) || osIndex.get(dedupeKey(item.event_date, item.client || '', item.client));
    if (hit?.path) {
      map.set(key, {
        ...item,
        os_path: hit.path,
        os_filename: hit.filename,
      });
    }
  }

  // 4) Cotizaciones de plataforma (event_quotes)
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_quotes')
      .select(
        'id, status, event_date, lead_id, client_id, celebration, client:event_clients(company_name)'
      )
      .gte('event_date', today)
      .neq('status', 'rechazada')
      .order('updated_at', { ascending: false })
      .limit(300);

    if (error) {
      // Tabla ausente no bloquea el calendario
      if (!/does not exist|schema cache|PGRST205/i.test(error.message)) {
        errors.push(error.message);
      }
    } else if (data?.length) {
      const byLead = new Map<string, { id: string; status?: string | null }>();
      const byClientDate = new Map<
        string,
        { id: string; status?: string | null }
      >();
      const byNameDate = new Map<
        string,
        { id: string; status?: string | null }
      >();

      for (const q of data) {
        const qRef = { id: String(q.id), status: q.status };
        if (q.lead_id) {
          const prev = byLead.get(String(q.lead_id)) || null;
          if (!prev || pickBetterQuoteId(prev, qRef) === qRef.id) {
            byLead.set(String(q.lead_id), qRef);
          }
        }
        const eventDate = isoDay(q.event_date);
        if (eventDate && q.client_id) {
          const ck = `${eventDate}|${q.client_id}`;
          const prev = byClientDate.get(ck) || null;
          if (!prev || pickBetterQuoteId(prev, qRef) === qRef.id) {
            byClientDate.set(ck, qRef);
          }
        }
        const clientRow = q.client as
          | { company_name?: string | null }
          | { company_name?: string | null }[]
          | null;
        const company = Array.isArray(clientRow)
          ? clientRow[0]?.company_name
          : clientRow?.company_name;
        if (eventDate && company) {
          const nk = `${eventDate}|${normalizeClientKey(company)}`;
          const prev = byNameDate.get(nk) || null;
          if (!prev || pickBetterQuoteId(prev, qRef) === qRef.id) {
            byNameDate.set(nk, qRef);
          }
        }
        // Cotización con fecha propia (aunque el lead no tenga event_date)
        if (eventDate) {
          const title =
            (q.celebration || company || 'Cotización').toString().trim() ||
            'Cotización';
          mergeItem(map, {
            id: `quote:${q.id}`,
            event_date: eventDate,
            title,
            client: company?.toString().trim() || null,
            pax: null,
            source: 'crm',
            source_label: 'Cotización',
            detail: q.status ? `Estado: ${q.status}` : null,
            ...emptyLinks(),
            quote_id: String(q.id),
            lead_id: q.lead_id ? String(q.lead_id) : null,
            client_id: q.client_id ? String(q.client_id) : null,
          });
        }
      }

      for (const [key, item] of map) {
        if (item.quote_id) continue;
        let qid: string | null = null;
        if (item.lead_id && byLead.has(item.lead_id)) {
          qid = byLead.get(item.lead_id)!.id;
        } else if (item.client_id) {
          qid = byClientDate.get(`${item.event_date}|${item.client_id}`)?.id || null;
        }
        if (!qid && item.client) {
          qid =
            byNameDate.get(
              `${item.event_date}|${normalizeClientKey(item.client)}`
            )?.id || null;
        }
        if (!qid && item.title) {
          qid =
            byNameDate.get(
              `${item.event_date}|${normalizeClientKey(item.title)}`
            )?.id || null;
        }
        if (qid) {
          map.set(key, { ...item, quote_id: qid });
        }
      }
    }
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : 'Supabase no disponible para cotizaciones'
    );
  }

  // 5) OS digitales (event_service_orders)
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_service_orders')
      .select(
        'id, os_number, event_date, client_name, celebration, client_id, lead_id, quote_id, pax'
      )
      .gte('event_date', today)
      .order('event_date', { ascending: true })
      .limit(300);

    if (error) {
      if (!/does not exist|schema cache|PGRST205/i.test(error.message)) {
        errors.push(error.message);
      }
    } else if (data?.length) {
      const byLead = new Map<string, string>();
      const byQuote = new Map<string, string>();
      const byClientDate = new Map<string, string>();
      const byNameDate = new Map<string, string>();

      for (const o of data) {
        const oid = String(o.id);
        const eventDate = isoDay(o.event_date);
        if (o.lead_id) byLead.set(String(o.lead_id), oid);
        if (o.quote_id) byQuote.set(String(o.quote_id), oid);
        if (eventDate && o.client_id) {
          byClientDate.set(`${eventDate}|${o.client_id}`, oid);
        }
        if (eventDate && o.client_name) {
          byNameDate.set(
            `${eventDate}|${normalizeClientKey(o.client_name)}`,
            oid
          );
        }

        const title =
          (o.celebration || o.client_name || o.os_number || 'OS digital').trim();
        mergeItem(map, {
          id: `dos:${oid}`,
          event_date: eventDate || today,
          title,
          client: o.client_name || null,
          pax:
            o.pax != null && Number.isFinite(Number(o.pax))
              ? Number(o.pax)
              : null,
          source: 'os',
          source_label: 'OS digital',
          detail: o.os_number || null,
          ...emptyLinks(),
          digital_os_id: oid,
          quote_id: o.quote_id ? String(o.quote_id) : null,
          lead_id: o.lead_id ? String(o.lead_id) : null,
          client_id: o.client_id ? String(o.client_id) : null,
        });
      }

      for (const [key, item] of map) {
        if (item.digital_os_id) continue;
        let oid: string | null = null;
        if (item.lead_id && byLead.has(item.lead_id)) {
          oid = byLead.get(item.lead_id)!;
        } else if (item.quote_id && byQuote.has(item.quote_id)) {
          oid = byQuote.get(item.quote_id)!;
        } else if (item.client_id) {
          oid =
            byClientDate.get(`${item.event_date}|${item.client_id}`) || null;
        }
        if (!oid && item.client) {
          oid =
            byNameDate.get(
              `${item.event_date}|${normalizeClientKey(item.client)}`
            ) || null;
        }
        if (oid) {
          map.set(key, { ...item, digital_os_id: oid });
        }
      }
    }
  } catch (e) {
    errors.push(
      e instanceof Error ? e.message : 'Supabase no disponible para OS digitales'
    );
  }

  const events = [...map.values()].sort((a, b) => {
    const byDate = a.event_date.localeCompare(b.event_date);
    if (byDate !== 0) return byDate;
    return a.title.localeCompare(b.title, 'es');
  });

  const ready =
    sources.activity || sources.os || sources.crm || events.length > 0;

  return {
    ready,
    today,
    events,
    count: events.length,
    sources,
    note:
      'Vista local de próximas fechas (hoy CDMX en adelante). Sync con Google Calendar compartido: próximo — un calendario, hold 72 h hábiles.',
    error: errors.length ? errors.join(' · ') : undefined,
  };
}
