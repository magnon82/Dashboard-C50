/** Contenido CMS de Reportes Socios (singleton en Supabase). */

export type ResumenKpi = {
  label: string;
  value: string;
  hint: string;
};

export type IndicadorItem = {
  label: string;
  value: string;
  note: string;
};

export type DetalleRow = {
  periodo: string;
  concepto: string;
  monto: string;
  nota: string;
};

export type NotaItem = {
  title: string;
  body: string;
  url: string;
};

export type ReportesSociosContent = {
  resumen: {
    intro: string;
    kpis: ResumenKpi[];
  };
  indicadores: {
    body: string;
    items: IndicadorItem[];
  };
  detalle: {
    body: string;
    rows: DetalleRow[];
  };
  notas: {
    body: string;
    items: NotaItem[];
  };
};

export const DEFAULT_REPORTES_SOCIOS_CONTENT: ReportesSociosContent = {
  resumen: {
    intro: '',
    kpis: [
      { label: 'Resumen del periodo', value: '', hint: '' },
      { label: 'Comparativo', value: '', hint: '' },
      { label: 'Distribución', value: '', hint: '' },
    ],
  },
  indicadores: { body: '', items: [] },
  detalle: { body: '', rows: [] },
  notas: { body: '', items: [] },
};

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function normalizeKpis(raw: unknown): ResumenKpi[] {
  const defaults = DEFAULT_REPORTES_SOCIOS_CONTENT.resumen.kpis;
  if (!Array.isArray(raw) || raw.length === 0) return defaults.map((k) => ({ ...k }));
  const mapped = raw.slice(0, 6).map((item, i) => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      label: asStr(o.label) || defaults[i]?.label || `Indicador ${i + 1}`,
      value: asStr(o.value),
      hint: asStr(o.hint),
    };
  });
  while (mapped.length < 3) {
    const i = mapped.length;
    mapped.push({ ...defaults[i] });
  }
  return mapped;
}

export function normalizeReportesSociosContent(raw: unknown): ReportesSociosContent {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const resumen = (o.resumen && typeof o.resumen === 'object' ? o.resumen : {}) as Record<
    string,
    unknown
  >;
  const indicadores = (
    o.indicadores && typeof o.indicadores === 'object' ? o.indicadores : {}
  ) as Record<string, unknown>;
  const detalle = (o.detalle && typeof o.detalle === 'object' ? o.detalle : {}) as Record<
    string,
    unknown
  >;
  const notas = (o.notas && typeof o.notas === 'object' ? o.notas : {}) as Record<
    string,
    unknown
  >;

  return {
    resumen: {
      intro: asStr(resumen.intro),
      kpis: normalizeKpis(resumen.kpis),
    },
    indicadores: {
      body: asStr(indicadores.body),
      items: Array.isArray(indicadores.items)
        ? indicadores.items.map((item) => {
            const x = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
            return {
              label: asStr(x.label),
              value: asStr(x.value),
              note: asStr(x.note),
            };
          })
        : [],
    },
    detalle: {
      body: asStr(detalle.body),
      rows: Array.isArray(detalle.rows)
        ? detalle.rows.map((item) => {
            const x = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
            return {
              periodo: asStr(x.periodo),
              concepto: asStr(x.concepto),
              monto: asStr(x.monto),
              nota: asStr(x.nota),
            };
          })
        : [],
    },
    notas: {
      body: asStr(notas.body),
      items: Array.isArray(notas.items)
        ? notas.items.map((item) => {
            const x = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
            return {
              title: asStr(x.title),
              body: asStr(x.body),
              url: asStr(x.url),
            };
          })
        : [],
    },
  };
}

export function hasResumenContent(c: ReportesSociosContent): boolean {
  if (c.resumen.intro.trim()) return true;
  return c.resumen.kpis.some((k) => k.value.trim() || k.hint.trim());
}

export function hasIndicadoresContent(c: ReportesSociosContent): boolean {
  if (c.indicadores.body.trim()) return true;
  return c.indicadores.items.some((i) => i.label.trim() || i.value.trim() || i.note.trim());
}

export function hasDetalleContent(c: ReportesSociosContent): boolean {
  if (c.detalle.body.trim()) return true;
  return c.detalle.rows.some(
    (r) => r.periodo.trim() || r.concepto.trim() || r.monto.trim() || r.nota.trim()
  );
}

export function hasNotasContent(c: ReportesSociosContent): boolean {
  if (c.notas.body.trim()) return true;
  return c.notas.items.some((i) => i.title.trim() || i.body.trim() || i.url.trim());
}
