/**
 * Importa el costo por venta de las hojas de cocina y barra a Supabase.
 *
 *   npx tsx scripts/import-costos-venta.mts
 *
 * Lee Google solo en esta corrida. El tablero después usa la base.
 */
import fs from 'node:fs';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.GOOGLE_OAUTH_TOKEN_JSON && fs.existsSync('ingestor/token.json')) {
  process.env.GOOGLE_OAUTH_TOKEN_JSON = fs.readFileSync('ingestor/token.json', 'utf8');
}
if (
  !process.env.GOOGLE_OAUTH_CLIENT_JSON &&
  fs.existsSync('ingestor/credentials.json')
) {
  process.env.GOOGLE_OAUTH_CLIENT_JSON = fs.readFileSync(
    'ingestor/credentials.json',
    'utf8'
  );
}

const { syncCostosVentaFromSheets } = await import('../app/lib/costos-venta.ts');
const result = await syncCostosVentaFromSheets();
console.log('meses', result.meses.join(', '));
console.log('filas', result.filas);
