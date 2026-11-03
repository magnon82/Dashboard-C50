/**
 * Verifica el snapshot de recetario antes de publicar fichas.
 * Uso: node scripts/_verify_recetario_fichas.mjs
 */
import { readFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync('data/recetario/snapshot.json', 'utf8'));
const menu = snap.menu || [];
const expectedCocina = [
  'Corte',
  'Ensalada',
  'Entrada',
  'Fuerte',
  'Guarnición',
  'Mole',
  'Postre',
  'Sopa y pasta',
];

const fields = [
  'nombre',
  'version',
  'descripcion',
  'categoria',
  'observaciones',
  'tipoCocina',
  'tiempoCiclo',
  'alergenos',
  'presentacion',
  'equipo',
  'acompanamientos',
  'historia',
];

const errors = [];
if (menu.length !== 226) errors.push(`menu tiene ${menu.length}, se esperaban 226`);

const empty = Object.fromEntries([...fields, 'procesos'].map((k) => [k, 0]));
for (const item of menu) {
  for (const key of fields) {
    if (!String(item.ficha?.[key] || '').trim()) empty[key] += 1;
  }
  if (!String(item.ficha?.procesos || '').trim()) empty.procesos += 1;
}

for (const key of fields) {
  if (empty[key] > 0) errors.push(`${empty[key]} fichas con ${key} vacío`);
}

const cocinaCats = [...new Set(menu.filter((m) => m.area === 'cocina').map((m) => m.category))].sort();
if (JSON.stringify(cocinaCats) !== JSON.stringify(expectedCocina)) {
  errors.push(`categorías cocina = ${cocinaCats.join(' | ')}`);
}

const emptyProc = menu.filter((m) => !String(m.ficha?.procesos || '').trim());
const emptyProcWithoutRecipe = emptyProc.filter((m) => !m.recipeId);
if (emptyProcWithoutRecipe.length) {
  errors.push(`${emptyProcWithoutRecipe.length} sin procesos y sin recipeId`);
}

console.log(
  JSON.stringify(
    {
      menu: menu.length,
      emptyProcesos: empty.procesos,
      emptyProcesosConReceta: emptyProc.filter((m) => m.recipeId).length,
      cocinaCats,
      ok: errors.length === 0,
      errors,
    },
    null,
    2
  )
);
if (errors.length) process.exit(1);
