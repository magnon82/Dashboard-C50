/**
 * Reservaciones mesa · Carranza 50
 * Nivel 1/2: plantilla WhatsApp + registro (sin calendario / API de negocio).
 */

export type ReservaFormInput = {
  nombre: string;
  personas: number;
  telefono: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:mm
  motivo?: string;
  alergias?: string;
  notas?: string;
};

export type ReservaPayload = {
  nombre: string;
  personas: number;
  telefono: string;
  fecha: string;
  hora: string;
  motivo: string;
  alergias: string;
  notas: string;
};

export const RESERVAS_BRAND_DEFAULT = 'Carranza 50';

/** Teléfono Eventos / restaurante (442) 212 3031 → E.164 sin + */
export const RESERVAS_WHATSAPP_DEFAULT = '524422123031';

export function reservasBrand(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_RESERVAS_BRAND || '').trim();
  return fromEnv || RESERVAS_BRAND_DEFAULT;
}

export function reservasWhatsAppDigits(): string {
  const raw = (
    process.env.NEXT_PUBLIC_RESERVAS_WHATSAPP || RESERVAS_WHATSAPP_DEFAULT
  ).replace(/\D/g, '');
  if (!raw) return RESERVAS_WHATSAPP_DEFAULT;
  return raw.startsWith('52') ? raw : `52${raw}`;
}

export function digitsOnly(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

/** Normaliza teléfono del cliente (México): 10 dígitos o con 52. */
export function normalizeClientPhone(value: string): string | null {
  let d = digitsOnly(value);
  if (d.startsWith('52') && d.length === 12) d = d.slice(2);
  if (d.startsWith('1') && d.length === 11) d = d.slice(1);
  if (d.length !== 10) return null;
  return d;
}

export function formatFechaMx(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!m) return yyyyMmDd.trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function buildReservaWhatsAppMessage(
  data: ReservaPayload,
  brand = reservasBrand()
): string {
  const line = (label: string, value: string) =>
    `${label}: ${value.trim() || '—'}`;

  return [
    `Hola, quiero reservar en ${brand}.`,
    line('Nombre', data.nombre),
    line('Número de personas', String(data.personas)),
    line('Número telefónico', data.telefono),
    line('Fecha', formatFechaMx(data.fecha)),
    line('Motivo', data.motivo),
    line('Hora', data.hora),
    line('Alergias', data.alergias),
    line('Notas', data.notas),
  ].join('\n');
}

/** Plantilla vacía (Nivel 1 — click directo). */
export function buildReservaWhatsAppTemplate(brand = reservasBrand()): string {
  return [
    `Hola, quiero reservar en ${brand}.`,
    'Nombre:',
    'Número de personas:',
    'Número telefónico:',
    'Fecha:',
    'Motivo:',
    'Hora:',
    'Alergias:',
    'Notas:',
  ].join('\n');
}

export function buildWhatsAppHref(text: string, businessDigits?: string): string {
  const digits = (businessDigits || reservasWhatsAppDigits()).replace(/\D/g, '');
  const e164 = digits.startsWith('52') ? digits : `52${digits}`;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseReservaBody(body: unknown):
  | { ok: true; data: ReservaPayload }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Datos inválidos' };
  }
  const b = body as Record<string, unknown>;

  const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
  if (nombre.length < 2 || nombre.length > 120) {
    return { ok: false, error: 'Indica tu nombre (2–120 caracteres)' };
  }

  const personasRaw =
    typeof b.personas === 'number'
      ? b.personas
      : typeof b.personas === 'string'
        ? Number(b.personas)
        : NaN;
  const personas = Math.floor(personasRaw);
  if (!Number.isFinite(personas) || personas < 1 || personas > 40) {
    return { ok: false, error: 'Número de personas entre 1 y 40' };
  }

  const telefonoRaw = typeof b.telefono === 'string' ? b.telefono.trim() : '';
  const telefono = normalizeClientPhone(telefonoRaw);
  if (!telefono) {
    return { ok: false, error: 'Teléfono a 10 dígitos (México)' };
  }

  const fecha = typeof b.fecha === 'string' ? b.fecha.trim() : '';
  if (!ISO_DATE.test(fecha)) {
    return { ok: false, error: 'Fecha inválida' };
  }

  const horaRaw = typeof b.hora === 'string' ? b.hora.trim() : '';
  const hora = horaRaw.length === 5 ? horaRaw : horaRaw.slice(0, 5);
  if (!TIME_HM.test(hora)) {
    return { ok: false, error: 'Hora inválida' };
  }

  const optional = (v: unknown, max: number) => {
    if (typeof v !== 'string') return '';
    return v.trim().slice(0, max);
  };

  return {
    ok: true,
    data: {
      nombre,
      personas,
      telefono,
      fecha,
      hora,
      motivo: optional(b.motivo, 120),
      alergias: optional(b.alergias, 200),
      notas: optional(b.notas, 500),
    },
  };
}

/** Hoy en America/Mexico_City como YYYY-MM-DD (para min del date input). */
export function todayYmdMexico(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
