'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  EVENTOS_MIN_PAX_GRUPOS,
  EVENTOS_NO_HOLD_WITHIN_DAYS,
  EVENTOS_SERVICIO_PCT,
  canPlaceHold,
  computeQuoteTotals,
  formatMxn,
  formatQuoteLineDescription,
  resolveItemUnitPrice,
  validateChoiceSelections,
  validateQuotePax,
  type EventClient,
  type EventMenu,
  type EventMenuItem,
  type QuoteLineOptions,
} from '@/app/lib/eventos';
import {
  COTIZACION_DRAFT_STORAGE_KEY,
  type CotizacionDoc,
} from '@/app/lib/eventos-cotizacion-doc';
import { EventosPaxCounter } from '@/app/components/eventos/EventosPaxCounter';
import { getTheme, SUITE } from '@/app/lib/themes';
import { useSession } from '@/app/lib/useSession';

const theme = getTheme('suite');

const STATUS_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
};

type DraftLine = {
  key: string;
  menu_item_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  category: string;
  requires_food: boolean;
  includes_servicio: boolean;
  min_pax: number | null;
  options: QuoteLineOptions;
};

type SavedQuote = {
  id: string;
  quote_number: string | null;
  total: number;
  status: string;
  event_date?: string | null;
  pax?: number | null;
  updated_at?: string | null;
  client?: { id: string; company_name: string } | null;
};

