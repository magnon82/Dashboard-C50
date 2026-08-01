/**
 * Contenido estructurado de políticas / contrato para consulta en UI
 * (extraído de Word en Drive; no descarga forzada).
 */

export type PoliticaListItem = {
  text: string;
  children?: string[];
};

export type PoliticaBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: PoliticaListItem[] }
  | { type: 'note'; text: string };

export type PoliticaSection = {
  id: string;
  title: string;
  blocks: PoliticaBlock[];
};

export type PoliticaDocId = 'politica-eventos-2025' | 'contrato-renta-terraza';

export type PoliticaDoc = {
  id: PoliticaDocId;
  title: string;
  subtitle?: string;
  sourceFilename: string;
  /** Ruta relativa típica bajo I:\Mi unidad\Eventos */
  sourceRelPath: string;
  extractedFrom: string;
  sections: PoliticaSection[];
};

const POLITICA_EVENTOS: PoliticaDoc = {
  id: 'politica-eventos-2025',
  title: 'Política de eventos',
  sourceFilename: 'Politica de eventos 2025.docx',
  sourceRelPath: 'Politica de eventos 2025.docx',
  extractedFrom: 'I:\\Mi unidad\\Eventos\\Politica de eventos 2025.docx',
  sections: [
    {
      id: 'definicion',
      title: 'Definición de grupo o evento',
      blocks: [
        {
          type: 'ul',
          items: [
            {
              text: 'Se considera grupo o evento a partir de 20 personas confirmadas.',
              children: ['Clientes WI se manda reserva regular.'],
            },
          ],
        },
      ],
    },
    {
      id: 'sala',
      title: 'Operación en sala',
      blocks: [
        {
          type: 'ul',
          items: [
            {
              text: 'Se prohíbe dar palabras con micrófono en horarios de operación regular del restaurante. En horarios fuera de operación, se evalúa y se autoriza por dirección.',
            },
            {
              text: 'Se permiten palabras a voz alzada antes de las 2:30 y con autorización de dirección. Se mantiene el nivel de música regular para WI.',
            },
            {
              text: 'Se prohíbe el uso de audiovisuales en horario de operación.',
            },
            {
              text: 'Se prohíbe la presencia de mariachis. Para eventos especiales como aniversarios o entregas de anillo, se considerará hasta 3 canciones únicamente. Se requiere VoBo de dirección sobre casos particulares.',
            },
            {
              text: 'Capacidad: 120 personas para comida o cena y 150 en modo cóctel, sin recibir reservaciones ni walk-ins de clientes regulares, cubriendo un cheque promedio en todos los casos de $600 por persona.',
            },
            {
              text: 'Música: nos apegamos a las listas de Spotify preseleccionadas, a menos que el evento sea exclusivo (renta de la terraza completa); en ese caso se atiende la preferencia del cliente a un nivel moderado, evitando molestias a los vecinos.',
            },
          ],
        },
      ],
    },
    {
      id: 'confirmacion',
      title: 'Confirmación y cocina',
      blocks: [
        {
          type: 'ul',
          items: [
            {
              text: 'Se confirman las condiciones del evento 48 hrs antes con dirección. En caso de reducción de invitados se aplican las penalidades generales de cancelación.',
            },
            {
              text: 'Gerencia da seguimiento con cocina con la orden de servicio confirmada al menos con 1 semana de anticipación.',
            },
          ],
        },
      ],
    },
    {
      id: 'pagos',
      title: 'Pagos y documentación',
      blocks: [
        {
          type: 'ul',
          items: [
            {
              text: 'Seguimiento puntual de pagos y registro en Drive de eventos.',
            },
            {
              text: 'Se mantiene al tanto a caja y dirección sobre cualquier incumplimiento en la política de pagos con base en la orden de servicio.',
            },
            {
              text: 'Se subirá al Drive la orden de servicio firmada por el cliente de todos los eventos en puerta.',
            },
          ],
        },
      ],
    },
    {
      id: 'reglamento',
      title: 'Reglamento',
      blocks: [
        {
          type: 'ul',
          items: [
            {
              text: 'Se entrega reglamento de no fumar a todos nuestros clientes de eventos para firma.',
            },
          ],
        },
      ],
    },
  ],
};

