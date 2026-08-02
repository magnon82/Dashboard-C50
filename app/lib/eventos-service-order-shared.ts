import type { QuoteLineOptions } from '@/app/lib/eventos';

export type ServiceOrderLine = {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  options: QuoteLineOptions;
};

export type ServiceOrderPayload = {
  lines: ServiceOrderLine[];
  quote_number?: string | null;
  source?: string;
  phone?: string | null;
  email?: string | null;
};

export const SERVICE_ORDER_STATUSES = [
  'borrador',
  'emitida',
  'en_curso',
  'cerrada',
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export type ServiceOrderRow = {
  id: string;
  os_number: string | null;
  status: string;
  quote_id: string | null;
  lead_id: string | null;
  client_id: string | null;
  event_date: string | null;
  pax: number | null;
  celebration: string | null;
  client_name: string | null;
  contact_name: string | null;
  /** Desde payload (snapshot al generar OS) */
  phone: string | null;
  email: string | null;
  notes: string | null;
  subtotal: number;
  servicio_pct: number;
  servicio_amount: number;
  total: number;
  apply_servicio: boolean;
  owner_username: string | null;
  payload: ServiceOrderPayload;
  created_at?: string;
  updated_at?: string;
};

export type CreateOsResult = {
  order: ServiceOrderRow | null;
  created: boolean;
  error?: string;
  hint?: string;
};

