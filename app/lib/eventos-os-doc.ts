/**
 * Modelo de documento OS digital (HTML / impresión).
 */

import {
  EVENTOS_CONTACT,
  formatEventDateEs,
  formatIssuedAtEs,
  formatMxn,
  optionEntries,
  type CotizacionDocLine,
} from '@/app/lib/eventos-cotizacion-doc';
import type { ServiceOrderRow } from '@/app/lib/eventos-service-order-shared';
import { EVENTOS_SERVICIO_PCT } from '@/app/lib/eventos';

export type OrdenServicioDoc = {
  os_number: string | null;
  status: string | null;
  client_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  celebration: string | null;
  event_date: string | null;
  pax: number;
  notes: string | null;
  apply_servicio: boolean;
  servicio_pct: number;
  subtotal: number;
  servicio_amount: number;
  total: number;
  lines: CotizacionDocLine[];
  quote_number: string | null;
  issued_at?: string | null;
  owner_username?: string | null;
};

export function serviceOrderToDoc(order: ServiceOrderRow): OrdenServicioDoc {
  return {
    os_number: order.os_number,
    status: order.status,
    client_name: order.client_name,
    contact_name: order.contact_name,
    phone: order.phone || order.payload?.phone || null,
    email: order.email || order.payload?.email || null,
    celebration: order.celebration,
    event_date: order.event_date,
    pax: Number(order.pax || 0),
    notes: order.notes,
    apply_servicio: order.apply_servicio,
    servicio_pct: order.servicio_pct ?? EVENTOS_SERVICIO_PCT,
    subtotal: order.subtotal,
    servicio_amount: order.servicio_amount,
    total: order.total,
    lines: (order.payload?.lines || []).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      options: l.options || {},
    })),
    quote_number: order.payload?.quote_number || null,
    issued_at: order.created_at || order.updated_at || null,
    owner_username: order.owner_username,
  };
}

export {
  EVENTOS_CONTACT,
  formatEventDateEs,
  formatIssuedAtEs,
  formatMxn,
  optionEntries,
};
