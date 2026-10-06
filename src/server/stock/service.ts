import type { Prisma, PrismaClient, ShoppingItemSource } from '@prisma/client';

import { cleanOptionalText, cleanShoppingItemName } from '~/lib/shopping';
import { MAX_STOCK_NOTE_LENGTH, type StockSection, guessStockSection, stockKey } from '~/lib/stock';

/**
 * Acceso a datos del Stock. Recibe el cliente por parámetro para poder correr dentro de la misma
 * transacción que tilda un ítem de Compras (el puente) y para testearse sin base.
 */

export type StockDb = Pick<
  PrismaClient | Prisma.TransactionClient,
  'stockItem' | 'stockPlacement' | 'shoppingItem'
>;

export const STOCK_ITEM_SELECT = {
  id: true,
  name: true,
  note: true,
  section: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  addedByUser: { select: { id: true, name: true, email: true, image: true } },
} as const;

export type StockItemView = Prisma.StockItemGetPayload<{ select: typeof STOCK_ITEM_SELECT }>;

const WITH_KEY = { ...STOCK_ITEM_SELECT, key: true } as const;

/** Renombrar un producto al nombre de otro que ya está en el Stock. */
export class StockConflictError extends Error {
  constructor(readonly existing: StockItemView) {
    super('Already in stock');
    this.name = 'StockConflictError';
  }
}

const withoutKey = ({ key: _key, ...item }: StockItemView & { key: string }): StockItemView => item;

const loadLearned = async (db: StockDb, groupId: number) =>
  new Map(
    (
      await db.stockPlacement.findMany({ where: { groupId }, select: { key: true, section: true } })
    ).map((placement) => [placement.key, placement.section as StockSection]),
  );

/** Suma productos al Stock sin duplicar: lo que ya estaba vuelve en `duplicates`. */
export const addToStock = async (
  db: StockDb,
  input: {
    groupId: number;
    items: { name: string; note?: string | null }[];
    source: ShoppingItemSource;
    addedBy: number | null;
    fromShoppingItemId?: string | null;
  },
) => {
  const wanted = new Map<string, { name: string; note?: string }>();

  for (const raw of input.items) {
    const name = cleanShoppingItemName(raw.name);
    const key = stockKey(name);

    if (key && !wanted.has(key)) {
      wanted.set(key, { name, note: cleanOptionalText(raw.note, MAX_STOCK_NOTE_LENGTH) });
    }
  }

  const [learned, existing] = await Promise.all([
    loadLearned(db, input.groupId),
    db.stockItem.findMany({
      where: { groupId: input.groupId, key: { in: [...wanted.keys()] } },
      select: WITH_KEY,
    }),
  ]);
  const existingByKey = new Map(existing.map((item) => [item.key, item]));

  const missing = [...wanted].filter(([key]) => !existingByKey.has(key));

  if (missing.length) {
    /*
     * Sin capturar errores: una violación de unicidad aborta la transacción en Postgres (25P02) y
     * arrastraría el tilde de Compras. `skipDuplicates` (ON CONFLICT DO NOTHING) nunca aborta: si
     * otro pedido lo agregó en el medio (dos teléfonos a la vez), queda el suyo.
     */
    await db.stockItem.createMany({
      data: missing.map(([key, { name, note }]) => ({
        groupId: input.groupId,
        name,
        key,
        note: note ?? null,
        section: guessStockSection(name, learned),
        source: input.source,
        addedBy: input.addedBy,
        fromShoppingItemId: input.fromShoppingItemId ?? null,
      })),
      skipDuplicates: true,
    });
  }

  const current = missing.length
    ? await db.stockItem.findMany({
        where: { groupId: input.groupId, key: { in: [...wanted.keys()] } },
        select: WITH_KEY,
      })
    : existing;
  const currentByKey = new Map(current.map((item) => [item.key, item]));

  const created: StockItemView[] = [];
  const duplicates: StockItemView[] = [];

  for (const key of wanted.keys()) {
    const item = currentByKey.get(key);

    if (item) {
      (existingByKey.has(key) ? duplicates : created).push(withoutKey(item));
    }
  }

  return { created, duplicates };
};