const CONTRATO_TERRAZA: PoliticaDoc = {
  id: 'contrato-renta-terraza',
  title: 'Contrato renta terraza',
  subtitle: 'Modelo de contrato de arrendamiento de salón para eventos sociales',
  sourceFilename: 'Contrato renta terraza C50.docx',
  sourceRelPath: 'Contratos/Contrato renta terraza C50.docx',
  extractedFrom:
    'I:\\Mi unidad\\Eventos\\Contratos\\Contrato renta terraza C50.docx',
  sections: [
    {
      id: 'proemio',
      title: 'Proemio',
      blocks: [
        {
          type: 'p',
          text: 'Contrato de arrendamiento de salón para eventos sociales, que celebran por una parte representada por “Carranza 50”, a quien en lo sucesivo se le denominará “El Arrendador”, y por la otra _____ a quien en lo sucesivo se le denominará “El Arrendatario”, al tenor del siguiente glosario, así como de las siguientes declaraciones y cláusulas.',
        },
      ],
    },
    {
      id: 'glosario',
      title: 'Glosario',
      blocks: [
        {
          type: 'p',
          text: 'Para fines del presente Contrato, se entenderá por:',
        },
        {
          type: 'ul',
          items: [
            {
              text: 'Arrendador. — Al proveedor que ofrece el uso y disfrute del salón para eventos sociales mediante el cobro de un precio cierto y determinado.',
            },
            {
              text: 'Arrendatario. — Al consumidor que adquiere el derecho de usar el salón para eventos sociales a cambio del pago de un precio cierto y determinado.',
            },
            {
              text: 'Reglamento. — Conjunto de normas que regulan los términos, condiciones, reglas de uso y comportamiento, que “El Arrendatario” y/o sus invitados se obligan a cumplir en el salón de “El Arrendador”.',
            },
            {
              text: 'Salón. — El bien inmueble destinado a la celebración de eventos sociales que el arrendador pone a disposición del arrendatario.',
            },
          ],
        },
      ],
    },
    {
      id: 'decl-arrendador',
      title: 'Declaraciones — El Arrendador',
      blocks: [
        {
          type: 'p',
          text: 'I. Declara “El Arrendador”:',
        },
        {
          type: 'ul',
          items: [
            {
              text: 'Ser una persona moral legalmente constituida conforme a las leyes mexicanas, que opera bajo el nombre “Carranza 50” con la razón social Cluster Culinario S. de R.L. de C.V.',
            },
            {
              text: 'Su domicilio se encuentra ubicado en Venustiano Carranza 50, Col. Centro, Querétaro, Qro., el cual señala como domicilio convencional para todos los efectos legales del presente Contrato.',
            },
            {
              text: 'Se encuentra inscrita en el Registro Federal de Contribuyentes con la clave CCU1403064S1.',
            },
            {
              text: 'Cuenta con la infraestructura, los elementos propios, los recursos técnicos y humanos suficientes para cumplir con sus obligaciones conforme a lo establecido en el presente Contrato.',
            },
            {
              text: 'Cumple con las licencias, permisos, avisos, certificados y autorizaciones previstas en las disposiciones legales y normas vigentes que corresponden.',
            },
            {
              text: 'Para la atención de dudas, aclaraciones, reclamaciones o para proporcionar servicios de orientación, señala el teléfono 442 499 0940 y el correo electrónico adriana@carranza50.com.mx.',
            },
            {
              text: 'Indicó a “El Arrendatario” el costo del arrendamiento del salón, así como las restricciones estipuladas en el Reglamento que forma parte integral del presente Contrato.',
            },
          ],
        },
      ],
    },
    {
      id: 'decl-arrendatario',
      title: 'Declaraciones — El Arrendatario',
      blocks: [
        {
          type: 'p',
          text: 'II. Declara “El Arrendatario”:',
        },
        {
          type: 'ul',
          items: [
            {
              text: 'Llamarse como ha quedado plasmado en el proemio de este Contrato.',
            },
            {
              text: 'Que es su deseo obligarse en los términos y condiciones del presente Contrato, manifestando que cuenta con la capacidad legal para la celebración de este Contrato.',
            },
            {
              text: 'Su domicilio se encuentra ubicado en la calle _______, número _____, Colonia _______, Delegación __________, Código Postal _______________, en ______________, ___________, el cual señala como domicilio convencional para todos los efectos legales del presente Contrato.',
            },
            {
              text: 'Se encuentra inscrito en el Registro Federal de Contribuyentes con la clave __________________.',
            },
          ],
        },
        {
          type: 'p',
          text: 'En virtud de las Declaraciones anteriores, “Las partes” convienen en obligarse conforme a las siguientes cláusulas.',
        },
      ],
    },
    {
      id: 'c1',
      title: 'Primera — Consentimiento de las partes',
      blocks: [
        {
          type: 'p',
          text: 'Las Partes de común acuerdo disponen de su voluntad para consentir que el objeto del presente Contrato es el arrendamiento del salón para eventos sociales; por lo que “El Arrendador” se obliga a arrendar el Salón a “El Arrendatario”; y éste, en consecuencia, se obliga a pagar como contraprestación un precio cierto y determinado.',
        },
      ],
    },
    {
      id: 'c2',
      title: 'Segunda — Objeto',
      blocks: [
        {
          type: 'p',
          text: 'El objeto del presente contrato es el arrendamiento del salón para eventos sociales que se encuentra ubicado en ______________________________ con una capacidad para ______ personas. Por lo que “El Arrendador” se obliga a conceder el uso y disfrute del Salón en la fecha acordada y “El Arrendatario” se obliga a pagar la cantidad estipulada en la Cláusula Tercera de este Contrato.',
        },
        {
          type: 'p',
          text: 'El Salón se usará para la realización del evento de ______________ y se rentará por _____ horas, iniciando a las _____ horas y terminará a las _____ horas, del día ____ mes ____ del año ________.',
        },
      ],
    },
    {
      id: 'c3',
      title: 'Tercera — Costo',
      blocks: [
        {
          type: 'p',
          text: 'El precio total que “El Arrendatario” se obliga a pagar por concepto de renta del Salón es de $ _______.___ (___________ Pesos ____/______ M.N.), más el Impuesto al Valor Agregado de $ _______._____ (_________________ Pesos ____/____ M.N.), sumando un total de $ _______.______ (___________ Pesos ___/____ M.N.).',
        },
        {
          type: 'p',
          text: 'En caso de que “El Arrendatario” requiera hacer uso del Salón por más tiempo del estipulado en la Cláusula Segunda, “El Arrendador” cobrará la cantidad adicional de $______ (_______________00/100 M.N.) por hora adicional.',
        },
        {
          type: 'note',
          text: 'El importe señalado contempla todas las cantidades y conceptos referentes al objeto del Contrato; “El Arrendador” se obliga a respetar dicho costo sin poder cobrar otra cantidad no estipulada.',
        },
      ],
    },
    {
      id: 'c4',
      title: 'Cuarta — Forma y lugar de pago',
      blocks: [
        {
          type: 'p',
          text: '“El Arrendatario” efectuará los pagos correspondientes a la renta del Salón en efectivo y en el domicilio de “El Arrendador” señalado en el presente Contrato, o en la forma de pago legal que Las Partes acuerden, en moneda nacional (sin menoscabo de poderlo hacer en moneda extranjera al tipo de cambio del DOF al día del pago), de la siguiente forma:',
        },
        {
          type: 'ul',
          items: [
            {
              text: 'La cantidad de $_____ (00/100 M.N.) a la firma del presente Contrato por concepto de anticipo que corresponde al _____ % del precio total del arrendamiento del Salón.',
            },
            {
              text: 'La cantidad restante de $_____ (00/100 M.N.) que corresponde al _____ % del precio total, se cubrirá el día que se lleve a cabo el evento.',
            },
          ],
        },
        {
          type: 'p',
          text: 'Por el pago del anticipo, “El Arrendador” deberá expedir el comprobante respectivo (nombre o razón social, fecha e importe, nombre y firma de quien recibe, sello, nombre del Arrendatario, fecha y hora del evento). Independientemente, deberá entregar la factura que ampare el pago del precio total, conforme a la legislación fiscal vigente.',
        },
      ],
    },
    {
      id: 'c5',
      title: 'Quinta — Obligaciones del Arrendatario',
      blocks: [
        {
          type: 'ul',
          items: [
            { text: 'Cumplir con lo establecido en el presente Contrato.' },
            {
              text: 'Hacer el pago correspondiente conforme a lo estipulado en las Cláusulas Tercera y Cuarta.',
            },
            {
              text: 'Hacer uso del Salón únicamente para lo establecido en el presente Contrato.',
            },
            {
              text: 'Respetar en todo momento las disposiciones del Reglamento entregado a la firma del Contrato.',
            },
          ],
        },
      ],
    },
    {
      id: 'c6',
      title: 'Sexta — Obligaciones del Arrendador',
      blocks: [
        {
          type: 'ul',
          items: [
            { text: 'Cumplir con lo establecido en este Contrato.' },
            {
              text: 'Proporcionar a “El Arrendatario” el uso y disfrute del Salón conforme a lo estipulado.',
            },
            { text: 'Tener en óptimo estado el Salón.' },
            {
              text: 'No hacer ningún cobro extraordinario ajeno al señalado en el presente Contrato.',
            },
          ],
        },
      ],
    },
    {
      id: 'c7',
      title: 'Séptima — Gastos de reparación',
      blocks: [
        {
          type: 'p',
          text: 'En caso de que el Salón sufriere un menoscabo por culpa o negligencia debidamente comprobada de “El Arrendatario” o de sus invitados, éste se obliga a cubrir los gastos de reparación dentro de los 10 (diez) días naturales siguientes. El costo dependerá del estado actual y desgaste habitual del Salón, así como del valor del bien dañado fehacientemente comprobable por “El Arrendador”.',
        },
      ],
    },
    {
      id: 'c8',
      title: 'Octava — Recepción de invitados',
      blocks: [
        {
          type: 'p',
          text: 'El procedimiento de control y verificación del número de personas que asisten al evento se efectuará por medio de la recepción de invitados de la forma que acuerden las partes. Si “El Arrendador” designa personal para la recepción y dicha designación tuviera un costo, deberá hacerlo del conocimiento de “El Arrendatario” para incluirlo si así se requiere.',
        },
      ],
    },
    {
      id: 'c9',
      title: 'Novena — Guardarropa',
      blocks: [
        {
          type: 'p',
          text: 'Si el salón cuenta con servicio de guardarropa, “El Arrendador” guardará las prendas entregando contraseña a cada invitado, y las devolverá al recibirla. Mantendrá hasta por 30 días naturales las prendas olvidadas al concluir el evento; transcurrido ese plazo se constituirá como acreedor prendario conforme a la legislación correspondiente.',
        },
      ],
    },
    {
      id: 'c10',
      title: 'Décima — Reglamento',
      blocks: [
        {
          type: 'p',
          text: 'A la firma del Contrato, “El Arrendador” entrega a “El Arrendatario” copia del Reglamento del inmueble, el cual forma parte del presente Contrato. “El Arrendatario” se obliga a cumplir las disposiciones reglamentarias y a procurar que los asistentes observen la misma conducta.',
        },
      ],
    },
    {
      id: 'c11',
      title: 'Décima primera — Designación de personal',
      blocks: [
        {
          type: 'p',
          text: '“El Arrendatario” deberá designar a una persona de su confianza que, durante el evento, trate los asuntos relacionados con el arrendamiento; asimismo se obliga a abstenerse de dar instrucciones al personal de “El Arrendador” ajenas al objeto del Contrato, y a procurar que sus invitados observen la misma conducta.',
        },
        {
          type: 'p',
          text: '“El Arrendador” designará, de entre su personal, a quien trate con el representante del Arrendatario los asuntos del arrendamiento, y se obliga a que su personal atienda con esmero y cortesía a los invitados.',
        },
      ],
    },
    {
      id: 'c12',
      title: 'Décima segunda — Cancelación',
      blocks: [
        {
          type: 'p',
          text: '“El Arrendatario” cuenta con un plazo de 5 (cinco) días hábiles posteriores a la firma para cancelar sin responsabilidad ni penalización; en cuyo caso “El Arrendador” reintegrará todas las cantidades entregadas en un plazo de 5 (cinco) días naturales posteriores a la solicitud.',
        },
        {
          type: 'p',
          text: 'Transcurridos esos 5 días hábiles, si alguna de las Partes cancela:',
        },
        {
          type: 'ul',
          items: [
            {
              text: '10% del monto total si la cancelación se solicita de 90 a 61 días naturales antes del evento.',
            },
            {
              text: '25% del monto total si se solicita de 60 a 31 días naturales antes del evento.',
            },
            {
              text: '50% del monto total si se solicita de 30 a 16 días naturales antes del evento.',
            },
            {
              text: '100% del monto total si se solicita de 15 a 0 días naturales antes del evento.',
            },
          ],
        },
        {
          type: 'p',
          text: 'Si cancela “El Arrendatario”, “El Arrendador” reintegrará lo que resulte después del cobro de la pena convencional. La cancelación deberá hacerse por escrito en el domicilio del Arrendador, o por correo registrado o certificado, tomando como fecha de revocación la de recepción para su envío.',
        },
      ],
    },
    {
      id: 'c13',
      title: 'Décima tercera — Causales de rescisión',
      blocks: [
        {
          type: 'p',
          text: 'Son causas de rescisión del presente Contrato:',
        },
        {
          type: 'ul',
          items: [
            {
              text: 'Incumplimiento de lo estipulado por alguna de las Partes.',
            },
            {
              text: 'Si “El Arrendador” no otorgara o permitiera el uso del salón en los términos pactados.',
            },
            {
              text: 'Si “El Arrendador” tiene conocimiento de que en el evento se realizarán actividades que atenten contra la ley, la moral y las buenas costumbres.',
            },
            {
              text: 'Por falta de pago de “El Arrendatario” en los términos previstos.',
            },
          ],
        },
        {
          type: 'p',
          text: 'Quien motive la rescisión de forma comprobada pagará a la otra parte como pena convencional el 10% (diez por ciento) del precio total. Si la rescisión fue ocasionada por “El Arrendador”, además deberá devolver todas las cantidades entregadas en un plazo no mayor a 5 (cinco) días naturales.',
        },
      ],
    },
    {
      id: 'c14',
      title: 'Décima cuarta — Caso fortuito y fuerza mayor',
      blocks: [
        {
          type: 'p',
          text: 'Si “El Arrendador” se encuentra imposibilitado para otorgar el Salón por caso fortuito o fuerza mayor (incendio, temblor u otros acontecimientos de la naturaleza o hechos del hombre ajenos a su voluntad), no se considerará incumplimiento, pero deberá reintegrar a “El Arrendatario” las cantidades que le hubiera entregado.',
        },
      ],
    },
    {
      id: 'c15',
      title: 'Décima quinta — Quejas y reclamaciones',
      blocks: [
        {
          type: 'p',
          text: '“El Arrendatario” podrá interponer una queja o reclamación acudiendo al domicilio señalado en las Declaraciones de “El Arrendador” o por vía telefónica al número ________________. “El Arrendador” deberá atenderla en un lapso no mayor de 48 (cuarenta y ocho) horas contadas a partir de que la queja haya sido recibida.',
        },
      ],
    },
    {
      id: 'c16',
      title: 'Décima sexta — Aviso de privacidad',
      blocks: [
        {
          type: 'p',
          text: 'Previo a la firma y en cumplimiento de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares, “El Arrendador” hizo del conocimiento de “El Arrendatario” el aviso de privacidad, así como del procedimiento para ejercer los derechos ARCO (acceso, rectificación, cancelación y oposición).',
        },
      ],
    },
    {
      id: 'c17',
      title: 'Décima séptima — Competencia',
      blocks: [
        {
          type: 'p',
          text: 'La Procuraduría Federal del Consumidor es competente en la vía administrativa para resolver cualquier controversia sobre la interpretación o cumplimiento del Contrato. Sin perjuicio de lo anterior, las Partes se someten a la jurisdicción de los Tribunales competentes en _________, renunciando expresamente a cualquier otra jurisdicción.',
        },
        {
          type: 'p',
          text: 'Leído que fue por las partes el contenido del presente Contrato y sabedoras de su alcance legal, lo firman por duplicado en la Ciudad de ________ a los __________ días del mes de _____ del año _____.',
        },
        {
          type: 'note',
          text: 'Este contrato fue aprobado y registrado por la Procuraduría Federal del Consumidor. Cualquier variación en perjuicio de “El Arrendatario” frente al contrato de adhesión registrado se tendrá por no puesta.',
        },
        {
          type: 'p',
          text: 'Autorización para uso mercadotécnico o publicitario: “El Arrendatario” sí ( ) / no ( ) acepta que “El Arrendador” ceda o transmita a terceros, con fines mercadotécnicos o publicitarios, la información proporcionada con motivo del Contrato; y sí ( ) / no ( ) acepta recibir publicidad sobre bienes y servicios.',
        },
      ],
    },
  ],
};