export function EventosCotizador({
  menus,
  clients,
  onSaved,
  dbReady = true,
  menusFromSeed = false,
  persistQuotes = true,
}: {
  menus: EventMenu[];
  clients: EventClient[];
  onSaved: () => Promise<void>;
  /** false si las tablas Eventos aún no existen / fallan al leer */
  dbReady?: boolean;
  /** true si el catálogo vino de seed_event_menus.json */
  menusFromSeed?: boolean;
  /** false si event_quotes no está listo para guardar */
  persistQuotes?: boolean;
}) {
  const { user } = useSession();
  const canEdit = !!user?.canEdit;
  const [menuId, setMenuId] = useState(menus[0]?.id || '');
  const [itemId, setItemId] = useState('');
  const [pax, setPax] = useState(EVENTOS_MIN_PAX_GRUPOS);
  const [clientId, setClientId] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [celebration, setCelebration] = useState('');
  const [notes, setNotes] = useState('');
  const [applyServicio, setApplyServicio] = useState(true);
  const [placeHold, setPlaceHold] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [choices, setChoices] = useState<QuoteLineOptions>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [quotes, setQuotes] = useState<SavedQuote[]>([]);
  const [quotesReady, setQuotesReady] = useState<boolean | null>(null);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [showAlta, setShowAlta] = useState(false);
  const [altaBusy, setAltaBusy] = useState(false);
  const [altaForm, setAltaForm] = useState({
    company_name: '',
    contact_name: '',
    phone: '',
    email: '',
  });

  const selectedMenu = menus.find((m) => m.id === menuId) || null;
  const items = selectedMenu?.items || [];
  const selectedItem: EventMenuItem | undefined = items.find(
    (i) => i.id === itemId
  );
  const choiceGroups = selectedItem?.choice_groups || [];

  // Si el menú activo no tiene id válido (catálogo recargado), tomar el primero
  useEffect(() => {
    if (!menus.length) return;
    if (!menuId || !menus.some((m) => m.id === menuId)) {
      setMenuId(menus[0].id);
      setItemId('');
      setChoices({});
    }
  }, [menus, menuId]);

  // Autoseleccionar primer ítem del menú cuando cambia el catálogo
  useEffect(() => {
    const list = selectedMenu?.items ?? [];
    if (!list.length) {
      if (itemId) setItemId('');
      return;
    }
    if (!itemId || !list.some((i) => i.id === itemId)) {
      setItemId(list[0].id);
      setChoices({});
    }
  }, [selectedMenu, itemId]);

  // Reset elecciones al cambiar de ítem
  useEffect(() => {
    setChoices({});
  }, [itemId]);

  const previewUnitPrice = useMemo(() => {
    if (!selectedItem) return 0;
    return resolveItemUnitPrice(selectedItem, choices);
  }, [selectedItem, choices]);

  // Líneas por persona siguen el pax del formulario
  useEffect(() => {
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (l.unit !== 'persona') return l;
        const q = Math.max(1, pax);
        if (l.quantity === q) return l;
        changed = true;
        return { ...l, quantity: q };
      });
      return changed ? next : prev;
    });
  }, [pax]);

  const sortedClients = useMemo(() => {
    const needle = clientFilter.trim().toLowerCase();
    const list = [...clients].sort((a, b) =>
      a.company_name.localeCompare(b.company_name, 'es')
    );
    if (!needle) return list;
    return list.filter((c) => {
      const hay = [c.company_name, c.contact_name, c.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [clients, clientFilter]);

  const totals = useMemo(
    () => computeQuoteTotals(lines, applyServicio, EVENTOS_SERVICIO_PCT),
    [lines, applyServicio]
  );

  const liveHint = useMemo(() => {
    if (!lines.length) return null;
    return validateQuotePax(
      pax,
      lines.map((l) => ({
        category: l.category,
        requiresFood: l.requires_food,
        min_pax: l.min_pax,
      }))
    );
  }, [lines, pax]);

  const holdBlocked = placeHold && !canPlaceHold(eventDate || null);

  const loadQuotes = useCallback(async () => {
    setQuotesLoading(true);
    try {
      const res = await fetch('/api/eventos/quotes', { cache: 'no-store' });
      const json = await res.json();
      if (json.ready === false || (res.ok === false && json.error)) {
        setQuotes([]);
        setQuotesReady(false);
        setQuotesError(json.error || 'No se pudieron leer cotizaciones');
        return;
      }
      setQuotes(
        (json.quotes || []).map(
          (q: {
            id: string;
            quote_number?: string | null;
            total?: number;
            status?: string;
            event_date?: string | null;
            pax?: number | null;
            updated_at?: string | null;
            client?: { id: string; company_name: string } | null;
          }) => ({
            id: q.id,
            quote_number: q.quote_number || null,
            total: Number(q.total || 0),
            status: q.status || 'borrador',
            event_date: q.event_date || null,
            pax: q.pax ?? null,
            updated_at: q.updated_at || null,
            client: q.client || null,
          })
        )
      );
      setQuotesReady(true);
      setQuotesError(null);
    } catch {
      setQuotes([]);
      setQuotesReady(false);
      setQuotesError('Error de red al cargar cotizaciones');
    } finally {
      setQuotesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuotes();
  }, [loadQuotes]);

  function addLine() {
    const item: EventMenuItem | undefined = items.find((i) => i.id === itemId);
    if (!item || !selectedMenu) {
      setErr('Selecciona un ítem del catálogo');
      return;
    }
    const choiceErr = validateChoiceSelections(item, choices);
    if (choiceErr) {
      setErr(choiceErr);
      return;
    }
    setErr('');
    const qty =
      item.unit === 'persona' ? Math.max(1, pax) : item.unit === 'paquete' ? 1 : 1;

    if (selectedMenu.includes_servicio) {
      setApplyServicio(false);
    }

    const unitPrice = resolveItemUnitPrice(item, choices);
    const cleanOptions: QuoteLineOptions = {};
    for (const g of item.choice_groups || []) {
      const v = (choices[g.id] || '').trim();
      if (v) cleanOptions[g.id] = v;
    }

    setLines((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        menu_item_id: item.id,
        description: formatQuoteLineDescription(
          item.name,
          cleanOptions,
          item.choice_groups
        ),
        quantity: qty,
        unit_price: unitPrice,
        unit: item.unit || 'persona',
        category: selectedMenu.category,
        requires_food: selectedMenu.requires_food,
        includes_servicio: selectedMenu.includes_servicio,
        min_pax: item.min_pax ?? selectedMenu.min_pax ?? null,
        options: cleanOptions,
      },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function createClientAlta() {
    if (!canEdit) return;
    const company = altaForm.company_name.trim();
    if (!company) {
      setErr('Indica empresa o nombre para el alta de cliente');
      return;
    }
    setAltaBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/eventos/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company,
          contact_name: altaForm.contact_name.trim() || null,
          phone: altaForm.phone.trim() || null,
          email: altaForm.email.trim() || null,
          source: 'cotizador',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo crear el cliente');
        return;
      }
      const newId = json.client?.id as string | undefined;
      await onSaved();
      if (newId) {
        setClientId(newId);
        setClientFilter('');
      }
      setAltaForm({
        company_name: '',
        contact_name: '',
        phone: '',
        email: '',
      });
      setShowAlta(false);
      setMsg(
        `Cliente «${json.client?.company_name || company}» creado · listo para cotizar`
      );
    } catch {
      setErr('Error de red al crear cliente');
    } finally {
      setAltaBusy(false);
    }
  }

  function buildDraftDoc(): CotizacionDoc {
    const client = clients.find((c) => c.id === clientId);
    return {
      quote_number: null,
      status: 'borrador',
      client_name: client?.company_name || null,
      contact_name: client?.contact_name || null,
      celebration: celebration.trim() || null,
      event_date: eventDate || null,
      pax,
      notes: notes.trim() || null,
      apply_servicio: applyServicio,
      servicio_pct: EVENTOS_SERVICIO_PCT,
      hold_until: null,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        unit: l.unit,
        options: l.options,
      })),
      issued_at: new Date().toISOString(),
    };
  }

  function openPreview() {
    if (!clientId) {
      setErr(
        clients.length === 0
          ? 'Crea un cliente en CRM antes de cotizar'
          : 'Selecciona un cliente para la cotización'
      );
      return;
    }
    if (!lines.length) {
      setErr('Agrega al menos una línea para la vista previa');
      return;
    }
    const validation = validateQuotePax(
      pax,
      lines.map((l) => ({
        category: l.category,
        requiresFood: l.requires_food,
        min_pax: l.min_pax,
      }))
    );
    if (validation) {
      setErr(validation);
      return;
    }
    setErr('');
    sessionStorage.setItem(
      COTIZACION_DRAFT_STORAGE_KEY,
      JSON.stringify(buildDraftDoc())
    );
    window.open('/eventos/cotizacion/preview', '_blank', 'noopener,noreferrer');
  }

  async function saveDraft() {
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    setMsg('');

    if (!clientId) {
      setErr(
        clients.length === 0
          ? 'Crea un cliente en CRM antes de cotizar'
          : 'Selecciona un cliente para guardar la cotización'
      );
      setBusy(false);
      return;
    }

    const validation = validateQuotePax(
      pax,
      lines.map((l) => ({
        category: l.category,
        requiresFood: l.requires_food,
        min_pax: l.min_pax,
      }))
    );
    if (validation) {
      setErr(validation);
      setBusy(false);
      return;
    }
    if (placeHold && !canPlaceHold(eventDate || null)) {
      setErr(
        `No se puede poner hold: faltan menos de ${EVENTOS_NO_HOLD_WITHIN_DAYS} días para el evento.`
      );
      setBusy(false);
      return;
    }

    try {
      const res = await fetch('/api/eventos/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          event_date: eventDate || null,
          pax,
          celebration,
          notes,
          apply_servicio: applyServicio,
          place_hold: placeHold,
          lines: lines.map((l) => ({
            menu_item_id: l.menu_item_id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            category: l.category,
            min_pax: l.min_pax,
            requires_food: l.requires_food,
            options: l.options,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(
          json.hint
            ? `${json.error || 'No se pudo guardar'} — ${json.hint}`
            : json.error || 'No se pudo guardar'
        );
        if (json.ready === false) {
          setQuotesReady(false);
          setQuotesError(json.error || null);
        }
        return;
      }
      const savedId = json.quote?.id as string | undefined;
      const leadId =
        (json.lead_id as string | undefined) ||
        (json.quote?.lead_id as string | undefined);
      let holdNote = '';
      if (placeHold && savedId) {
        try {
          const holdRes = await fetch('/api/eventos/holds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: celebration || 'Cotización Eventos',
              event_date: eventDate || null,
              quote_id: savedId,
              lead_id: leadId || null,
              hold_until: json.quote?.hold_until || null,
              notes: notes || null,
            }),
          });
          const holdJson = await holdRes.json();
          if (holdJson.message) holdNote = ` · ${holdJson.message}`;
        } catch {
          holdNote =
            ' · Hold local ok; sync GCal pendiente (GCAL_CALENDAR_ID).';
        }
      }
      const leadNote = json.lead_created
        ? ' · Lead CRM creado'
        : leadId
          ? ' · Lead CRM vinculado'
          : json.lead_error
            ? ` · Lead no creado: ${json.lead_error}`
            : '';
      setMsg(
        `Cotización ${json.quote?.quote_number || ''} guardada · ${formatMxn(
          Number(json.quote?.total || totals.total)
        )}${leadNote}${holdNote}`
      );
      setLines([]);
      await Promise.all([onSaved(), loadQuotes()]);
      if (savedId) {
        window.open(
          `/eventos/cotizacion/${savedId}`,
          '_blank',
          'noopener,noreferrer'
        );
      }
    } catch {
      setErr('Error de red al guardar cotización');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        {!dbReady && !menusFromSeed && (
          <SuiteCard accent>
            <p className="text-sm font-semibold" style={{ color: theme.title }}>
              Base Eventos incompleta
            </p>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              El catálogo cargó, pero conviene verificar que corriste{' '}
              <code className="text-xs">supabase/eventos_module.sql</code> completo
              (clientes, leads, cotizaciones).
            </p>
          </SuiteCard>
        )}

        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Armar cotización
          </h3>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="text-sm md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-700">Cliente</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowAlta((v) => !v)}
                    className="text-xs font-bold"
                    style={{ color: SUITE.navy }}
                  >
                    {showAlta ? 'Cerrar alta' : '+ Alta cliente'}
                  </button>
                )}
              </div>
              {clients.length === 0 && !showAlta ? (
                <p className="mt-1 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                  Sin clientes CRM. Usa «Alta cliente» aquí o créalo en CRM
                  antes de cotizar.
                </p>
              ) : (
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={clientFilter}
                    onChange={(e) => setClientFilter(e.target.value)}
                    placeholder="Filtrar cliente…"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 sm:max-w-[200px]"
                  />
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    required
                    className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="" disabled>
                      Selecciona cliente
                    </option>
                    {sortedClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company_name}
                        {c.contact_name ? ` · ${c.contact_name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {showAlta && canEdit && (
                <div className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2">
                  <p className="sm:col-span-2 text-xs font-semibold text-slate-600">
                    Alta rápida · contacto, teléfono y correo alimentan el lead
                    al guardar la cotización
                  </p>
                  <input
                    value={altaForm.company_name}
                    onChange={(e) =>
                      setAltaForm((f) => ({
                        ...f,
                        company_name: e.target.value,
                      }))
                    }
                    placeholder="Empresa *"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <input
                    value={altaForm.contact_name}
                    onChange={(e) =>
                      setAltaForm((f) => ({
                        ...f,
                        contact_name: e.target.value,
                      }))
                    }
                    placeholder="Contacto"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <input
                    type="tel"
                    value={altaForm.phone}
                    onChange={(e) =>
                      setAltaForm((f) => ({ ...f, phone: e.target.value }))
                    }
                    placeholder="Teléfono"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <input
                    type="email"
                    value={altaForm.email}
                    onChange={(e) =>
                      setAltaForm((f) => ({ ...f, email: e.target.value }))
                    }
                    placeholder="Correo"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={altaBusy || !altaForm.company_name.trim()}
                    onClick={() => void createClientAlta()}
                    className="rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"
                    style={{ backgroundColor: SUITE.navy }}
                  >
                    {altaBusy ? 'Creando…' : 'Crear y seleccionar'}
                  </button>
                </div>
              )}
              {clientId && (
                <p className="mt-1 text-xs text-slate-500">
                  {(() => {
                    const c = clients.find((x) => x.id === clientId);
                    if (!c) return null;
                    const bits = [c.contact_name, c.phone, c.email].filter(
                      Boolean
                    );
                    return bits.length
                      ? `Lead usará: ${bits.join(' · ')}`
                      : 'Cliente sin contacto/tel/correo — completa en CRM o alta.';
                  })()}
                </p>
              )}
            </div>
            <label className="text-sm">
              <span className="font-semibold text-slate-700">Fecha evento</span>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="font-semibold text-slate-700">Personas (pax)</span>
              <EventosPaxCounter
                value={pax}
                onChange={setPax}
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="font-semibold text-slate-700">
                ¿Qué celebran?
              </span>
              <input
                type="text"
                value={celebration}
                onChange={(e) => setCelebration(e.target.value)}
                placeholder="Boda, XV años, corporativo, aniversario…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <p className="mt-1 text-xs text-slate-500">
                Se copia al lead CRM al guardar (título + celebración).
              </p>
            </label>
            <label className="text-sm md:col-span-2">
              <span className="font-semibold text-slate-700">Menú / catálogo</span>
              <select
                value={menuId}
                onChange={(e) => {
                  setMenuId(e.target.value);
                  setItemId('');
                  setChoices({});
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.min_pax ? ` · min ${m.min_pax} pax` : ''}
                    {m.category === 'barra_libre' ? ' (requiere alimentos)' : ''}
                    {m.code === 'bebidas_a_la_carta'
                      ? ' (por pieza / consumo)'
                      : ''}
                    {m.includes_servicio ? ' · servicio en PDF' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {menus.length} catálogos · {items.length} ítems en el menú
                seleccionado
                {selectedMenu?.category === 'barra_libre' ||
                selectedMenu?.code === 'bebidas_a_la_carta'
                  ? ' · Bebidas: vigentes PDF + a la carta (OS)'
                  : ''}
              </p>
            </label>
          </div>

          {selectedMenu?.notes && (
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              {selectedMenu.notes}
              {selectedMenu.requires_food
                ? ' · Requiere alimentos en la misma cotización.'
                : ''}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1 text-sm">
              <span className="font-semibold text-slate-700">Ítem</span>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                disabled={!items.length}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
              >
                {!items.length ? (
                  <option value="">Sin ítems en este menú</option>
                ) : (
                  items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                      {it.choice_groups?.some((g) => g.affects_price)
                        ? ' · precio según fuerte'
                        : ` · ${formatMxn(Number(it.unit_price))}/${it.unit}`}
                      {!it.price_verified ? ' *' : ''}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="button"
              onClick={addLine}
              disabled={
                !items.length ||
                !itemId ||
                !selectedItem ||
                !!validateChoiceSelections(selectedItem, choices)
              }
              className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: SUITE.navy }}
            >
              Agregar línea
            </button>
          </div>

          {choiceGroups.length > 0 && selectedItem && (
            <div className="mt-3 grid gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3 md:grid-cols-2">
              <p className="md:col-span-2 text-xs font-semibold text-amber-900">
                Elige opciones del menú
                {choiceGroups.some((g) => g.affects_price)
                  ? ` · Precio unitario: ${formatMxn(previewUnitPrice)}`
                  : ''}
              </p>
              {choiceGroups.map((g) => (
                <label key={g.id} className="text-sm">
                  <span className="font-semibold text-slate-700">
                    {g.label}
                    {g.required ? ' *' : ' (opcional)'}
                  </span>
                  <select
                    value={choices[g.id] || ''}
                    onChange={(e) =>
                      setChoices((prev) => ({
                        ...prev,
                        [g.id]: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="">
                      {g.required ? `Selecciona ${g.label.toLowerCase()}…` : 'Sin elegir'}
                    </option>
                    {g.options.map((o) => (
                      <option key={o.id} value={o.label}>
                        {o.label}
                        {g.affects_price && o.unit_price != null
                          ? ` · ${formatMxn(Number(o.unit_price))}`
                          : ''}
                        {o.is_vegetarian ? ' (V)' : ''}
                        {o.price_verified === false ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          {!items.length && selectedMenu && (
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              Este menú no tiene ítems. Re-ejecuta el seed de{' '}
              <code className="text-[11px]">supabase/eventos_module.sql</code>.
            </p>
          )}

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Cant.</th>
                  <th className="px-3 py-2">P. unit.</th>
                  <th className="px-3 py-2">Importe</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-slate-400">
                      Sin líneas. Elige menú (alimentos, barra libre o bebidas a
                      la carta), opciones si aplica, luego «Agregar línea».
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.key} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        <div>{l.description.split(' · ')[0]}</div>
                        {l.options?.plato_fuerte && (
                          <div className="mt-0.5 text-xs font-normal text-slate-500">
                            Plato fuerte: {l.options.plato_fuerte}
                            {l.options.entrada
                              ? ` · Entrada: ${l.options.entrada}`
                              : ''}
                            {l.options.postre
                              ? ` · Postre: ${l.options.postre}`
                              : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={l.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x) =>
                                x.key === l.key
                                  ? {
                                      ...x,
                                      quantity: Number(e.target.value) || 0,
                                    }
                                  : x
                              )
                            )
                          }
                          className="w-20 rounded border border-slate-200 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={l.unit_price}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x) =>
                                x.key === l.key
                                  ? {
                                      ...x,
                                      unit_price: Number(e.target.value) || 0,
                                    }
                                  : x
                              )
                            )
                          }
                          className="w-28 rounded border border-slate-200 px-2 py-1"
                          title="Editar precio (útil en bebidas a la carta)"
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {formatMxn(l.quantity * l.unit_price)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(l.key)}
                          className="text-xs font-semibold text-red-600"
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {liveHint && (
            <p className="mt-2 text-xs font-medium text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              {liveHint}
            </p>
          )}

          <label className="mt-3 block text-sm">
            <span className="font-semibold text-slate-700">Notas</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Detalle del evento, horario, observaciones…"
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyServicio}
                onChange={(e) => setApplyServicio(e.target.checked)}
              />
              Aplicar servicio {(EVENTOS_SERVICIO_PCT * 100).toFixed(0)}%
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={placeHold}
                onChange={(e) => setPlaceHold(e.target.checked)}
              />
              Reservar hold 72 h hábiles
            </label>
          </div>
          {holdBlocked && (
            <p className="mt-2 text-xs text-red-700">
              Hold no disponible: faltan menos de {EVENTOS_NO_HOLD_WITHIN_DAYS}{' '}
              días al evento.
            </p>
          )}

          {(err || msg) && (
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: err ? '#b91c1c' : SUITE.navy }}
            >
              {err || msg}
            </p>
          )}

          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || lines.length === 0 || !!liveHint}
                onClick={openPreview}
                className="rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50"
                style={{ borderColor: SUITE.navy, color: SUITE.navy }}
              >
                Vista previa cotización
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  lines.length === 0 ||
                  !!liveHint ||
                  holdBlocked ||
                  !persistQuotes
                }
                onClick={saveDraft}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: SUITE.orange }}
              >
                {busy
                  ? 'Guardando…'
                  : !persistQuotes
                    ? 'Guardar (requiere SQL)'
                    : 'Guardar borrador'}
              </button>
            </div>
          )}
          {!canEdit && lines.length > 0 && (
            <button
              type="button"
              disabled={!!liveHint}
              onClick={openPreview}
              className="mt-4 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50"
              style={{ borderColor: SUITE.navy, color: SUITE.navy }}
            >
              Vista previa cotización
            </button>
          )}
          {canEdit && !persistQuotes && (
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              Simulación activa: totales OK. Para guardar, ejecuta{' '}
              <code className="text-[11px]">supabase/eventos_module.sql</code>.
              Puedes usar «Vista previa» sin base de datos.
            </p>
          )}
          {!canEdit && (
            <p className="mt-3 text-sm text-slate-500">
              Sesión de solo lectura: puedes simular totales y vista previa, no
              guardar.
            </p>
          )}
        </SuiteCard>
      </div>

      <div className="space-y-5">
        <SuiteCard accent>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Totales
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="font-semibold">{formatMxn(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">
                Servicio {(totals.servicioPct * 100).toFixed(0)}%
                {!totals.applyServicio ? ' (off)' : ''}
              </dt>
              <dd className="font-semibold">
                {formatMxn(totals.servicioAmount)}
              </dd>
            </div>
            <div
              className="flex justify-between border-t border-slate-200 pt-2 text-base"
              style={{ color: theme.title }}
            >
              <dt className="font-bold">Total</dt>
              <dd className="font-bold">{formatMxn(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs" style={{ color: theme.muted }}>
            * Precio sin verificar (seed). Parejas: el PDF ya incluye servicio —
            desactiva el cargo si aplica. Barra libre solo con alimentos. A la
            carta: edita P. unit. si el consumo difiere.
          </p>
        </SuiteCard>

        <SuiteCard>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold" style={{ color: theme.title }}>
              Cotizaciones guardadas
            </h4>
            <button
              type="button"
              onClick={() => void loadQuotes()}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Actualizar
            </button>
          </div>

          {quotesLoading ? (
            <p className="mt-2 text-sm text-slate-500">Cargando…</p>
          ) : quotesReady === false ? (
            <div className="mt-2 space-y-2 text-sm" style={{ color: theme.muted }}>
              <p>
                No hay tabla de cotizaciones (o falló la lectura). Ejecuta{' '}
                <code className="text-xs">supabase/eventos_module.sql</code> en el
                SQL Editor de Supabase y recarga.
              </p>
              {quotesError && (
                <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                  {quotesError}
                </p>
              )}
            </div>
          ) : quotes.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Aún no hay cotizaciones. Arma líneas y guarda un borrador.
            </p>
          ) : (
            <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
              {quotes.map((q) => (
                <li
                  key={q.id}
                  className="rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {q.quote_number || q.id.slice(0, 8)}
                    </span>
                    <span className="font-bold" style={{ color: SUITE.navy }}>
                      {formatMxn(q.total)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {STATUS_LABELS[q.status] || q.status}
                    {q.client?.company_name
                      ? ` · ${q.client.company_name}`
                      : ' · Sin cliente'}
                    {q.event_date
                      ? ` · ${new Date(q.event_date + 'T12:00:00').toLocaleDateString(
                          'es-MX',
                          { day: 'numeric', month: 'short', year: 'numeric' }
                        )}`
                      : ''}
                    {q.pax ? ` · ${q.pax} pax` : ''}
                  </div>
                  <a
                    href={`/eventos/cotizacion/${q.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block text-xs font-semibold"
                    style={{ color: SUITE.orangeDeep }}
                  >
                    Ver cotización →
                  </a>
                </li>
              ))}
            </ul>
          )}
        </SuiteCard>
      </div>
    </div>
  );
}
