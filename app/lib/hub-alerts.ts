import type { ModuleId } from '@/app/lib/modules';

export type HubAlertSeverity = 'warn' | 'ok' | 'neutral';

export type HubModuleAlert = {
  text: string;
  severity: HubAlertSeverity;
};

/** Módulos activos del hub con fuente de alerta (o «Sin alertas»). */
export const HUB_ALERT_MODULE_IDS = [
  'reportes-socios',
  'staff',
  'ventas',
  'finanzas',
  'eventos',
  'rrhh',
] as const satisfies readonly ModuleId[];

export type HubAlertModuleId = (typeof HUB_ALERT_MODULE_IDS)[number];

export function isHubAlertModule(id: string): id is HubAlertModuleId {
  return (HUB_ALERT_MODULE_IDS as readonly string[]).includes(id);
}

export function formatAnticipoSinOsAlert(count: number): HubModuleAlert {
  if (count <= 0) {
    return { text: 'Sin alertas', severity: 'ok' };
  }
  if (count === 1) {
    return {
      text: 'Falta una orden de servicio de un evento con anticipo',
      severity: 'warn',
    };
  }
  return {
    text: `Faltan ${count} órdenes de servicio de eventos con anticipo`,
    severity: 'warn',
  };
}

export function formatHrDocsMissingAlert(withMissing: number): HubModuleAlert {
  if (withMissing <= 0) {
    return { text: 'Sin alertas', severity: 'ok' };
  }
  if (withMissing === 1) {
    return {
      text: 'Falta documentación de personal (1 persona)',
      severity: 'warn',
    };
  }
  return {
    text: `Falta documentación de personal (${withMissing} personas)`,
    severity: 'warn',
  };
}

/** Prioriza docs faltantes; si no, primera alerta warn del tablero RR.HH. */
export function pickRrhhHubAlert(opts: {
  withMissing: number | null;
  summaryAlerts?: { severity: string; message: string }[] | null;
}): HubModuleAlert {
  if (opts.withMissing != null && opts.withMissing > 0) {
    return formatHrDocsMissingAlert(opts.withMissing);
  }
  const warn = (opts.summaryAlerts || []).find((a) => a.severity === 'warn');
  if (warn?.message) {
    return { text: warn.message, severity: 'warn' };
  }
  if (opts.withMissing === 0) {
    return { text: 'Sin alertas', severity: 'ok' };
  }
  return { text: 'Sin alertas', severity: 'ok' };
}

export function calmNoAlert(): HubModuleAlert {
  return { text: 'Sin alertas', severity: 'ok' };
}