export const POLITICA_DOCS: Record<PoliticaDocId, PoliticaDoc> = {
  'politica-eventos-2025': POLITICA_EVENTOS,
  'contrato-renta-terraza': CONTRATO_TERRAZA,
};

export const POLITICA_DOC_LIST: PoliticaDoc[] = [
  POLITICA_EVENTOS,
  CONTRATO_TERRAZA,
];

/** Normaliza stem de archivo (misma lógica que biblioteca). */
function normalizeStem(filenameOrStem: string): string {
  const base = filenameOrStem.replace(/\.[^.\\/]+$/, '');
  return base
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const STEM_TO_DOC: Record<string, PoliticaDocId> = {
  'politica de eventos 2025': 'politica-eventos-2025',
  'contrato renta terraza c50': 'contrato-renta-terraza',
};

/**
 * Si el documento de biblioteca tiene vista in-app (modal),
 * devuelve el id del contenido estructurado.
 */
export function resolvePoliticaDocId(opts: {
  filename?: string;
  name?: string;
  category?: string;
}): PoliticaDocId | null {
  const hay = [opts.filename, opts.name].filter(Boolean).join(' ');
  const stem = normalizeStem(opts.filename || opts.name || '');
  if (STEM_TO_DOC[stem]) return STEM_TO_DOC[stem];

  // Fallback por título amigable / categoría Políticas
  if (/politica de eventos/i.test(hay)) return 'politica-eventos-2025';
  if (/contrato renta terraza/i.test(hay)) return 'contrato-renta-terraza';

  if (opts.category === 'politicas') {
    if (/politica|pol[ií]tica/i.test(hay)) return 'politica-eventos-2025';
    if (/contrato|terraza/i.test(hay)) return 'contrato-renta-terraza';
  }

  return null;
}

export function getPoliticaDoc(id: PoliticaDocId): PoliticaDoc {
  return POLITICA_DOCS[id];
}

export function hasInAppPoliticaView(opts: {
  filename?: string;
  name?: string;
  category?: string;
}): boolean {
  return resolvePoliticaDocId(opts) != null;
}
