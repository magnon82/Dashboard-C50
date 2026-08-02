/**
 * Permisos granulares del Suite (además de módulos de lectura).
 * Se guardan en el payload del usuario (`capabilities: string[]`) y en la sesión.
 * Ampliar aquí cuando Master agregue más «palomitas».
 */

export type CapabilityId = 'staff.corte';

export type AppCapability = {
  id: CapabilityId;
  /** Etiqueta en Master (español Suite). */
  label: string;
  /** Texto de ayuda bajo el checkbox. */
  hint: string;
};

export const APP_CAPABILITIES: AppCapability[] = [
  {
    id: 'staff.corte',
    label: 'Puede hacer el corte',
    hint: 'Staff · Corte del día / TPV (subir fotos y cerrar caja)',
  },
];

export const CAPABILITY_IDS = new Set(
  APP_CAPABILITIES.map((c) => c.id as string)
);

/** Operadores de piso que ya tenían corte antes del flag (migración). */
export const STAFF_CORTE_SEED_USERNAMES = ['roman', 'roberto'] as const;

export function normalizeCapabilities(
  raw: unknown
): CapabilityId[] {
  if (!Array.isArray(raw)) return [];
  const out: CapabilityId[] = [];
  for (const item of raw) {
    const id = String(item || '')
      .trim()
      .toLowerCase();
    if (CAPABILITY_IDS.has(id) && !out.includes(id as CapabilityId)) {
      out.push(id as CapabilityId);
    }
  }
  return out;
}

export function hasCapability(
  capabilities: string[] | null | undefined,
  id: CapabilityId,
  opts?: { role?: string; modules?: string[] }
): boolean {
  if (opts?.role === 'admin' || opts?.modules?.includes('*')) return true;
  return (capabilities || []).includes(id);
}
