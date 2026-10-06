import { normalizeShoppingItemName } from '~/lib/shopping';

/**
 * Stock de la casa: reglas puras (sin base) compartidas por la app, la API externa y el puente con
 * Compras. Hay o no hay: no se llevan cantidades.
 */

/** Orden fijo en pantalla. Limpieza siempre al final. */
export const STOCK_SECTIONS = ['FRIDGE', 'FREEZER', 'PANTRY', 'PRODUCE', 'CLEANING'] as const;
export type StockSection = (typeof STOCK_SECTIONS)[number];

export const DEFAULT_STOCK_SECTION: StockSection = 'PANTRY';
export const MAX_STOCK_NOTE_LENGTH = 200;

export const isStockSection = (value: unknown): value is StockSection =>
  'string' === typeof value && (STOCK_SECTIONS as readonly string[]).includes(value);

/**
 * Raíz común del singular y el plural, suficiente para nombres de almacén. La clave nunca se
 * muestra, así que no hace falta que sea una palabra real: solo que "carne" y "carnes",
 * "postre" y "postres", "limón" y "limones", "nuez" y "nueces" den lo mismo. Las palabras de tres
 * letras o menos no se tocan ("gas", "te").
 */
const singularWord = (word: string): string => {
  if (word.length <= 3) {
    return word;
  }

  const stem = word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

  if (stem.endsWith('ce')) {
    return `${stem.slice(0, -2)}z`;
  }

  if (/[lnrdj]e$/.test(stem)) {
    return stem.slice(0, -1);
  }

  return stem;
};

/**
 * Clave de comparación de un producto: sin tildes, sin mayúsculas, un espacio entre palabras y
 * cada palabra en singular. "Tomates" y "tomate" comparten clave; "leche descremada" y "leche" no.
 */
export const stockKey = (name: string): string =>
  normalizeShoppingItemName(name).split(' ').filter(Boolean).map(singularWord).join(' ');

/** ¿`needleKey` aparece como palabras completas dentro de `haystackKey`? Ambas son claves. */
export const containsWords = (haystackKey: string, needleKey: string): boolean =>
  Boolean(needleKey) && ` ${haystackKey} `.includes(` ${needleKey} `);

/**
 * Productos comunes de la casa y dónde se guardan. Se busca por palabras dentro del nombre y gana
 * la coincidencia más larga ("leche de coco" le gana a "leche").
 */
const SECTION_WORDS: Record<StockSection, string[]> = {
  FRIDGE: [
    'leche',
    'yogur',
    'yogurt',
    'queso',
    'queso crema',
    'manteca',
    'crema',
    'crema de leche',
    'dulce de leche',
    'huevo',
    'jamon',
    'salame',
    'fiambre',
    'mortadela',
    'salchicha',
    'ricota',
    'muzzarella',
    'mozzarella',
    'tapa de empanada',
    'tapa de tarta',
    'masa de tarta',
    'pascualina',
    'ravioles',
    'noquis',
    'tofu',
    'hummus',
    'postre',
    'flan',
  ],
  FREEZER: [
    'pollo',
    'pechuga',
    'muslo',
    'carne',
    'carne picada',
    'milanesa',
    'bife',
    'asado',
    'vacio',
    'matambre',
    'cerdo',
    'bondiola',
    'solomillo',
    'pescado',
    'merluza',
    'salmon',
    'trucha',
    'langostino',
    'hamburguesa',
    'medallon',
    'nugget',
    'helado',
    'hielo',
    'congelado',
    'congelada',
    'papa frita',
  ],
  PANTRY: [
    'arroz',
    'fideo',
    'harina',
    'azucar',
    'sal',
    'aceite',
    'vinagre',
    'atun',
    'lenteja',
    'garbanzo',
    'poroto',
    'arveja',
    'pan',
    'pan rallado',
    'galletita',
    'cafe',
    'te',
    'yerba',
    'cacao',
    'avena',
    'quinoa',
    'polenta',
    'pure',
    'pure de tomate',
    'tomate triturado',
    'caldo',
    'oregano',
    'pimenton',
    'comino',
    'pimienta',
    'mermelada',
    'miel',
    'mani',
    'nuez',
    'almendra',
    'cereal',
    'leche en polvo',
    'leche de coco',
    'mostaza',
    'ketchup',
    'mayonesa',
    'salsa',
    'gaseosa',
    'agua',
    'vino',
    'cerveza',
    'jugo',
    'chocolate',
    'lata',
  ],
  PRODUCE: [
    'tomate',
    'lechuga',
    'palta',
    'cebolla',
    'papa',
    'batata',
    'boniato',
    'zanahoria',
    'zapallo',
    'zapallito',
    'berenjena',
    'morron',
    'pepino',
    'ajo',
    'puerro',
    'apio',
    'espinaca',
    'acelga',
    'rucula',
    'brocoli',
    'coliflor',
    'repollo',
    'remolacha',
    'choclo',
    'chaucha',
    'champinon',
    'hongo',
    'limon',
    'naranja',
    'mandarina',
    'manzana',
    'banana',
    'pera',
    'durazno',
    'frutilla',
    'uva',
    'kiwi',
    'anana',
    'pomelo',
    'mango',
    'perejil',
    'albahaca',
    'cilantro',
    'romero',
    'jengibre',
    'verdura',
    'fruta',
  ],
  CLEANING: [
    'detergente',
    'lavandina',
    'agua lavandina',
    'jabon',
    'jabon en polvo',
    'suavizante',
    'esponja',
    'rejilla',
    'trapo',
    'papel higienico',
    'rollo de cocina',
    'servilleta',
    'bolsa de residuo',
    'limpiador',
    'desengrasante',
    'shampoo',
    'acondicionador',
    'pasta dental',
    'cepillo de diente',
    'algodon',
    'panal',
    'toallita',
    'insecticida',
    'fosforo',
    'papel film',
    'papel aluminio',
    'alcohol',
    'guante',
  ],
};

const SECTION_ENTRIES: { key: string; words: number; section: StockSection }[] =
  STOCK_SECTIONS.flatMap((section) =>
    SECTION_WORDS[section].map((word) => {
      const key = stockKey(word);
      return { key, words: key.split(' ').length, section };
    }),
  );

/**
 * Dónde va un producto: primero lo que el grupo enseñó (corrigiendo a mano), después la lista de
 * arriba, y si no aparece, la alacena.
 */
export const guessStockSection = (
  name: string,
  learned?: ReadonlyMap<string, StockSection>,
): StockSection => {
  const key = stockKey(name);
  const taught = learned?.get(key);

  if (taught) {
    return taught;
  }

  let best: { section: StockSection; words: number; position: number } | undefined;

  // Primero lo más largo ("leche de coco" le gana a "leche"); a igual largo, lo que aparece antes
  // en el nombre, porque en español el sustantivo principal va primero ("caldo de pollo" es de
  // alacena, no de freezer).
  for (const entry of SECTION_ENTRIES.filter((candidate) => containsWords(key, candidate.key))) {
    const position = ` ${key} `.indexOf(` ${entry.key} `);

    if (
      !best ||
      entry.words > best.words ||
      (entry.words === best.words && position < best.position)
    ) {
      best = { section: entry.section, words: entry.words, position };
    }
  }

  return best?.section ?? DEFAULT_STOCK_SECTION;
};
