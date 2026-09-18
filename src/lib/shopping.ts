/**
 * Lógica pura de la lista de compras (Casa).
 *
 * Vive separada del router de tRPC y de los endpoints REST para poder testearla sin base de datos
 * y para que la app, la API externa y la UI compartan exactamente las mismas reglas de parseo y
 * deduplicación.
 */

export const MAX_SHOPPING_ITEM_NAME_LENGTH = 80;
export const MAX_SHOPPING_ITEM_QUANTITY_LENGTH = 40;
export const MAX_SHOPPING_ITEM_NOTE_LENGTH = 200;
export const MAX_SHOPPING_ITEMS_PER_BATCH = 50;

/** Viñetas y numeraciones típicas de un texto pegado desde notas o WhatsApp. */
const BULLET_PREFIX = /^\s*(?:[-*•‣·–—]+|\d+[.)])\s+/;
/** Puntuación de borde que no aporta al nombre del ítem. */
const EDGE_PUNCTUATION = /^[\s.,;:!¡¿?'"()[\]]+|[\s.,;:!¡¿?'"()[\]]+$/g;
const DIACRITICS = /[̀-ͯ]/g;
const WHITESPACE = /\s+/g;

/**
 * Deja el nombre como lo va a ver la persona: sin viñetas, sin puntuación de borde y con un solo
 * espacio entre palabras. Respeta mayúsculas y acentos tal como se escribieron.
 */
export const cleanShoppingItemName = (raw: string): string =>
  raw
    .replace(BULLET_PREFIX, '')
    .replace(WHITESPACE, ' ')
    .replace(EDGE_PUNCTUATION, '')
    .slice(0, MAX_SHOPPING_ITEM_NAME_LENGTH)
    .trim();

/**
 * Clave de comparación entre nombres: sin acentos, sin mayúsculas y sin espacios de más.
 * "Leche", "leche " y "LECHE" comparten clave; "leche descremada" no.
 */
export const normalizeShoppingItemName = (raw: string): string =>
  cleanShoppingItemName(raw).normalize('NFD').replace(DIACRITICS, '').toLowerCase();

export interface ParsedShoppingItem {
  name: string;
  /** Clave normalizada, para deduplicar contra lo que ya está en la lista. */
  key: string;
}

/**
 * Convierte un texto libre en varios ítems. Se corta por saltos de línea y por comas, así
 * "leche, pan, huevos" carga tres ítems de una. Deduplica dentro del mismo texto y recorta la
 * cantidad de ítems para que un pegado gigante no explote la lista.
 */
export const parseShoppingItems = (text: string): ParsedShoppingItem[] => {
  const seen = new Set<string>();
  const items: ParsedShoppingItem[] = [];

  for (const chunk of text.split(/[\n\r,]+/)) {
    const name = cleanShoppingItemName(chunk);

    if (!name) {
      continue;
    }

    const key = normalizeShoppingItemName(name);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push({ name, key });

    if (items.length >= MAX_SHOPPING_ITEMS_PER_BATCH) {
      break;
    }
  }

  return items;
};

/**
 * Busca un ítem existente que sea "el mismo" que el nombre dado. Se usa para no duplicar cuando
 * alguien agrega "leche" y ya hay una "Leche" pendiente.
 */
export const findShoppingItemByName = <T extends { name: string }>(
  items: T[],
  name: string,
): T | undefined => {
  const key = normalizeShoppingItemName(name);

  if (!key) {
    return undefined;
  }

  return items.find((item) => normalizeShoppingItemName(item.name) === key);
};

/** Recorta un campo de texto opcional y devuelve undefined si quedó vacío. */
export const cleanOptionalText = (
  raw: string | null | undefined,
  maxLength: number,
): string | undefined => {
  const value = raw?.replace(WHITESPACE, ' ').trim().slice(0, maxLength).trim();

  return value ? value : undefined;
};
