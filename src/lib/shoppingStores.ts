import { SECTION_WORDS, STOCK_SECTIONS, bestWordMatch, stockKey, toWordEntries } from '~/lib/stock';

/**
 * Negocios de la lista de compras: la lista se agrupa por dónde se compra cada cosa. Reglas puras,
 * compartidas por la pantalla y los tests.
 */

/** Orden fijo en pantalla. */
export const SHOPPING_STORES = ['VERDULERIA', 'ALMACEN', 'CARNICERIA'] as const;
export type ShoppingStore = (typeof SHOPPING_STORES)[number];

/** Lo que no se reconoce va al almacén: es donde se compra casi todo. */
export const DEFAULT_SHOPPING_STORE: ShoppingStore = 'ALMACEN';

export const isShoppingStore = (value: unknown): value is ShoppingStore =>
  'string' === typeof value && (SHOPPING_STORES as readonly string[]).includes(value);

const CARNICERIA_WORDS = [
  'carne',
  'carne picada',
  'milanesa',
  'bife',
  'asado',
  'tapa de asado',
  'vacio',
  'matambre',
  'nalga',
  'peceto',
  'cuadril',
  'colita de cuadril',
  'lomo',
  'entrana',
  'osobuco',
  'falda',
  'roast beef',
  'paleta',
  'cerdo',
  'bondiola',
  'solomillo',
  'costilla',
  'costillita',
  'chorizo',
  'morcilla',
  'chinchulin',
  'molleja',
  'cordero',
  'pollo',
  'pechuga',
  'suprema',
  'muslo',
  'pata muslo',
  'ala',
  'pescado',
  'merluza',
  'salmon',
  'trucha',
  'langostino',
];

/**
 * Las palabras del Stock sirven de base: la verdura es de verdulería y el resto compite como
 * almacén, así "caldo de pollo" o "pure de tomate" quedan en el almacén y no en otro negocio.
 */
const STORE_WORDS: Record<ShoppingStore, string[]> = {
  VERDULERIA: SECTION_WORDS.PRODUCE,
  ALMACEN: STOCK_SECTIONS.filter((section) => 'PRODUCE' !== section).flatMap((section) =>
    SECTION_WORDS[section].filter((word) => !CARNICERIA_WORDS.includes(word)),
  ),
  CARNICERIA: CARNICERIA_WORDS,
};

const STORE_ENTRIES = toWordEntries(STORE_WORDS, SHOPPING_STORES);

/**
 * Dónde se compra un producto: primero lo que alguien eligió a mano para ese mismo nombre, después
 * las listas de arriba, y si no aparece, el almacén.
 */
export const guessShoppingStore = (
  name: string,
  learned?: ReadonlyMap<string, ShoppingStore>,
): ShoppingStore => {
  const key = stockKey(name);

  return learned?.get(key) ?? bestWordMatch(key, STORE_ENTRIES) ?? DEFAULT_SHOPPING_STORE;
};

/** Lo elegido a mano en la lista, por nombre, para que el mismo producto vuelva a su negocio. */
export const learnedShoppingStores = (
  items: readonly { name: string; store: ShoppingStore | null }[],
): Map<string, ShoppingStore> => {
  const learned = new Map<string, ShoppingStore>();

  for (const item of items) {
    if (item.store) {
      learned.set(stockKey(item.name), item.store);
    }
  }

  return learned;
};

/** Orden alfabético en castellano: sin distinguir mayúsculas ni tildes, y "2" antes que "10". */
const byName = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Agrupa por negocio, en el orden de `SHOPPING_STORES`, y adentro de cada uno por nombre. */
export const groupByShoppingStore = <T extends { name: string; store: ShoppingStore | null }>(
  items: readonly T[],
  learned?: ReadonlyMap<string, ShoppingStore>,
): { store: ShoppingStore; items: T[] }[] => {
  const groups = new Map<ShoppingStore, T[]>(SHOPPING_STORES.map((store) => [store, []]));

  for (const item of items) {
    groups.get(item.store ?? guessShoppingStore(item.name, learned))?.push(item);
  }

  return SHOPPING_STORES.map((store) => ({
    store,
    items: [...(groups.get(store) ?? [])].sort((a, b) => byName.compare(a.name, b.name)),
  })).filter((group) => 0 < group.items.length);
};
