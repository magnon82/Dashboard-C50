'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SuiteCard, SuiteShell } from '@/app/components/SuiteShell';
import {
  SectionHeader,
  filterControlClass,
  filterSelectClass,
  yearChipClass,
} from '@/app/components/SectionHeader';
import {
  CALIDAD_PREGUNTAS,
  CALIDAD_TONOS,
  type CalidadComentario,
  type CalidadComentarios,
  type CalidadConteo,
  type CalidadPreguntaId,
  type CalidadResumen,
  type CalidadTono,
} from '@/app/lib/calidad-types';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

const RATING_COLORS = {
  excelente: SUITE.navy,
  bueno: SUITE.orange,
  regular: '#C4A574',
  malo: '#B42318',
} as const;

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatCount(n: number) {
  return n.toLocaleString('es-MX');
}

function formatPct(part: number, total: number) {
  if (!total) return '—';
  return `${((part / total) * 100).toLocaleString('es-MX', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatFecha(iso: string | null) {
  if (!iso) return 'Sin fecha';
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${MESES_CORTO[month - 1]} ${year}`;
}

function formatBucket(label: string, grain: 'month' | 'day') {
  if (grain === 'day') return formatFecha(label);
  const [year, month] = label.split('-').map(Number);
  if (!year || !month) return label;
  return `${MESES_CORTO[month - 1]} ${String(year).slice(2)}`;
}

function answered(conteo: CalidadConteo) {
  return conteo.excelente + conteo.bueno + conteo.regular + conteo.malo;
}

function syncLabel(data: CalidadResumen) {
  const sync = data.sync;
  if (!sync?.lastSyncedAt) return 'Aún no hay una sincronización registrada.';
  const when = new Date(sync.lastSyncedAt).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const inserted = sync.rowsInserted ?? 0;
  return `Última sync ${when} · ${formatCount(inserted)} encuestas nuevas`;
}

function RatingChip({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  const key = value.toLowerCase() as keyof typeof RATING_COLORS;
  const color = RATING_COLORS[key] || theme.muted;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: `${color}18`, color }}
    >
      {label} {value.toLowerCase()}
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color }}>
        {label}
      </p>
      <p className="mt-1 text-lg font-bold leading-none tabular-nums" style={{ color: theme.title }}>
        {value}
      </p>
      <p className="mt-1 text-xs tabular-nums" style={{ color: theme.muted }}>
        {hint}
      </p>
    </div>
  );
}

type TipRow = { name?: string; value?: number | string; color?: string };

function SerieTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipRow[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, row) => sum + Number(row.value || 0), 0);
  return (
    <div className="rounded-xl bg-white px-3 py-2 text-xs shadow-lg" style={{ color: theme.title }}>
      <p className="font-bold">{label}</p>
      {payload.map((row) => (
        <p key={row.name} className="mt-0.5">
          <span style={{ color: row.color }}>{row.name}</span>
          {': '}
          {formatCount(Number(row.value || 0))}
        </p>
      ))}
      <p className="mt-1 font-semibold">Total {formatCount(total)}</p>
    </div>
  );
}

