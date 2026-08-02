'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  EVENTOS_MIN_PAX_GRUPOS,
  EVENTOS_NO_HOLD_WITHIN_DAYS,
  EVENTOS_QUOTE_LOCK_WITHIN_DAYS,
  EVENTOS_SERVICIO_PCT,
  canPlaceHold,
  computeQuoteTotals,
  formatMxn,
  formatQuoteLineDescription,
  isPaxAllocationLine,
  isQuoteLockedByEventDate,
  quoteLockMessage,
  resolveItemUnitPrice,
  summarizePaxAllocation,
  validateChoiceSelections,
  validatePaxAllocation,
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
  service_order_id?: string | null;
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
  /** Contacto de envío (prefill CRM; editable por cotización → sync a event_clients al guardar) */
  const [clientContactName, setClientContactName] = useState('');
  const [clientCompanyName, setClientCompanyName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  /** 'alta' | 'existente' — cuál camino de cliente está activo en el UI */
  const [clientPath, setClientPath] = useState<'alta' | 'existente' | null>(
    null
  );
  const [eventDate, setEventDate] = useState('');
  const [celebration, setCelebration] = useState('');
  const [notes, setNotes] = useState('');
  const [applyServicio, setApplyServicio] = useState(true);
  const [placeHold, setPlaceHold] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [choices, setChoices] = useState<QuoteLineOptions>({});
  /** Cantidad (pax) para la próxima línea de menú por persona. */
  const [lineQty, setLineQty] = useState(EVENTOS_MIN_PAX_GRUPOS);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [quotes, setQuotes] = useState<SavedQuote[]>([]);
  const [quotesReady, setQuotesReady] = useState<boolean | null>(null);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(true);
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

  // Prefill contacto/empresa/tel/correo solo al cambiar de cliente (no pisar ediciones locales)
  useEffect(() => {
    if (!clientId) {
      setClientContactName('');
      setClientCompanyName('');
      setClientPhone('');
      setClientEmail('');
      return;
    }
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    setClientContactName(c.contact_name || '');
    setClientCompanyName(c.company_name || '');
    setClientPhone(c.phone || '');
    setClientEmail(c.email || '');
    // clients intencional fuera de deps: alta ya setea contacto; refresh CRM no debe borrar overrides
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar clientId
  }, [clientId]);

  const previewUnitPrice = useMemo(() => {
    if (!selectedItem) return 0;
    return resolveItemUnitPrice(selectedItem, choices);
  }, [selectedItem, choices]);

  const paxAlloc = useMemo(
    () => summarizePaxAllocation(pax, lines),
    [pax, lines]
  );

  const allocHint = useMemo(
    () => validatePaxAllocation(pax, lines),
    [pax, lines]
  );

  const quoteLocked = isQuoteLockedByEventDate(eventDate || null);
  const lockMsg = quoteLockMessage(eventDate || null);

  const nextLineIsAlloc =
    !!selectedItem &&
    !!selectedMenu &&
    isPaxAllocationLine({
      unit: selectedItem.unit || 'persona',
      category: selectedMenu.category,
    });

  // Al cambiar pax / líneas / ítem: sugerir cantidad = pax restantes (menús alimentos)
  useEffect(() => {
    if (!selectedItem || !selectedMenu) return;
    if (
      isPaxAllocationLine({
        unit: selectedItem.unit || 'persona',
        category: selectedMenu.category,
      })
    ) {
      const rem = Math.max(0, paxAlloc.remaining);
      setLineQty(rem > 0 ? rem : Math.max(1, pax));
      return;
    }
    if (selectedItem.unit === 'persona') {
      setLineQty(Math.max(1, pax));
      return;
    }
    setLineQty(1);
  }, [selectedItem, selectedMenu, pax, paxAlloc.remaining]);

  const sortedClients = useMemo(() => {
    const needle = clientFilter.trim().toLowerCase();
    const list = [...clients].sort((a, b) =>
      a.company_name.localeCompare(b.company_name, 'es')
    );
    if (!needle) return list;
    return list.filter((c) => {
      const hay = [c.company_name, c.contact_name, c.email, c.phone]
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

  const clientQuotes = useMemo(() => {
    if (!clientId) return [];
    return quotes.filter((q) => q.client?.id === clientId);
  }, [quotes, clientId]);

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
            service_order_id?: string | null;
          }) => ({
            id: q.id,
            quote_number: q.quote_number || null,
            total: Number(q.total || 0),
            status: q.status || 'borrador',
            event_date: q.event_date || null,
            pax: q.pax ?? null,
            updated_at: q.updated_at || null,
            client: q.client || null,
            service_order_id: q.service_order_id || null,
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
    if (quoteLocked) {
      setErr(lockMsg || 'Cotización bloqueada por fecha del evento.');
      return;
    }
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

    const isAlloc = isPaxAllocationLine({
      unit: item.unit || 'persona',
      category: selectedMenu.category,
    });
    let qty: number;
    if (isAlloc) {
      qty = Math.max(0, Math.floor(Number(lineQty) || 0));
      if (qty < 1) {
        setErr(
          paxAlloc.remaining <= 0
            ? 'Todos los invitados ya están asignados. Ajusta cantidades o el pax total.'
            : 'Indica cuántas personas llevan este menú (mínimo 1).'
        );
        return;
      }
      if (paxAlloc.remaining <= 0) {
        setErr(
          'Todos los invitados ya están asignados. Quita o reduce una línea antes de agregar otra.'
        );
        return;
      }
      if (qty > paxAlloc.remaining) {
        setErr(
          `Solo faltan ${paxAlloc.remaining} persona${paxAlloc.remaining === 1 ? '' : 's'} por asignar.`
        );
        return;
      }
    } else if (item.unit === 'persona') {
      qty = Math.max(1, Math.floor(Number(lineQty) || pax));
    } else {
      qty = item.unit === 'paquete' ? 1 : Math.max(1, Number(lineQty) || 1);
    }

    setErr('');

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
    if (quoteLocked) {
      setErr(lockMsg || 'Cotización bloqueada por fecha del evento.');
      return;
    }
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  /** Limpia líneas para armar otra cotización (mismo cliente / fecha / pax). */
  function startNuevaCotizacion() {
    setLines([]);
    setChoices({});
    setNotes('');
    setPlaceHold(false);
    setErr('');
    setMsg(
      'Nueva cotización: cada guardado crea una versión distinta; no sobrescribe las anteriores.'
    );
    const rem = Math.max(1, pax);
    setLineQty(rem);
  }

  async function createClientAlta() {
    if (!canEdit) return;
    const contact = altaForm.contact_name.trim();
    if (!contact) {
      setErr('Indica el nombre completo de quien solicita el evento');
      return;
    }
    const company = altaForm.company_name.trim() || contact;
    setAltaBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/eventos/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company,
          contact_name: contact,
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
      const createdContact =
        (json.client?.contact_name as string | null | undefined) || contact;
      const createdPhone =
        (json.client?.phone as string | null | undefined) ||
        altaForm.phone.trim() ||
        '';
      const createdEmail =
        (json.client?.email as string | null | undefined) ||
        altaForm.email.trim() ||
        '';
      await onSaved();
      if (newId) {
        setClientId(newId);
        setClientFilter('');
        setClientContactName(createdContact);
        setClientCompanyName(
          (json.client?.company_name as string | undefined) || company
        );
        setClientPhone(createdPhone);
        setClientEmail(createdEmail);
        setClientPath('existente');
      }
      setAltaForm({
        company_name: '',
        contact_name: '',
        phone: '',
        email: '',
      });
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
      contact_name: clientContactName.trim() || client?.contact_name || null,
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
    const allocErr = validatePaxAllocation(pax, lines);
    if (allocErr) {
      setErr(allocErr);
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

    if (quoteLocked) {
      setErr(
        lockMsg ||
          `Sin cambios: faltan ${EVENTOS_QUOTE_LOCK_WITHIN_DAYS} días o menos para el evento.`
      );
      setBusy(false);
      return;
    }

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
    const allocErr = validatePaxAllocation(pax, lines);
    if (allocErr) {
      setErr(allocErr);
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
          phone: clientPhone.trim() || null,
          email: clientEmail.trim() || null,
          contact_name: clientContactName.trim() || null,
          apply_servicio: applyServicio,
          place_hold: placeHold,
          lines: lines.map((l) => ({
            menu_item_id: l.menu_item_id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            unit: l.unit,
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
      const checklistNote = json.follow_up_synced
        ? ' · Checklist: alta cliente + cotización'
        : '';
      setMsg(
        `Nueva cotización ${json.quote?.quote_number || ''} guardada · ${formatMxn(
          Number(json.quote?.total || totals.total)
        )}${leadNote}${checklistNote}${holdNote}. Puedes armar otra con otros platillos (no sobrescribe).`
      );
      setLines([]);
      setNotes('');
      setPlaceHold(false);
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

  async function generateOsFromQuote(quoteId: string) {
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/eventos/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quoteId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(
          [json.error, json.hint].filter(Boolean).join(' — ') ||
            'No se pudo generar OS'
        );
        return;
      }
      setMsg(
        json.created
          ? `OS ${json.order?.os_number || ''} generada`
          : `OS ${json.order?.os_number || ''} ya existía — actualizada`
      );
      await loadQuotes();
      if (json.href) {
        window.open(json.href, '_blank', 'noopener,noreferrer');
      }
    } catch {
      setErr('Error de red al generar OS');
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
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold" style={{ color: theme.title }}>
                Armar cotización
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Cada guardado crea una cotización nueva (no sobrescribe). Cambia
                platillos = otra versión para el mismo cliente.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 pt-0.5">
              <span
                className="text-[11px] font-medium uppercase tracking-wide"
                style={{ color: theme.muted }}
                aria-live="polite"
              >
                Nueva cotización
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={startNuevaCotizacion}
                  disabled={quoteLocked}
                  className="text-xs underline-offset-2 hover:underline disabled:opacity-40 disabled:no-underline"
                  style={{ color: theme.muted }}
                >
                  Empezar otra
                </button>
              )}
            </div>
          </div>

          {lockMsg && (
            <p className="mt-3 text-sm font-medium text-red-800 bg-red-50 rounded-lg px-3 py-2">
              {lockMsg}
            </p>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="text-sm md:col-span-2">
              <span className="font-semibold text-slate-700">Cliente</span>
              <p className="mt-0.5 text-xs text-slate-500">
                Alta de cliente nuevo o selecciona uno existente en CRM
              </p>

              <div className="mt-3 space-y-3">
                {canEdit && (
                  <div
                    className="rounded-xl border-2 p-3 transition-colors"
                    style={{
                      borderColor:
                        clientPath === 'alta' ? SUITE.orange : '#e2e8f0',
                      backgroundColor:
                        clientPath === 'alta' ? SUITE.orangeSoft : '#fff',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setClientPath('alta');
                        setClientId('');
                        setClientFilter('');
                      }}
                      className="w-full rounded-xl px-4 py-3.5 text-base font-bold text-white shadow-sm active:scale-[0.99]"
                      style={{ backgroundColor: SUITE.navy }}
                    >
                      Alta cliente
                    </button>
                    {clientPath === 'alta' && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-slate-600 sm:col-span-2">
                          <span className="font-semibold text-slate-700">
                            Nombre completo de quien solicita el evento *
                          </span>
                          <input
                            value={altaForm.contact_name}
                            onChange={(e) =>
                              setAltaForm((f) => ({
                                ...f,
                                contact_name: e.target.value,
                              }))
                            }
                            placeholder="Nombre y apellidos"
                            required
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600 sm:col-span-2">
                          <span className="font-semibold text-slate-700">
                            Empresa
                          </span>
                          <input
                            value={altaForm.company_name}
                            onChange={(e) =>
                              setAltaForm((f) => ({
                                ...f,
                                company_name: e.target.value,
                              }))
                            }
                            placeholder="Si aplica"
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">
                            Teléfono
                          </span>
                          <input
                            type="tel"
                            value={altaForm.phone}
                            onChange={(e) =>
                              setAltaForm((f) => ({
                                ...f,
                                phone: e.target.value,
                              }))
                            }
                            placeholder="Ej. 442 123 4567"
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">
                            Correo electrónico
                          </span>
                          <input
                            type="email"
                            value={altaForm.email}
                            onChange={(e) =>
                              setAltaForm((f) => ({
                                ...f,
                                email: e.target.value,
                              }))
                            }
                            placeholder="cliente@correo.com"
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                          />
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            Donde se enviará la cotización
                          </span>
                        </label>
                        <button
                          type="button"
                          disabled={altaBusy || !altaForm.contact_name.trim()}
                          onClick={() => void createClientAlta()}
                          className="rounded-xl px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"
                          style={{ backgroundColor: SUITE.orange }}
                        >
                          {altaBusy ? 'Creando…' : 'Crear y seleccionar'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {canEdit && (
                  <div className="flex items-center gap-3 px-1">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      o
                    </span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                )}

                <div
                  className="rounded-xl border-2 p-3 transition-colors"
                  style={{
                    borderColor:
                      clientPath === 'existente' || (!canEdit && clientId)
                        ? SUITE.navy
                        : '#e2e8f0',
                    backgroundColor:
                      clientPath === 'existente' || (!canEdit && clientId)
                        ? '#f8fafc'
                        : '#fff',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setClientPath('existente')}
                    className="w-full rounded-xl border-2 px-4 py-3 text-base font-bold active:scale-[0.99]"
                    style={{
                      borderColor: SUITE.navy,
                      color: SUITE.navy,
                      backgroundColor: '#fff',
                    }}
                  >
                    Seleccionar cliente existente
                  </button>

                  {(clientPath === 'existente' ||
                    clientId ||
                    !canEdit) && (
                    <div className="mt-3 space-y-2">
                      {clients.length === 0 ? (
                        <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                          {canEdit
                            ? 'Sin clientes CRM. Usa «Alta cliente» arriba o créalo en CRM antes de cotizar.'
                            : 'Sin clientes CRM. Pide a un editor que dé de alta el cliente.'}
                        </p>
                      ) : (
                        <>
                          <input
                            value={clientFilter}
                            onChange={(e) => {
                              setClientFilter(e.target.value);
                              setClientPath('existente');
                            }}
                            onFocus={() => setClientPath('existente')}
                            placeholder="Filtrar por empresa, contacto, tel o correo…"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                          />
                          <select
                            value={clientId}
                            onChange={(e) => {
                              setClientId(e.target.value);
                              setClientPath('existente');
                            }}
                            onFocus={() => setClientPath('existente')}
                            required
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
                          >
                            <option value="" disabled>
                              Elige un cliente
                            </option>
                            {sortedClients.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.company_name}
                                {c.contact_name ? ` · ${c.contact_name}` : ''}
                              </option>
                            ))}
                          </select>
                          {sortedClients.length === 0 && clientFilter.trim() ? (
                            <p className="text-xs text-slate-500">
                              Ningún cliente coincide con el filtro.
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {clientId && clientPath !== 'alta' ? (
              <>
                <label className="text-sm md:col-span-2">
                  <span className="font-semibold text-slate-700">
                    Nombre completo de quien solicita el evento
                  </span>
                  <input
                    value={clientContactName}
                    onChange={(e) => setClientContactName(e.target.value)}
                    disabled={!canEdit}
                    placeholder="Nombre y apellidos"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <span className="font-semibold text-slate-700">Empresa</span>
                  <input
                    value={clientCompanyName}
                    onChange={(e) => setClientCompanyName(e.target.value)}
                    disabled={!canEdit}
                    placeholder="Empresa / razón social"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
                  />
                </label>
                <label className="text-sm">
                  <span className="font-semibold text-slate-700">Teléfono</span>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    disabled={!canEdit}
                    placeholder="Ej. 442 123 4567"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
                  />
                </label>
                <label className="text-sm">
                  <span className="font-semibold text-slate-700">
                    Correo electrónico
                  </span>
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    disabled={!canEdit}
                    placeholder="cliente@correo.com"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
                  />
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Donde se enviará la cotización
                  </span>
                </label>
              </>
            ) : null}
            <label className="text-sm">
              <span className="font-semibold text-slate-700">Fecha evento</span>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <p className="mt-1 text-xs text-slate-500">
                Sin cambios si faltan {EVENTOS_QUOTE_LOCK_WITHIN_DAYS} días o
                menos (hora CDMX).
              </p>
            </label>
            <label className="text-sm">
              <span className="font-semibold text-slate-700">Personas (pax)</span>
              <EventosPaxCounter
                value={pax}
                onChange={setPax}
                disabled={quoteLocked}
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
                disabled={quoteLocked}
                placeholder="Boda, XV años, corporativo, aniversario…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
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
                disabled={quoteLocked}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
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
            <p
              className="mt-2 rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: SUITE.border,
                backgroundColor: SUITE.orangeSoft,
                color: SUITE.navySoft,
              }}
            >
              {selectedMenu.notes}
              {selectedMenu.requires_food
                ? ' · Requiere alimentos en la misma cotización.'
                : ''}
            </p>
          )}

          {(nextLineIsAlloc || paxAlloc.hasAllocLines) && (
            <div
              className="mt-3 rounded-xl border px-4 py-3"
              style={
                paxAlloc.remaining === 0 && paxAlloc.hasAllocLines
                  ? {
                      borderColor: '#C5E8E7',
                      backgroundColor: '#F0FAFA',
                      borderLeftWidth: 3,
                      borderLeftColor: '#0F9F9C',
                    }
                  : paxAlloc.remaining < 0
                    ? {
                        borderColor: '#FECACA',
                        backgroundColor: '#FEF2F2',
                        borderLeftWidth: 3,
                        borderLeftColor: '#DC2626',
                      }
                    : {
                        borderColor: '#F0E0C0',
                        backgroundColor: SUITE.orangeSoft,
                        borderLeftWidth: 3,
                        borderLeftColor: SUITE.orange,
                      }
              }
              role="status"
              aria-live="polite"
            >
              <p
                className="text-sm font-bold"
                style={{
                  color:
                    paxAlloc.remaining === 0 && paxAlloc.hasAllocLines
                      ? '#0B6E6C'
                      : paxAlloc.remaining < 0
                        ? '#991B1B'
                        : SUITE.navy,
                }}
              >
                Asignados {paxAlloc.assigned} de {paxAlloc.total} personas
                {paxAlloc.remaining > 0
                  ? ` · faltan ${paxAlloc.remaining}`
                  : paxAlloc.remaining < 0
                    ? ` · sobran ${Math.abs(paxAlloc.remaining)}`
                    : paxAlloc.hasAllocLines
                      ? ' · completo'
                      : ''}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: SUITE.muted }}>
                {nextLineIsAlloc
                  ? 'Indica cuántas personas llevan este menú (Personas por línea). Bebidas no cuentan en esta asignación.'
                  : 'Solo menús de alimentos por persona suman al pax. Ajusta cantidades en la tabla si hace falta.'}
              </p>
            </div>
          )}

          <div
            className={`mt-3 grid grid-cols-1 items-end gap-3 ${
              nextLineIsAlloc || selectedItem?.unit === 'persona'
                ? 'sm:grid-cols-[minmax(0,1fr)_7.5rem_auto]'
                : 'sm:grid-cols-[minmax(0,1fr)_auto]'
            }`}
          >
            <label className="min-w-0 text-sm">
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                Ítem
              </span>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                disabled={!items.length || quoteLocked}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
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
            {(nextLineIsAlloc || selectedItem?.unit === 'persona') && (
              <label className="text-sm">
                <span className="font-semibold" style={{ color: SUITE.navy }}>
                  {nextLineIsAlloc ? 'Personas (línea)' : 'Cantidad'}
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  max={nextLineIsAlloc ? Math.max(1, paxAlloc.remaining) : undefined}
                  value={lineQty}
                  disabled={quoteLocked}
                  onChange={(e) =>
                    setLineQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                  }
                  className={`mt-1 h-10 w-full rounded-lg px-3 text-sm disabled:bg-slate-50 ${
                    nextLineIsAlloc
                      ? 'border font-semibold'
                      : 'border border-slate-300'
                  }`}
                  style={
                    nextLineIsAlloc
                      ? {
                          borderColor: SUITE.orange,
                          backgroundColor: SUITE.orangeSoft,
                          color: SUITE.navy,
                        }
                      : undefined
                  }
                  aria-describedby={
                    nextLineIsAlloc ? 'line-qty-pax-hint' : undefined
                  }
                />
              </label>
            )}
            <button
              type="button"
              onClick={addLine}
              disabled={
                quoteLocked ||
                !items.length ||
                !itemId ||
                !selectedItem ||
                !!validateChoiceSelections(selectedItem, choices) ||
                (nextLineIsAlloc && paxAlloc.remaining <= 0)
              }
              className="h-10 w-full rounded-lg px-4 text-sm font-bold text-white disabled:opacity-50 sm:w-auto"
              style={{ backgroundColor: SUITE.navy }}
            >
              Agregar línea
            </button>
            {nextLineIsAlloc && !quoteLocked ? (
              <p
                id="line-qty-pax-hint"
                className="text-xs font-medium sm:col-start-2"
                style={{ color: SUITE.muted }}
              >
                {paxAlloc.remaining > 0
                  ? `De ${paxAlloc.remaining} por asignar`
                  : 'Todos asignados'}
              </p>
            ) : null}
          </div>

          {choiceGroups.length > 0 && selectedItem && (
            <div
              className="mt-3 grid gap-3 rounded-xl border p-3 md:grid-cols-2"
              style={{
                borderColor: SUITE.border,
                backgroundColor: SUITE.pageBg,
              }}
            >
              <p
                className="text-xs font-semibold md:col-span-2"
                style={{ color: SUITE.navy }}
              >
                Elige opciones del menú
                {choiceGroups.some((g) => g.affects_price)
                  ? ` · Precio unitario: ${formatMxn(previewUnitPrice)}`
                  : ''}
              </p>
              {choiceGroups.map((g) => (
                <label key={g.id} className="text-sm">
                  <span className="font-semibold" style={{ color: SUITE.navy }}>
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
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                    disabled={quoteLocked}
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
            <p
              className="mt-2 rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: SUITE.border,
                backgroundColor: SUITE.orangeSoft,
                color: SUITE.navySoft,
              }}
            >
              Este menú no tiene ítems. Re-ejecuta el seed de{' '}
              <code className="text-[11px]">supabase/eventos_module.sql</code>.
            </p>
          )}

          <div
            className="mt-4 overflow-x-auto rounded-xl border"
            style={{ borderColor: SUITE.border }}
          >
            <table className="min-w-full text-sm">
              <thead
                className="text-left text-xs uppercase"
                style={{ backgroundColor: SUITE.pageBg, color: SUITE.muted }}
              >
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
                          min={isPaxAllocationLine(l) ? 1 : 0.01}
                          step={isPaxAllocationLine(l) ? 1 : 0.01}
                          value={l.quantity}
                          disabled={quoteLocked}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((x) =>
                                x.key === l.key
                                  ? {
                                      ...x,
                                      quantity: isPaxAllocationLine(x)
                                        ? Math.max(
                                            0,
                                            Math.floor(Number(e.target.value) || 0)
                                          )
                                        : Number(e.target.value) || 0,
                                    }
                                  : x
                              )
                            )
                          }
                          className="w-20 rounded border border-slate-200 px-2 py-1 disabled:bg-slate-50"
                          title={
                            isPaxAllocationLine(l)
                              ? 'Personas con este menú'
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={l.unit_price}
                          disabled={quoteLocked}
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
                          className="w-28 rounded border border-slate-200 px-2 py-1 disabled:bg-slate-50"
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
                          disabled={quoteLocked}
                          className="text-xs font-semibold text-red-600 disabled:opacity-40"
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

          {paxAlloc.hasAllocLines && (
            <div
              className="mt-2 rounded-xl border px-4 py-2.5"
              style={
                allocHint
                  ? paxAlloc.remaining < 0
                    ? {
                        borderColor: '#FECACA',
                        backgroundColor: '#FEF2F2',
                        borderLeftWidth: 3,
                        borderLeftColor: '#DC2626',
                      }
                    : {
                        borderColor: '#F0E0C0',
                        backgroundColor: SUITE.orangeSoft,
                        borderLeftWidth: 3,
                        borderLeftColor: SUITE.orange,
                      }
                  : {
                      borderColor: '#C5E8E7',
                      backgroundColor: '#F0FAFA',
                      borderLeftWidth: 3,
                      borderLeftColor: '#0F9F9C',
                    }
              }
              role="status"
            >
              <p
                className="text-sm font-bold"
                style={{
                  color: allocHint
                    ? paxAlloc.remaining < 0
                      ? '#991B1B'
                      : SUITE.navy
                    : '#0B6E6C',
                }}
              >
                Asignados {paxAlloc.assigned} de {paxAlloc.total} personas
                {paxAlloc.remaining > 0
                  ? ` · faltan ${paxAlloc.remaining}`
                  : paxAlloc.remaining < 0
                    ? ` · sobran ${Math.abs(paxAlloc.remaining)}`
                    : ' · completo'}
              </p>
              {allocHint && (
                <p className="mt-0.5 text-xs" style={{ color: SUITE.muted }}>
                  {allocHint}
                </p>
              )}
            </div>
          )}

          {liveHint && (
            <p
              className="mt-2 rounded-lg border px-3 py-2 text-xs font-medium"
              style={{
                borderColor: SUITE.border,
                backgroundColor: SUITE.orangeSoft,
                color: SUITE.navySoft,
              }}
            >
              {liveHint}
            </p>
          )}

          <label className="mt-3 block text-sm">
            <span className="font-semibold text-slate-700">Notas</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              disabled={quoteLocked}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
              placeholder="Detalle del evento, horario, observaciones…"
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyServicio}
                disabled={quoteLocked}
                onChange={(e) => setApplyServicio(e.target.checked)}
              />
              Aplicar servicio {(EVENTOS_SERVICIO_PCT * 100).toFixed(0)}%
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={placeHold}
                disabled={quoteLocked}
                onChange={(e) => setPlaceHold(e.target.checked)}
              />
              Hold: bloquea la fecha por 72 h hábiles
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
                disabled={
                  busy ||
                  lines.length === 0 ||
                  !!liveHint ||
                  !!allocHint
                }
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
                  quoteLocked ||
                  lines.length === 0 ||
                  !!liveHint ||
                  !!allocHint ||
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
                    : quoteLocked
                      ? 'Bloqueada (≤7 días)'
                      : 'Guardar nueva cotización'}
              </button>
            </div>
          )}
          {!canEdit && lines.length > 0 && (
            <button
              type="button"
              disabled={!!liveHint || !!allocHint}
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
          <p className="mt-1 text-xs text-slate-500">
            Varias cotizaciones por cliente están permitidas; cada una es una
            versión distinta.
          </p>

          {clientId && clientQuotes.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                De este cliente ({clientQuotes.length})
              </p>
              <ul className="mt-2 max-h-[160px] space-y-1.5 overflow-y-auto">
                {clientQuotes.map((q) => (
                  <li key={`client-${q.id}`} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <a
                        href={`/eventos/cotizacion/${q.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold hover:underline"
                        style={{ color: SUITE.navy }}
                      >
                        {q.quote_number || q.id.slice(0, 8)}
                      </a>
                      <span className="font-semibold text-slate-700">
                        {formatMxn(q.total)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {STATUS_LABELS[q.status] || q.status}
                      {q.event_date
                        ? ` · ${new Date(
                            q.event_date + 'T12:00:00'
                          ).toLocaleDateString('es-MX', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}`
                        : ''}
                      {q.pax ? ` · ${q.pax} pax` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              Aún no hay cotizaciones. Arma líneas y guarda una nueva.
            </p>
          ) : (
            <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
              <li className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Recientes
              </li>
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
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.service_order_id ? (
                      <a
                        href={`/eventos/os/${q.service_order_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-white"
                        style={{ backgroundColor: SUITE.navy }}
                      >
                        Ver OS
                      </a>
                    ) : canEdit ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void generateOsFromQuote(q.id)}
                        className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                        style={{ backgroundColor: SUITE.navy }}
                        title="Marca cotización aceptada, lead ganado y crea OS digital"
                      >
                        Generar OS
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SuiteCard>
      </div>
    </div>
  );
}
