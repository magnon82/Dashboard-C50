/** Bandeja / usuario Workspace operativo. */
export const DEFAULT_GMAIL_SOURCE_MAILBOX = 'admin@carranza50.com.mx';
const LEGACY_SERGIO_MAILBOX = 'sergio@carranza50.com.mx';

/** Si el valor sigue en Sergio, usa admin@. */
export function resolveWorkspaceMailbox(
  raw?: string | null,
  fallback = DEFAULT_GMAIL_SOURCE_MAILBOX
): string {
  const v = String(raw || '').trim();
  if (!v) return fallback;
  if (v.toLowerCase() === LEGACY_SERGIO_MAILBOX) return fallback;
  return v;
}

export function gmailSourceMailbox(): string {
  return resolveWorkspaceMailbox(process.env.GMAIL_SOURCE_MAILBOX).toLowerCase();
}

export function assertGmailSourceMailbox(email: string | null | undefined): string {
  const got = String(email || '').trim().toLowerCase();
  const wanted = gmailSourceMailbox();
  if (got !== wanted) {
    throw new Error(
      `Gmail OAuth está en ${got || '(desconocido)'}; el origen de correo debe ser ${wanted}.`
    );
  }
  return got;
}
