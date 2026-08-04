/**
 * Aceptación online de cotización + métodos de pago + datos BBVA / site URL.
 */

import { publicQuotePath } from '@/app/lib/eventos-quote-public';

export const QUOTE_PAYMENT_METHODS = [
  'efectivo_restaurante',
  'tarjeta_terminal',
  'tarjeta_link',
  'transferencia_bbva',
] as const;

export type QuotePaymentMethod = (typeof QUOTE_PAYMENT_METHODS)[number];

export const QUOTE_PAYMENT_METHOD_LABELS: Record<QuotePaymentMethod, string> = {
  efectivo_restaurante: 'Efectivo en el restaurante',
  tarjeta_terminal: 'Tarjeta en la terminal del restaurante',
  tarjeta_link: 'Tarjeta por link de pago',
  transferencia_bbva: 'Transferencia a cuenta de BBVA',
};

export function isQuotePaymentMethod(v: unknown): v is QuotePaymentMethod {
  return (
    typeof v === 'string' &&
    (QUOTE_PAYMENT_METHODS as readonly string[]).includes(v)
  );
}

export type BbvaTransferDetails = {
  bank: string;
  beneficiary: string;
  clabe: string | null;
  account: string | null;
  referenceHint: string | null;
  configured: boolean;
};

/** Datos de transferencia BBVA (env o placeholders para que RH complete). */
export function getBbvaTransferDetails(): BbvaTransferDetails {
  const beneficiary =
    process.env.EVENTOS_BBVA_BENEFICIARY?.trim() || 'Carranza 50';
  const clabe = process.env.EVENTOS_BBVA_CLABE?.trim() || null;
  const account = process.env.EVENTOS_BBVA_ACCOUNT?.trim() || null;
  const referenceHint =
    process.env.EVENTOS_BBVA_REFERENCE_HINT?.trim() ||
    'Usa el folio de cotización como referencia';
  return {
    bank: 'BBVA',
    beneficiary,
    clabe,
    account,
    referenceHint,
    configured: Boolean(clabe || account),
  };
}

/**
 * Origen absoluto del sitio (producción: NEXT_PUBLIC_SITE_URL).
 * En cliente sin env, cae a window.location.origin.
 */
export function publicSiteOrigin(request?: Request | null): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
  if (env) return env;

  if (request) {
    const host =
      request.headers.get('x-forwarded-host') ||
      request.headers.get('host') ||
      '';
    if (host) {
      const proto =
        request.headers.get('x-forwarded-proto') ||
        (host.includes('localhost') ? 'http' : 'https');
      return `${proto}://${host}`.replace(/\/$/, '');
    }
    try {
      return new URL(request.url).origin;
    } catch {
      /* ignore */
    }
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
}

/** URL absoluta de la cotización pública `/c/{token}`. */
export function absolutePublicQuoteUrl(
  tokenOrPath: string,
  request?: Request | null
): string {
  const token = tokenOrPath.startsWith('/c/')
    ? decodeURIComponent(tokenOrPath.slice(3).split(/[?#]/)[0] || '')
    : tokenOrPath.trim();
  const path = token.startsWith('/')
    ? token
    : publicQuotePath(token);
  const origin = publicSiteOrigin(request);
  return origin ? `${origin}${path}` : path;
}

/** Misma lógica en el navegador (Copiar enlace). */
export function browserPublicQuoteUrl(publicPath: string): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
  if (env) return `${env}${publicPath}`;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${publicPath}`;
  }
  return publicPath;
}