function ComentarioCard({ item }: { item: CalidadComentario }) {
  return (
    <article className="rounded-2xl bg-slate-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold" style={{ color: theme.title }}>
          {item.mesero || 'Sin mesero'}
        </p>
        <p className="shrink-0 text-xs" style={{ color: theme.muted }}>
          {formatFecha(item.fecha)}
        </p>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
        {item.mesa ? `Mesa ${item.mesa}` : 'Sin mesa'}
        {item.ticket ? ` · Ticket ${item.ticket}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <RatingChip label="Servicio" value={item.servicio} />
        <RatingChip label="Alimentos" value={item.alimentos} />
        <RatingChip label="Bebidas" value={item.bebidas} />
        <RatingChip label="Limpieza" value={item.limpieza} />
      </div>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.title }}>
        {item.comentario}
      </p>
    </article>
  );
}

function yearInMexico(from = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
    }).format(from)
  );
}

export function CalidadDashboard() {
  const [year, setYear] = useState<number | null>(yearInMexico);
  const [month, setMonth] = useState<number | null>(null);
  const [mesero, setMesero] = useState<string | null>(null);
  const [pregunta, setPregunta] = useState<CalidadPreguntaId>('servicio');
  const [tono, setTono] = useState<CalidadTono>('malo');
  const [resumen, setResumen] = useState<CalidadResumen | null>(null);
  const [comentarios, setComentarios] = useState<CalidadComentarios | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (year) params.set('year', String(year));
    if (year && month) params.set('month', String(month));
    if (mesero) params.set('mesero', mesero);
    const base = params.toString();
    return base ? `?${base}` : '';
  }, [year, month, mesero]);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/calidad/resumen${query}`, { cache: 'no-store' });
        const json = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setError(json.error || 'No se pudieron cargar las encuestas');
          setResumen(null);
          return;
        }
        setResumen(json as CalidadResumen);
      } catch (err) {
        if (cancel) return;
        setResumen(null);
        setError(err instanceof Error ? err.message : 'Error de red al cargar encuestas');
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [query]);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setCommentsLoading(true);
      try {
        const join = query ? '&' : '?';
        const res = await fetch(`/api/calidad/comentarios${query}${join}tono=${tono}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setComentarios(null);
          return;
        }
        setComentarios(json as CalidadComentarios);
      } catch {
        if (!cancel) setComentarios(null);
      } finally {
        if (!cancel) setCommentsLoading(false);
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [query, tono]);

  const years = useMemo(() => {
    const current = yearInMexico();
    const fromApi = (resumen?.anios || []).filter((item) => Number.isFinite(item));
    const list = fromApi.length ? [...fromApi] : [];
    if (!list.length) {
      const min = resumen?.rango.min ? Number(resumen.rango.min.slice(0, 4)) : null;
      const max = resumen?.rango.max ? Number(resumen.rango.max.slice(0, 4)) : null;
      if (min && max && max - min <= 12) {
        for (let y = max; y >= min; y -= 1) list.push(y);
      }
    }
    if (!list.includes(current)) list.push(current);
    return list.sort((a, b) => b - a);
  }, [resumen?.anios, resumen?.rango.max, resumen?.rango.min]);

  const conteo = resumen?.preguntas[pregunta];
  const totalPregunta = conteo ? answered(conteo) : 0;
  const preguntaMeta = CALIDAD_PREGUNTAS.find((item) => item.id === pregunta)!;

  const donut = conteo
    ? [
        { name: 'Excelente', key: 'excelente', n: conteo.excelente },
        { name: 'Bueno', key: 'bueno', n: conteo.bueno },
        { name: 'Regular', key: 'regular', n: conteo.regular },
        { name: 'Malo', key: 'malo', n: conteo.malo },
      ].filter((slice) => slice.n > 0)
    : [];

  const serie = (conteo?.serie || []).map((point) => ({
    ...point,
    etiqueta: formatBucket(point.label, resumen?.grain || 'month'),
  }));

  const precioTotal =
    (resumen?.precios.justo || 0) + (resumen?.precios.caro || 0) + (resumen?.precios.barato || 0);
  const precios = resumen
    ? [
        { label: 'Justo', n: resumen.precios.justo, color: SUITE.navy },
        { label: 'Caro', n: resumen.precios.caro, color: '#B42318' },
        { label: 'Barato', n: resumen.precios.barato, color: SUITE.orange },
      ]
    : [];
  const canalMax = Math.max(1, ...(resumen?.canales || []).map((canal) => canal.n));

  return (
    <SuiteShell
      title="Calidad"
      subtitle={resumen ? `Encuestas de satisfacción · ${syncLabel(resumen)}` : 'Encuestas de satisfacción'}
    >
      <SectionHeader title="Encuestas de servicio">
        <label className={filterControlClass}>
          <span className="text-xs font-semibold" style={{ color: theme.muted }}>
            Periodo
          </span>
          <select
            className={filterSelectClass}
            value={year ?? ''}
            onChange={(event) => {
              const next = event.target.value ? Number(event.target.value) : null;
              setYear(next);
              setMonth(null);
            }}
          >
            <option value="">Todo el histórico</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        {year ? (
          <label className={filterControlClass}>
            <span className="text-xs font-semibold" style={{ color: theme.muted }}>
              Mes
            </span>
            <select
              className={filterSelectClass}
              value={month ?? ''}
              onChange={(event) => setMonth(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Todo el año</option>
              {MESES.map((nombre, index) => (
                <option key={nombre} value={index + 1}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={filterControlClass}>
          <span className="text-xs font-semibold" style={{ color: theme.muted }}>
            Mesero
          </span>
          <select
            className={filterSelectClass}
            value={mesero ?? ''}
            onChange={(event) => setMesero(event.target.value || null)}
          >
            <option value="">Todos</option>
            {(resumen?.meseros || [])
              .filter((item) => item.nombre !== 'Sin mesero')
              .map((item) => (
                <option key={item.nombre} value={item.nombre}>
                  {item.nombre}
                </option>
              ))}
          </select>
        </label>
      </SectionHeader>

      {loading && !resumen ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando encuestas…
        </p>
      ) : error && !resumen ? (
        <SuiteCard accent className="max-w-3xl">
          <p className="text-sm font-semibold" style={{ color: theme.title }}>
            No se pudo cargar el tablero
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.muted }}>
            {error}
          </p>
        </SuiteCard>
      ) : resumen && conteo ? (
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm" style={{ color: theme.muted }}>
              Actualizando periodo…
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
            <SuiteCard className="h-full">
              <h2 className="text-sm font-bold" style={{ color: theme.title }}>
                Meseros
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
                Encuestas del periodo y % excelente en servicio
              </p>
              <div className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto pr-1">
                {resumen.meseros.length === 0 ? (
                  <p className="text-sm" style={{ color: theme.muted }}>
                    Sin encuestas en este periodo.
                  </p>
                ) : (
                  resumen.meseros.map((item, index) => {
                    const active = mesero === item.nombre;
                    const selectable = item.nombre !== 'Sin mesero';
                    return (
                      <button
                        key={item.nombre}
                        type="button"
                        disabled={!selectable}
                        onClick={() => {
                          if (!selectable) return;
                          setMesero(active ? null : item.nombre);
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm disabled:cursor-default"
                        style={{
                          backgroundColor: active ? SUITE.navy : 'transparent',
                          color: active ? '#fff' : theme.title,
                        }}
                      >
                        <span className="w-6 shrink-0 tabular-nums" style={{ color: active ? '#fff' : theme.muted }}>
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{item.nombre}</span>
                        <span className="tabular-nums">{formatCount(item.encuestas)}</span>
                        <span
                          className="w-12 text-right text-xs tabular-nums"
                          style={{ color: active ? 'rgba(255,255,255,0.8)' : theme.muted }}
                        >
                          {formatPct(item.servicioExcelente, item.servicioRespondidas)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </SuiteCard>

            <SuiteCard>
              <div className="flex flex-wrap gap-2">
                {CALIDAD_PREGUNTAS.map((item) => {
                  const active = item.id === pregunta;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={yearChipClass(active)}
                      style={{
                        backgroundColor: active ? SUITE.navy : undefined,
                        color: active ? '#fff' : undefined,
                        border: active ? `2px solid ${SUITE.navy}` : '2px solid #e2e8f0',
                      }}
                      onClick={() => setPregunta(item.id)}
                    >
                      {item.short}
                    </button>
                  );
                })}
              </div>
              <h2 className="mt-4 text-base font-bold leading-snug" style={{ color: theme.title }}>
                {preguntaMeta.title}
              </h2>
              <p className="mt-1 text-xs" style={{ color: theme.muted }}>
                {formatCount(totalPregunta)} respuestas
                {resumen.encuestas ? ` · ${formatCount(resumen.encuestas)} encuestas en el filtro` : ''}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <Kpi
                  label="Excelente"
                  value={formatCount(conteo.excelente)}
                  hint={formatPct(conteo.excelente, totalPregunta)}
                  color={RATING_COLORS.excelente}
                />
                <Kpi
                  label="Bueno"
                  value={formatCount(conteo.bueno)}
                  hint={formatPct(conteo.bueno, totalPregunta)}
                  color={RATING_COLORS.bueno}
                />
                <Kpi
                  label="Regular"
                  value={formatCount(conteo.regular)}
                  hint={formatPct(conteo.regular, totalPregunta)}
                  color={RATING_COLORS.regular}
                />
                <Kpi
                  label="Malo"
                  value={formatCount(conteo.malo)}
                  hint={formatPct(conteo.malo, totalPregunta)}
                  color={RATING_COLORS.malo}
                />
              </div>

              {totalPregunta === 0 ? (
                <p className="mt-6 text-sm" style={{ color: theme.muted }}>
                  No hay calificaciones de esta pregunta en el periodo.
                </p>
              ) : (
                <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <div>
                    <div className="relative h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donut}
                            dataKey="n"
                            nameKey="name"
                            innerRadius={62}
                            outerRadius={88}
                            paddingAngle={1}
                            stroke="none"
                          >
                            {donut.map((slice) => (
                              <Cell
                                key={slice.key}
                                fill={RATING_COLORS[slice.key as keyof typeof RATING_COLORS]}
                              />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => formatCount(Number(value || 0))} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <p className="text-2xl font-bold tabular-nums" style={{ color: theme.title }}>
                          {formatPct(conteo.excelente, totalPregunta)}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: theme.muted }}>
                          Excelente
                        </p>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {donut.map((slice) => (
                        <li key={slice.key} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2" style={{ color: theme.title }}>
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: RATING_COLORS[slice.key as keyof typeof RATING_COLORS] }}
                            />
                            {slice.name}
                          </span>
                          <span className="tabular-nums" style={{ color: theme.muted }}>
                            {formatPct(slice.n, totalPregunta)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="h-72">
                    {serie.length === 0 ? (
                      <p className="text-sm" style={{ color: theme.muted }}>
                        Sin fechas para armar la serie.
                      </p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid vertical={false} stroke="#E2E8F0" />
                          <XAxis
                            dataKey="etiqueta"
                            tick={{ fontSize: 11, fill: theme.muted }}
                            interval={serie.length > 18 ? Math.ceil(serie.length / 12) : 0}
                            angle={serie.length > 8 ? -40 : 0}
                            textAnchor={serie.length > 8 ? 'end' : 'middle'}
                            height={serie.length > 8 ? 48 : 24}
                          />
                          <YAxis tick={{ fontSize: 11, fill: theme.muted }} width={36} />
                          <Tooltip content={<SerieTooltip />} />
                          <Bar dataKey="excelente" name="Excelente" stackId="nota" fill={RATING_COLORS.excelente} />
                          <Bar dataKey="bueno" name="Bueno" stackId="nota" fill={RATING_COLORS.bueno} />
                          <Bar dataKey="regular" name="Regular" stackId="nota" fill={RATING_COLORS.regular} />
                          <Bar dataKey="malo" name="Malo" stackId="nota" fill={RATING_COLORS.malo} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )}
            </SuiteCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SuiteCard>
              <h2 className="text-sm font-bold" style={{ color: theme.title }}>
                Percepción de precios
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
                {formatCount(precioTotal)} respuestas
              </p>
              <div className="mt-4 space-y-3">
                {precios.map((item) => (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-semibold" style={{ color: theme.title }}>
                        {item.label}
                      </span>
                      <span className="tabular-nums" style={{ color: theme.muted }}>
                        {formatCount(item.n)} · {formatPct(item.n, precioTotal)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${precioTotal ? (item.n / precioTotal) * 100 : 0}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SuiteCard>

            <SuiteCard>
              <h2 className="text-sm font-bold" style={{ color: theme.title }}>
                Cómo se enteró
              </h2>
              <div className="mt-4 space-y-3">
                {resumen.canales.length === 0 ? (
                  <p className="text-sm" style={{ color: theme.muted }}>
                    Sin respuestas en este periodo.
                  </p>
                ) : (
                  resumen.canales.map((canal) => (
                    <div key={canal.label}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-semibold" style={{ color: theme.title }}>
                          {canal.label}
                        </span>
                        <span className="tabular-nums" style={{ color: theme.muted }}>
                          {formatCount(canal.n)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(canal.n / canalMax) * 100}%`,
                            backgroundColor: SUITE.navy,
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SuiteCard>
          </div>

          <SuiteCard>
            <h2 className="text-sm font-bold" style={{ color: theme.title }}>
              Comentarios para corregir
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
              El tono es la peor nota entre servicio, alimentos, bebidas y limpieza.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CALIDAD_TONOS.map((item) => {
                const active = tono === item.id;
                const count = comentarios?.counts[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={yearChipClass(active)}
                    style={{
                      backgroundColor: active ? SUITE.navy : undefined,
                      color: active ? '#fff' : undefined,
                      border: active ? `2px solid ${SUITE.navy}` : '2px solid #e2e8f0',
                    }}
                    onClick={() => setTono(item.id)}
                  >
                    {item.label}
                    {count != null ? ` · ${formatCount(count)}` : ''}
                  </button>
                );
              })}
            </div>
            {commentsLoading && !comentarios ? (
              <p className="mt-4 text-sm" style={{ color: theme.muted }}>
                Cargando comentarios…
              </p>
            ) : comentarios && comentarios.items.length === 0 ? (
              <p className="mt-4 text-sm" style={{ color: theme.muted }}>
                No hay comentarios de este tono en el periodo.
              </p>
            ) : comentarios ? (
              <>
                <p className="mt-3 text-xs" style={{ color: theme.muted }}>
                  {comentarios.items.length < comentarios.total
                    ? `Mostrando ${formatCount(comentarios.items.length)} de ${formatCount(comentarios.total)}, los más recientes.`
                    : `${formatCount(comentarios.total)} comentarios.`}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {comentarios.items.map((item, index) => (
                    <ComentarioCard key={`${item.fecha}-${item.ticket}-${index}`} item={item} />
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm" style={{ color: theme.muted }}>
                No se pudieron cargar los comentarios.
              </p>
            )}
          </SuiteCard>
        </div>
      ) : null}
    </SuiteShell>
  );
}
