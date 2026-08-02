/**
 * Local dry-check for GCal DWD / impersonation.
 * Loads .env.local, lists calendar, creates+deletes a probe event.
 * Usage: node scripts/gcal-probe.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env.local');

function loadEnvLocal() {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function normalizePem(raw) {
  let v = String(raw ?? '').trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  const forMatch = v.includes('-----BEGIN') ? v : v.replace(/\\n/g, '\n');
  const m = forMatch.match(
    /-----BEGIN [A-Z0-9 ]+-----[\s\S]+?-----END [A-Z0-9 ]+-----/
  );
  if (m) {
    let pem = m[0];
    if (pem.includes('\\n')) pem = pem.replace(/\\n/g, '\n');
    return pem.replace(/\r\n/g, '\n').trim();
  }
  return v.replace(/\\n/g, '\n').trim();
}

loadEnvLocal();

const calendarId = process.env.GCAL_CALENDAR_ID?.trim() || '';
const clientEmail = process.env.GCAL_CLIENT_EMAIL?.trim() || '';
const privateKey = normalizePem(process.env.GCAL_PRIVATE_KEY);
const impersonate = process.env.GCAL_IMPERSONATE_USER?.trim() || '';
const scope = 'https://www.googleapis.com/auth/calendar';

if (!calendarId || !clientEmail || !privateKey) {
  console.error('Missing GCAL_CALENDAR_ID / GCAL_CLIENT_EMAIL / GCAL_PRIVATE_KEY');
  process.exit(1);
}

console.log('calendarId:', calendarId);
console.log('clientEmail:', clientEmail);
console.log('impersonate:', impersonate || '(none — DWD recommended)');

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: [scope],
  ...(impersonate ? { subject: impersonate } : {}),
});

const calendar = google.calendar({ version: 'v3', auth });

try {
  const meta = await calendar.calendars.get({ calendarId });
  console.log('calendar summary:', meta.data.summary || '(no summary)');

  const inserted = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: '[PROBE] dashboard-eventos — borrar',
      description: 'Sonda temporal; se elimina al instante.',
      start: { date: '2099-01-01', timeZone: 'America/Mexico_City' },
      end: { date: '2099-01-02', timeZone: 'America/Mexico_City' },
      status: 'tentative',
      transparency: 'transparent',
    },
  });

  const id = inserted.data.id;
  console.log('probe created:', id || '(no id)');
  if (id) {
    await calendar.events.delete({ calendarId, eventId: id });
    console.log('probe deleted: ok');
  }
  console.log('RESULT: OK');
} catch (err) {
  const msg =
    err?.response?.data?.error?.message ||
    err?.errors?.[0]?.message ||
    err?.message ||
    String(err);
  console.error('RESULT: FAIL');
  console.error(msg);
  if (!impersonate) {
    console.error(
      'Hint: set GCAL_IMPERSONATE_USER and authorize DWD in Admin Workspace.'
    );
  }
  process.exit(2);
}
