import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SeedRow = {
  company: string;
  contact?: string;
  email?: string;
  phone?: string;
};

/**
 * Importa clientes desde supabase/seed_event_clients.json
 * (exportados de lista de clientes Carranza 50.xlsx).
 * Idempotente por company_name (case-insensitive).
 */
export async function POST() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  try {
    const file = path.join(process.cwd(), 'supabase', 'seed_event_clients.json');
    const raw = await readFile(file, 'utf-8');
    const rows = JSON.parse(raw) as SeedRow[];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: 'Seed vacío' }, { status: 400 });
    }

    const sb = getServiceSupabase();
    const { data: existing, error: exErr } = await sb
      .from('event_clients')
      .select('company_name');
    if (exErr) {
      return NextResponse.json({ error: exErr.message }, { status: 500 });
    }

    const have = new Set(
      (existing || []).map((c) => String(c.company_name || '').trim().toLowerCase())
    );

    const now = new Date().toISOString();
    const toInsert = rows
      .filter((r) => r.company && !have.has(r.company.trim().toLowerCase()))
      .map((r) => ({
        company_name: r.company.trim(),
        contact_name: (r.contact || '').trim() || null,
        email: (r.email || '').trim() || null,
        phone: (r.phone || '').trim() || null,
        source: 'excel_seed',
        owner_username: auth.username,
        created_at: now,
        updated_at: now,
      }));

    let inserted = 0;
    const chunk = 80;
    for (let i = 0; i < toInsert.length; i += chunk) {
      const slice = toInsert.slice(i, i + chunk);
      const { error } = await sb.from('event_clients').insert(slice);
      if (error) {
        return NextResponse.json(
          { error: error.message, inserted },
          { status: 500 }
        );
      }
      inserted += slice.length;
    }

    return NextResponse.json({
      inserted,
      skipped: rows.length - toInsert.length,
      totalSeed: rows.length,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : 'Error al importar seed (¿corriste eventos_module.sql?)',
      },
      { status: 500 }
    );
  }
}
