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

/** Cómo encontró la sincronización externa al ítem que va a actualizar. */
export type ShoppingUpsertMatchKind = 'externalId' | 'name';

export interface ShoppingUpsertExistingItem {
  name: string;
  externalId: string | null;
  /** Id de la persona que lo cargó desde la app, o null si lo trajo un sistema externo. */
  addedBy: number | null;
}

export interface ShoppingUpsertIncomingItem {
  name: string;
  externalId?: string | null;
}

/** Campos que la sincronización tiene permitido escribir. `undefined` = no tocar. */
export interface ShoppingUpsertFields {
  name?: string;
  externalId?: string;
}

/**
 * Decide qué puede pisar una sincronización externa al actualizar un ítem que ya existe.
 *
 * La regla de fondo es que el texto que escribió una persona es suyo:
 * - Match por nombre: nunca se renombra. Solo se puede adoptar un `externalId` si el ítem no
 *   tenía, para que la próxima sync lo encuentre por id en vez de por nombre.
 * - Match por `externalId`: la fuente externa es dueña del ítem y puede renombrarlo, salvo que
 *   tenga `addedBy` (lo creó una persona y después se le enganchó un id externo).
 */
export const resolveShoppingUpsertFields = (
  matchedBy: ShoppingUpsertMatchKind,
  existing: ShoppingUpsertExistingItem,
  incoming: ShoppingUpsertIncomingItem,
): ShoppingUpsertFields => {
  const fields: ShoppingUpsertFields = {};

  const name = cleanShoppingItemName(incoming.name);
  const ownedByExternalSource = 'externalId' === matchedBy && null === existing.addedBy;

  if (ownedByExternalSource && name && name !== existing.name) {
    fields.name = name;
  }

  if (incoming.externalId && !existing.externalId) {
    fields.externalId = incoming.externalId;
  }

  return fields;
};

/** Recorta un campo de texto opcional y devuelve undefined si quedó vacío. */
export const cleanOptionalText = (
  raw: string | null | undefined,
  maxLength: number,
): string | undefined => {
  const value = raw?.replace(WHITESPACE, ' ').trim().slice(0, maxLength).trim();

  return value ? value : undefined;
};
