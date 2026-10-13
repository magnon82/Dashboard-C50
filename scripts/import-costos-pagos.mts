/**
 * Importa el costo vs pagos ejercidos (hoja GLOBAL) a Supabase.
 *
 *   npx tsx scripts/import-costos-pagos.mts
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
  process.env.GOOGLE_OAUTH_CLIENT_JSON = fs.readFileSync('ingestor/credentials.json', 'utf8');
}

const { syncCostosPagosFromSheets } = await import('../app/lib/costos-pagos');
const result = await syncCostosPagosFromSheets();
console.log('meses', result.meses.join(', '));
console.log('semanas', result.semanas);
