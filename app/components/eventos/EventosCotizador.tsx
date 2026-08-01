'use client';

import { useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  EVENTOS_MIN_PAX_GRUPOS,
  EVENTOS_SERVICIO_PCT,
  computeQuoteTotals,
  formatMxn,
  validateQuotePax,
  type EventClient,
  type EventMenu,
  type EventMenuItem,
} from '@/app/lib/eventos';
import { getTheme, SUITE } from '@/app/lib/themes';
import { useSession } from '@/app/lib/useSession';

const theme = getTheme('suite');

type DraftLine = {
  key: string;
  menu_item_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  category: string;
  requires_food: boolean;
  includes_servicio: boolean;
};

export function EventosCotizador({
  menus,
  clients,
  onSaved,
}: {
  menus: EventMenu[];
  clients: EventClient[];
  onSaved: () => Promise<void>;
}) {
  const { user } = useSession();
  const canEdit = !!user?.canEdit;
  const [menuId, setMenuId] = useState(menus[0]?.id || '');
  const [itemId, setItemId] = useState('');
  const [pax, setPax] = useState(EVENTOS_MIN_PAX_GRUPOS);
  const [clientId, setClientId] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [notes, setNotes] = useState('');
  const [applyServicio, setApplyServicio] = useState(true);
  const [placeHold, setPlaceHold] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [recentQuotes, setRecentQuotes] = useState<
    Array<{ id: string; quote_number: string | null; total: number; status: string }>
  >([]);

  const selectedMenu = menus.find((m) => m.id === menuId) || null;
  const items = selectedMenu?.items || [];

  const totals = useMemo(
    () => computeQuoteTotals(lines, applyServicio, EVENTOS_SERVICIO_PCT),
    [lines, applyServicio]
  );

  function addLine() {
    const item: EventMenuItem | undefined = items.find((i) => i.id === itemId);
    if (!item || !selectedMenu) {
      setErr('Selecciona un ítem del catálogo');
      return;
    }
    setErr('');
    const qty =
      item.unit === 'persona' ? Math.max(1, pax) : item.unit === 'paquete' ? 1 : 1;

    // Si el paquete ya incluye servicio (parejas), sugerir apagar 15%
    if (selectedMenu.includes_servicio) {
      setApplyServicio(false);
    }

    setLines((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        menu_item_id: item.id,
        description: item.name,
        quantity: qty,
        unit_price: Number(item.unit_price),
        category: selectedMenu.category,
        requires_food: selectedMenu.requires_food,
        includes_servicio: selectedMenu.includes_servicio,
      },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function saveDraft() {
    if (!canEdit) return;
    setBusy(true);
    setErr('');
    setMsg('');

    const validation = validateQuotePax(
      pax,
      lines.map((l) => ({
        category: l.category,
        requiresFood: l.requires_food,
      }))
    );
    if (validation) {
      setErr(validation);
      setBusy(false);
      return;
    }

    try {
      const res = await fetch('/api/eventos/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId || null,
          event_date: eventDate || null,
          pax,
          notes,
          apply_servicio: applyServicio,
          place_hold: placeHold,
          lines: lines.map((l) => ({
            menu_item_id: l.menu_item_id,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo guardar');
        return;
      }
      setMsg(
        `Cotización ${json.quote?.quote_number || ''} guardada · ${formatMxn(
          Number(json.quote?.total || totals.total)
        )}`
      );
      if (json.quote) {
        setRecentQuotes((prev) => [
          {
            id: json.quote.id,
            quote_number: json.quote.quote_number,
            total: Number(json.quote.total),
            status: json.quote.status,
          },
          ...prev,
        ].slice(0, 5));
      }
      setLines([]);
      await onSaved();
    } catch {
      setErr('Error de red al guardar cotización');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Armar cotización
          </h3>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            Catálogo sembrado desde menús vigentes 2025. Subtotal + servicio{' '}
            {(EVENTOS_SERVICIO_PCT * 100).toFixed(0)}%
            {applyServicio ? '' : ' (desactivado)'}.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="font-semibold text-slate-700">Cliente</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Sin asignar</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </label>
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
              <input
                type="number"
                min={1}
                value={pax}
                onChange={(e) => setPax(Number(e.target.value) || 1)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="font-semibold text-slate-700">Menú / catálogo</span>
              <select
                value={menuId}
                onChange={(e) => {
                  setMenuId(e.target.value);
                  setItemId('');
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
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
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Seleccionar…</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} · {formatMxn(Number(it.unit_price))}/{it.unit}
                    {!it.price_verified ? ' *' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={addLine}
              className="rounded-xl px-4 py-2.5 text-sm font-bold text-white"
              style={{ backgroundColor: SUITE.navy }}
            >
              Agregar línea
            </button>
          </div>

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
                      Sin líneas. Elige menú e ítem.
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.key} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {l.description}
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
                      <td className="px-3 py-2">{formatMxn(l.unit_price)}</td>
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

          <label className="mt-3 block text-sm">
            <span className="font-semibold text-slate-700">Notas</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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

          {(err || msg) && (
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: err ? '#b91c1c' : SUITE.navy }}
            >
              {err || msg}
            </p>
          )}

          {canEdit && (
            <button
              type="button"
              disabled={busy || lines.length === 0}
              onClick={saveDraft}
              className="mt-4 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: SUITE.orange }}
            >
              {busy ? 'Guardando…' : 'Guardar borrador en Supabase'}
            </button>
          )}
          {!canEdit && (
            <p className="mt-3 text-sm text-slate-500">
              Sesión de solo lectura: puedes simular totales, no guardar.
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
            * Ítems sin verificar: precio de seed/cost sheet. Parejas: el PDF ya
            incluye propina — desactiva servicio si aplica.
          </p>
        </SuiteCard>

        <SuiteCard>
          <h4 className="text-sm font-bold" style={{ color: theme.title }}>
            Guardadas en esta sesión
          </h4>
          {recentQuotes.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aún no hay borradores nuevos.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recentQuotes.map((q) => (
                <li
                  key={q.id}
                  className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{q.quote_number || q.id.slice(0, 8)}</span>
                  <span>
                    {formatMxn(q.total)} · {q.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SuiteCard>
      </div>
    </div>
  );
}
