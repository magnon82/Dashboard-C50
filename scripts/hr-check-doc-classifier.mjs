/**
 * Verifica que constancia CURP / acta / INE no se cruzan por texto.
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-check-doc-classifier.mjs
 */
import { detectDocTypeFromText } from '../app/lib/hr-docs-pack-split.ts';

const cases = [
  {
    want: 'curp',
    name: 'constancia CURP (Gael)',
    text: `
ESTADOS UNIDOS MEXICANOS
CONSTANCIA DE LA CLAVE ÚNICA DE REGISTRO DE POBLACIÓN
CLAVE PEAG070507HMSRLLA4
NOMBRE GAEL PEREZ ALVAREZ
ENTIDAD DE REGISTRO MORELOS
GOBIERNO DE MÉXICO GOBERNACIÓN RENAPO
CURP Certificada: verificada con el Registro Civil.
`,
  },
  {
    want: 'acta_nacimiento',
    name: 'acta de nacimiento electrónica',
    text: `
ACTA DE NACIMIENTO
ESTADOS UNIDOS MEXICANOS
DATOS DE LA PERSONA REGISTRADA
DATOS DE FILIACION
IDENTIFICADOR ELECTRONICO 1234567890
NUMERO DE ACTA 123
OFICIALIA 1
MUNICIPIO DE REGISTRO CUERNAVACA
CURP PEAG070507HMSRLLA4
FECHA DE REGISTRO 08/05/2007
`,
  },
  {
    want: 'ine',
    name: 'credencial INE',
    text: `
INSTITUTO NACIONAL ELECTORAL
CREDENCIAL PARA VOTAR
CLAVE DE ELECTOR PRAGGA07050709H000
NOMBRE GAEL PEREZ ALVAREZ
`,
  },
];

let failed = 0;
for (const c of cases) {
  const got = detectDocTypeFromText(c.text);
  const ok = got === c.want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK' : 'FAIL'} ${c.name}: ${got} (esperado ${c.want})`);
}
if (failed) {
  process.exit(1);
}
console.log(`OK ${cases.length} casos`);
