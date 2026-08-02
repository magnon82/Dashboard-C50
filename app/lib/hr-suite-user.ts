import { formatHrListName } from '@/app/lib/hr-person-match';

/**
 * Contraseña inicial Staff = día+mes de ingreso (DDMM, cero-padded).
 * Ej.: fecha_ingreso 2023-01-12 → `1201`.
 */
export function passwordFromFechaIngreso(
  fechaIngreso: string | null | undefined
): string | null {
  if (!fechaIngreso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaIngreso).trim());
  if (!m) return null;
  const dd = m[3]!;
  const mm = m[2]!;
  if (dd === '00' || mm === '00') return null;
  return `${dd}${mm}`;
}

/** Username Suite sugerido desde nombre de plantilla (sin acentos, minúsculas). */
export function suggestSuiteUsername(fullName: string): string {
  const display = formatHrListName(fullName);
  const parts = display
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'usuario';
  // Preferir 2.º nombre de pila (roman, roberto, fernando) si hay apellido.
  if (parts.length >= 3) return parts[parts.length - 2]!;
  return parts[0]!;
}

export function sanitizeSuiteUsername(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 32);
}