/**
 * Puente: un ítem de Compras se tildó como comprado. Lo suma al Stock (si no estaba) anotando qué
 * compra lo trajo, para poder deshacerlo si el tilde fue un error.
 */
export const addBoughtToStock = async (
  db: StockDb,
  item: { id: string; groupId: number; name: string },
  source: ShoppingItemSource,
  addedBy: number | null,
) => {
  const { created, duplicates } = await addToStock(db, {
    groupId: item.groupId,
    items: [{ name: item.name }],
    source,
    addedBy,
    fromShoppingItemId: item.id,
  });

  if (created[0]) {
    return { item: created[0], created: true };
  }

  return duplicates[0] ? { item: duplicates[0], created: false } : null;
};

/**
 * Puente al revés: se destildó un ítem de Compras. Sale del Stock solo lo que trajo esa compra y
 * nadie editó después (editar borra `fromShoppingItemId`).
 */
export const undoBoughtFromStock = async (db: StockDb, shoppingItemId: string) =>
  (await db.stockItem.deleteMany({ where: { fromShoppingItemId: shoppingItemId } })).count;

/** Lo que se lee del ítem de Compras que se tilda o destilda (`select` de quien llama + id y nombre). */
type CheckableShoppingSelect = Prisma.ShoppingItemSelect & { id: true; name: true };

// TypeScript no resuelve el pago de un `select` genérico: `CheckableShoppingSelect` garantiza el nombre.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- el select siempre incluye `name`
const nameOf = (item: unknown) => (item as { name: string }).name;

/**
 * Tilda o destilda un ítem de Compras y mueve el Stock en consecuencia (el puente de las dos
 * puntas). Lo usan la app, la API externa de Compras y la del Stock, para que las tres hagan lo
 * mismo.
 *
 * El cambio de estado se decide en la propia escritura (`updateMany` condicional): si dos pedidos
 * llegan a la vez, solo uno ve el cambio real (`changed`) y solo ese toca el Stock; el otro no
 * puede meter dos veces la misma compra. Tildar suma al Stock (`stock`, null si ya estaba y no se
 * pudo anotar); destildar saca lo que trajo esta compra. Siempre devuelve el ítem leído con el
 * `select` pedido. `source` puede depender del ítem leído (la API de Compras usa el del propio
 * ítem). Corre en la transacción de quien llama: si el Stock falla, el tilde también se deshace.
 */
export const setShoppingItemChecked = async <S extends CheckableShoppingSelect>(
  db: StockDb,
  input: {
    id: string;
    groupId: number;
    checked: boolean;
    /** Quién tilda; null si fue un sistema externo. Al destildar no se guarda. */
    userId: number | null;
    source:
      | ShoppingItemSource
      | ((item: Prisma.ShoppingItemGetPayload<{ select: S }>) => ShoppingItemSource);
    select: S;
  },
) => {
  const { count } = await db.shoppingItem.updateMany({
    where: { id: input.id, groupId: input.groupId, checked: !input.checked },
    data: {
      checked: input.checked,
      checkedAt: input.checked ? new Date() : null,
      checkedBy: input.checked ? input.userId : null,
    },
  });
  const item = await db.shoppingItem.findUniqueOrThrow({
    where: { id: input.id },
    select: input.select,
  });

  if (0 === count) {
    return { item, changed: false, stock: null };
  }

  if (!input.checked) {
    await undoBoughtFromStock(db, input.id);

    return { item, changed: true, stock: null };
  }

  const source = 'function' === typeof input.source ? input.source(item) : input.source;
  const stock = await addBoughtToStock(
    db,
    { id: input.id, groupId: input.groupId, name: nameOf(item) },
    source,
    input.userId,
  );

  return { item, changed: true, stock };
};

const findInGroup = (db: StockDb, groupId: number, id: string) =>
  db.stockItem.findFirst({ where: { id, groupId }, select: WITH_KEY });

