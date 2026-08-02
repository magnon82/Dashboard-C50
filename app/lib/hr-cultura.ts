/**
 * Cultura organizacional C50 — contenido consultable en Biblioteca RH.
 * Editar aquí para actualizar textos mostrados en RrhhCulturaView.
 */

export type HrCulturaValorId =
  | 'honestidad'
  | 'calidad'
  | 'responsabilidad'
  | 'creatividad';

export type HrCulturaValor = {
  id: HrCulturaValorId;
  title: string;
  body: string;
  /** Acento visual (Suite-adaptado: teal / terracotta / amarillo / navy). */
  accent: 'teal' | 'terracotta' | 'amber' | 'navy';
};

export const HR_CULTURA_TITLE = 'Cultura de la Empresa';

export const HR_CULTURA_BRAND = 'Terraza Carranza 50';

export const HR_CULTURA_INTRO: string[] = [
  'Carranza 50 es una casona del siglo XVIII ubicada en el corazón del Centro Histórico de Querétaro. Hoy funciona como terraza y restaurante, conservando el carácter del edificio y ofreciendo cocina típica queretana.',
  'Abrió sus puertas el 31 de diciembre de 2014. Los socios fundadores son David, Juan, Cristopher y Sergio.',
];

export const HR_CULTURA_MISION = {
  title: 'Misión',
  body: 'Servir platillos típicos de Querétaro en un ambiente cálido y auténtico, ofreciendo a cada comensal una experiencia memorable.',
} as const;

export const HR_CULTURA_VISION = {
  title: 'Visión',
  body: 'Ser reconocidos por deleitar a nuestros clientes y por la formación y capacitación continua de nuestros colaboradores.',
} as const;

export const HR_CULTURA_VALORES: HrCulturaValor[] = [
  {
    id: 'honestidad',
    title: 'Honestidad',
    body: 'Actuamos con verdad y de forma honrada en todo lo que hacemos.',
    accent: 'navy',
  },
  {
    id: 'calidad',
    title: 'Calidad',
    body: 'Cocinamos y servimos con amor y tradición, cuidando cada detalle.',
    accent: 'terracotta',
  },
  {
    id: 'responsabilidad',
    title: 'Responsabilidad',
    body: 'Cumplimos nuestras tareas y objetivos con compromiso y puntualidad.',
    accent: 'teal',
  },
  {
    id: 'creatividad',
    title: 'Creatividad y eficiencia',
    body: 'Aprovechamos recursos e ideas para mejorar el servicio cada día.',
    accent: 'amber',
  },
];

/** Ruta local de la carpeta Cultura (Drive montado) — respaldo opcional. */
export const HR_CULTURA_FOLDER_PATH =
  'I:\\Mi unidad\\RH\\Cultura Organizacional';

/**
 * ¿Este ítem de Biblioteca debe abrir la consulta in-app de Cultura
 * en lugar de (o antes de) explorar carpeta / descargar?
 */
export function isHrCulturaConsultDoc(doc: {
  category?: string | null;
  title?: string | null;
  local_path?: string | null;
}): boolean {
  if (doc.category === 'cultura') return true;
  const title = (doc.title || '').toLowerCase();
  if (title.includes('cultura') || title.includes('misión') || title.includes('mision')) {
    return true;
  }
  const path = (doc.local_path || '').toLowerCase();
  return path.includes('cultura organizacional') || path.includes('misi');
}
