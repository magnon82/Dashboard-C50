'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { todayCdmxIso } from '@/app/lib/saldos';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type Snapshot = {
  date: string;
  mifel: number | null;
  bbva: number | null;
};

export function AdminSaldosBancos() {
  const [mifel, setMifel] = useState('');
  const [bbva, setBbva] = useState('');
  const [date, setDate] = useState(() => todayCdmxIso());
  const [manual, setManual] = useState<Snapshot | null>(null);
  const [presupuesto, setPresupuesto] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const maxDate = todayCdmxIso();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/saldos-bancos', { cache: 'no-store' });
      const json = (await res.json()) as {
        error?: string;
        today?: string;
        manual?: Snapshot | null;
        presupuesto?: Snapshot | null;
        display?: Snapshot | null;
      };
      if (!res.ok) {
        setError(json.error || 'No se pudieron cargar saldos');
        return;
      }
      setManual(json.manual ?? null);
      setPresupuesto(json.presupuesto ?? null);
      // Campos de captura vacíos por defecto; el resumen arriba muestra el saldo activo.
      setMifel('');
      setBbva('');
      setDate(json.today || todayCdmxIso());
    } catch {
      setError('Error de red al cargar saldos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setOkMsg('');
    const today = todayCdmxIso();
    if (date > today) {
      setError(`No se puede capturar saldo con fecha futura (máximo hoy CDMX: ${today})`);
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/admin/saldos-bancos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          mifel: Number(String(mifel).replace(/,/g, '')),
          bbva: Number(String(bbva).replace(/,/g, '')),
        }),
      });
      const json = (await res.json()) as { error?: string; date?: string };
      if (!res.ok) {
        setError(json.error || 'No se pudo guardar');
        return;
      }
      setOkMsg(`Saldos guardados al ${json.date || date}`);
      await load();
    } catch {
      setError('Error de red al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="mb-8 rounded-[24px] border border-slate-100 bg-white p-5"
      style={{ boxShadow: SUITE.shadow, borderTop: `4px solid ${SUITE.orange}` }}
    >
      <div className="mb-1">
        <h2 className="text-lg font-bold" style={{ color: theme.title }}>
          Saldos bancarios
        </h2>
        <p className="mt-1 text-sm" style={{ color: theme.muted }}>
          Actualiza Mifel y BBVA tras revisar la banca en línea. El valor manual reemplaza el
          Excel en Finanzas → Saldos al día (
          <code className="text-xs">saldos_bancos_manual</code>).
        </p>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {okMsg}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm" style={{ color: theme.muted }}>
          Cargando saldos…
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Manual (activo)
              </p>
              {manual ? (
                <p className="mt-1 text-sm text-slate-700">
                  {money(manual.mifel ?? 0)} Mifel + {money(manual.bbva ?? 0)} BBVA
                  <span className="mt-0.5 block text-xs text-slate-500">Al {manual.date}</span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Sin override manual</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Excel presupuesto
              </p>
              {presupuesto ? (
                <p className="mt-1 text-sm text-slate-700">
                  {money(presupuesto.mifel ?? 0)} Mifel + {money(presupuesto.bbva ?? 0)} BBVA
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Al {presupuesto.date}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Sin datos de Excel</p>
              )}
            </div>
          </div>

          <form onSubmit={onSave} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm font-semibold text-slate-700">
              Mifel
              <input
                required
                inputMode="decimal"
                value={mifel}
                onChange={(e) => setMifel(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              BBVA
              <input
                required
                inputMode="decimal"
                value={bbva}
                onChange={(e) => setBbva(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Fecha
              <input
                required
                type="date"
                value={date}
                max={maxDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setDate(next > maxDate ? maxDate : next);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: SUITE.navy }}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
