import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function clean(value: string | undefined): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

export async function GET() {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const key = clean(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!url || !key) {
    return NextResponse.json(
      {
        error:
          'Faltan variables de Supabase. Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (o SUPABASE_SERVICE_ROLE_KEY) en Vercel → Settings → Environment Variables → Production.',
        debug: {
          hasUrl: Boolean(url),
          hasKey: Boolean(key),
        },
      },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key);
  const all: unknown[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('financial_records')
      .select('*')
      .order('date', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          debug: {
            urlHost: (() => {
              try {
                return new URL(url).host;
              } catch {
                return 'invalid-url';
              }
            })(),
            keyLength: key.length,
            keyStartsWithEyJ: key.startsWith('eyJ'),
            keyPrefix: key.slice(0, 8),
          },
        },
        { status: 500 }
      );
    }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({ records: all, count: all.length });
}