/**
 * Claves (ver `stockKey`) de lo que está pendiente en Compras. "Se acabó" y "Sumar lo que falta"
 * las usan para no anotar dos veces lo mismo ("tomates" pendiente cubre "tomate").
 */
export const loadPendingShoppingKeys = async (
  db: Pick<PrismaClient | Prisma.TransactionClient, 'shoppingItem'>,
  groupId: number,
) =>
  new Set(
    (
      await db.shoppingItem.findMany({
        where: { groupId, checked: false },
        select: { id: true, name: true },
      })
    ).map((entry) => stockKey(entry.name)),
  );

/**
 * Anota algo en Compras, salvo que ya haya uno igual pendiente ("tomates" pendiente cubre
 * "tomate"). Devuelve si lo anotó.
 */
export const addToShoppingUnlessPending = async (
  db: Pick<PrismaClient | Prisma.TransactionClient, 'shoppingItem'>,
  input: { groupId: number; name: string; userId: number | null; source: ShoppingItemSource },
) => {
  const alreadyPending = (await loadPendingShoppingKeys(db, input.groupId)).has(
    stockKey(input.name),
  );

  if (!alreadyPending) {
    await db.shoppingItem.create({
      data: {
        groupId: input.groupId,
        name: input.name,
        addedBy: input.userId,
        source: input.source,
      },
    });
  }

  return !alreadyPending;
};

/** "Se acabó": sale del Stock y va a Compras, salvo que ya esté pendiente ahí. */
export const finishStockItem = async (
  db: StockDb,
  input: { groupId: number; id: string; userId: number | null; source: ShoppingItemSource },
) => {
  const item = await findInGroup(db, input.groupId, input.id);

  if (!item) {
    return null;
  }

  // deleteMany, no delete: si otro "se acabó" lo sacó justo antes, no tira P2025 y no aborta el
  // lote; ya no está, así que se saltea.
  const { count } = await db.stockItem.deleteMany({
    where: { id: item.id, groupId: input.groupId },
  });

  if (0 === count) {
    return null;
  }

  const addedToShopping = await addToShoppingUnlessPending(db, {
    groupId: input.groupId,
    name: item.name,
    userId: input.userId,
    source: input.source,
  });

  return { item: withoutKey(item), addedToShopping };
};

/** Sacar sin comprar: solo sale del Stock. */
export const removeStockItem = async (db: StockDb, input: { groupId: number; id: string }) => {
  const item = await findInGroup(db, input.groupId, input.id);

  if (!item) {
    return null;
  }

  await db.stockItem.delete({ where: { id: item.id } });

  return withoutKey(item);
};

/**
 * Editar nombre, nota o sección. Cambiar la sección la deja aprendida para ese producto en el
 * grupo. Cualquier edición desengancha la compra de origen (ya no se deshace con un destilde).
 */
export const updateStockItem = async (
  db: StockDb,
  input: {
    groupId: number;
    id: string;
    name?: string;
    note?: string | null;
    section?: StockSection;
  },
) => {
  const item = await findInGroup(db, input.groupId, input.id);

  if (!item) {
    return null;
  }

  const name = undefined === input.name ? undefined : cleanShoppingItemName(input.name);

  if ('' === name) {
    throw new Error('Empty stock item name');
  }

  const key = name ? stockKey(name) : item.key;

  if (key !== item.key) {
    const other = await db.stockItem.findFirst({
      where: { groupId: input.groupId, key },
      select: WITH_KEY,
    });

    if (other) {
      throw new StockConflictError(withoutKey(other));
    }
  }

  if (input.section) {
    await db.stockPlacement.upsert({
      where: { groupId_key: { groupId: input.groupId, key } },
      create: { groupId: input.groupId, key, section: input.section },
      update: { section: input.section },
    });
  }

  const updated = await db.stockItem.update({
    where: { id: item.id },
    data: {
      name,
      key,
      note:
        undefined === input.note
          ? undefined
          : (cleanOptionalText(input.note, MAX_STOCK_NOTE_LENGTH) ?? null),
      section: input.section,
      fromShoppingItemId: null,
    },
    select: WITH_KEY,
  });

  return withoutKey(updated);
};
