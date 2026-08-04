/**
 * Upsert catálogo biblioteca RH (hr_doc_links) en Supabase producción.
 * Asegura drive_url para que Vercel nunca muestre "Solo metadatos".
 *
 *   node scripts/seed-hr-doc-links-online.mjs
 *
 * Requiere .env.local: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * Opcional: HR_DOCS_VIGENTE_DRIVE_FOLDER_ID, HR_PERFILES_DRIVE_FOLDER_ID, HR_EXAMENES_DRIVE_FOLDER_ID
 */
import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

loadEnv();

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const vigenteId = (process.env.HR_DOCS_VIGENTE_DRIVE_FOLDER_ID || '').trim();
const perfilesId = (process.env.HR_PERFILES_DRIVE_FOLDER_ID || '').trim();
const examenesId = (process.env.HR_EXAMENES_DRIVE_FOLDER_ID || '').trim();

function folderUrl(id) {
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}

const VIGENTE = 'I:\\Mi unidad\\RH\\Documentación vigente 2023';
const vigenteUrl = folderUrl(vigenteId);
const perfilesUrl = folderUrl(perfilesId);
const examenesUrl = folderUrl(examenesId);

const ROWS = [
  {
    category: 'cultura',
    title: 'Cultura organizacional',
    description: 'Misión, visión y valores C50 · consulta en la Suite',
    local_path: 'I:\\Mi unidad\\RH\\Cultura Organizacional',
    drive_url: vigenteUrl,
    sort_order: 10,
    active: true,
  },
  {
    category: 'cultura',
    title: 'Misión, Visión y Valores',
    description: 'Guía de cultura organizacional · misma consulta in-app',
    local_path: `${VIGENTE}\\Misión, Visión y Valores.docx`,
    drive_url: vigenteUrl,
    sort_order: 12,
    active: true,
  },
  {
    category: 'perfiles',
    title: 'Perfiles por posición',
    description: 'Perfiles, KPI y protocolos por puesto',
    local_path: 'I:\\Mi unidad\\RH\\Perfiles por posición',
    drive_url: perfilesUrl || vigenteUrl,
    sort_order: 20,
    active: true,
  },
  {
    category: 'examenes',
    title: 'Exámenes de piso',
    description: 'Exámenes y evaluaciones de piso',
    local_path: 'I:\\Mi unidad\\RH\\Exámenes piso',
    drive_url: examenesUrl || vigenteUrl,
    sort_order: 30,
    active: true,
  },
  {
    category: 'politicas',
    title: 'Manual de contratación y baja de personal',
    description: 'Proceso de alta y baja de colaboradores',
    local_path: `${VIGENTE}\\Manual de contratación y baja de personal.docx`,
    drive_url: vigenteUrl,
    sort_order: 45,
    active: true,
  },
  {
    category: 'politicas',
    title: 'Manual para postular vacantes',
    description: 'Guía para publicar y postular vacantes',
    local_path: `${VIGENTE}\\Manual para postular vacantes.docx`,
    drive_url: vigenteUrl,
    sort_order: 46,
    active: true,
  },
  {
    category: 'politicas',
    title: 'Documentación vigente',
    description: 'Carpeta: políticas, reglamentos, formatos y antigüedad',
    local_path: VIGENTE,
    drive_url: vigenteUrl,
    sort_order: 50,
    active: true,
  },
  {
    category: 'politicas',
    title: 'Política de vacaciones',
    description: 'Anticipación, tope de días y reglas de goce',
    local_path: `${VIGENTE}\\Política de vacaciones.docx`,
    drive_url: vigenteUrl,
    sort_order: 51,
    active: true,
  },
  {
    category: 'politicas',
    title: 'Política de puntualidad y asistencia',
    description: 'Asistencia, retardos y faltas',
    local_path: `${VIGENTE}\\Política de puntualidad y asistencia.docx`,
    drive_url: vigenteUrl,
    sort_order: 52,
    active: true,
  },
  {
    category: 'politicas',
    title: 'Reglamento Interior de Trabajo',
    description: 'RIT vigente C50',
    local_path: `${VIGENTE}\\Reglamento Interior de Trabajo.docx`,
    drive_url: vigenteUrl,
    sort_order: 53,
    active: true,
  },
  {
    category: 'politicas',
    title: 'Reglamento C50 No fumar',
    description: 'Espacios libres de humo',
    local_path: `${VIGENTE}\\Reglamento C50 NO  FUMAR.docx`,
    drive_url: vigenteUrl,
    sort_order: 54,
    active: true,
  },
];

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('Upsert hr_doc_links →', url.replace(/https?:\/\//, '').slice(0, 40));
  if (!vigenteUrl) {
    console.warn(
      'AVISO: HR_DOCS_VIGENTE_DRIVE_FOLDER_ID vacío — filas sin drive_url hasta configurar env en Vercel.'
    );
  }

  let upserted = 0;
  for (const row of ROWS) {
    const { data: existing, error: findErr } = await sb
      .from('hr_doc_links')
      .select('id, drive_url')
      .eq('category', row.category)
      .eq('title', row.title)
      .maybeSingle();

    if (findErr) {
      console.error('SELECT error', row.title, findErr.message);
      continue;
    }

    if (existing?.id) {
      const patch = {
        description: row.description,
        local_path: row.local_path,
        sort_order: row.sort_order,
        active: true,
        drive_url: row.drive_url || existing.drive_url || null,
      };
      const { error } = await sb.from('hr_doc_links').update(patch).eq('id', existing.id);
      if (error) console.error('UPDATE', row.title, error.message);
      else {
        upserted += 1;
        console.log('updated', row.title, patch.drive_url ? '· Drive OK' : '· sin Drive');
      }
    } else {
      const { error } = await sb.from('hr_doc_links').insert(row);
      if (error) console.error('INSERT', row.title, error.message);
      else {
        upserted += 1;
        console.log('inserted', row.title, row.drive_url ? '· Drive OK' : '· sin Drive');
      }
    }
  }

  // Renombrar títulos legacy
  await sb
    .from('hr_doc_links')
    .update({
      title: 'Documentación vigente',
      description: 'Carpeta: políticas, reglamentos, formatos y antigüedad',
      drive_url: vigenteUrl,
    })
    .eq('category', 'politicas')
    .in('title', ['Documentación vigente 2023', 'Documentación']);

  const { count } = await sb
    .from('hr_doc_links')
    .select('id', { count: 'exact', head: true })
    .eq('active', true);

  console.log(`Listo. Upserts: ${upserted}. Activos en DB: ${count ?? '?'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
