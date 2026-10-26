import { normalizeShoppingItemName } from '~/lib/shopping';

/**
 * Stock de la casa: reglas puras (sin base) compartidas por la app, la API externa y el puente con
 * Compras. Hay o no hay: no se llevan cantidades.
 */

/** Orden fijo en pantalla. Limpieza y Especias siempre al final. */
export const STOCK_SECTIONS = [
  'FRIDGE',
  'FREEZER',
  'PANTRY',
  'PRODUCE',
  'CLEANING',
  'SPICES',
] as const;
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
export const SECTION_WORDS: Record<StockSection, string[]> = {
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
  SPICES: [
    'sal',
    'sal gruesa',
    'pimienta',
    'oregano',
    'pimenton',
    'paprika',
    'comino',
    'provenzal',
    'aji molido',
    'canela',
    'nuez moscada',
    'curry',
    'curcuma',
    'laurel',
    'tomillo',
    'romero seco',
    'ajo en polvo',
    'cebolla en polvo',
    'clavo de olor',
    'cardamomo',
    'jengibre en polvo',
    'condimento',
    'especia',
    'chimichurri',
  ],
};

/** Una palabra conocida ya pasada a clave, con su cantidad de palabras y a qué grupo lleva. */
export interface WordEntry<T> {
  key: string;
  words: number;
  value: T;
}

export const toWordEntries = <T extends string>(lists: Record<T, string[]>, order: readonly T[]) =>
  order.flatMap((value) =>
    lists[value].map((word): WordEntry<T> => {
      const key = stockKey(word);
      return { key, words: key.split(' ').length, value };
    }),
  );

/**
 * La palabra conocida que mejor describe un nombre (ya pasado a clave). Primero lo más largo
 * ("leche de coco" le gana a "leche"); a igual largo, lo que aparece antes en el nombre, porque en
 * español el sustantivo principal va primero ("caldo de pollo" es de Alacena, no de freezer).
 */
export const bestWordMatch = <T>(key: string, entries: readonly WordEntry<T>[]): T | undefined => {
  let best: { value: T; words: number; position: number } | undefined;

  for (const entry of entries.filter((candidate) => containsWords(key, candidate.key))) {
    const position = ` ${key} `.indexOf(` ${entry.key} `);

    if (
      !best ||
      entry.words > best.words ||
      (entry.words === best.words && position < best.position)
    ) {
      best = { value: entry.value, words: entry.words, position };
    }
  }

  return best?.value;
};

const SECTION_ENTRIES = toWordEntries(SECTION_WORDS, STOCK_SECTIONS);

/**
 * Dónde va un producto: primero lo que el grupo enseñó (corrigiendo a mano), después la lista de
 * arriba, y si no aparece, la alacena.
 */
export const guessStockSection = (
  name: string,
  learned?: ReadonlyMap<string, StockSection>,
): StockSection => {
  const key = stockKey(name);

  return learned?.get(key) ?? bestWordMatch(key, SECTION_ENTRIES) ?? DEFAULT_STOCK_SECTION;
};

/** Productos cuyo nombre contiene `text` como palabras completas ("arroz" → "Arroz yamaní"). */
export const stockItemsMatching = <T extends { key: string }>(
  items: readonly T[],
  text: string,
): T[] => {
  const key = stockKey(text);

  return key ? items.filter((item) => containsWords(item.key, key)) : [];
};

/**
 * Un producto del Stock por cómo lo nombró alguien. Primero el mismo nombre ("tomates" es
 * "Tomate"); si no está, los que lo contienen ("pollo" → "Pechugas de pollo") quedan como
 * candidatos y no se elige ninguno: nada sale del Stock por una coincidencia a medias.
 */
export const matchStockName = <T extends { key: string }>(
  items: readonly T[],
  name: string,
): { exact: T | undefined; candidates: T[] } => {
  const key = stockKey(name);
  const exact = key ? items.find((item) => item.key === key) : undefined;

  return { exact, candidates: exact ? [] : stockItemsMatching(items, name) };
};
