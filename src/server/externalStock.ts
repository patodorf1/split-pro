import { ExternalApiError, isUuid, resolveOptionalMemberId } from '~/lib/externalExpense';
import {
  type ExternalStockAdd,
  type ExternalStockAddItem,
  type ExternalStockFinish,
  type ExternalStockPatch,
  STOCK_SECTION_LABELS,
  type StockAddOutcome,
  type StockFinishOutcome,
  groupStockBySection,
  stockAddText,
  stockFinishText,
  stockListText,
} from '~/lib/externalStock';
import { cleanOptionalText } from '~/lib/shopping';
import { MAX_STOCK_NOTE_LENGTH, matchStockName, stockItemsMatching, stockKey } from '~/lib/stock';
import { isRecordNotFound, isUniqueViolation } from '~/server/api/prismaErrors';
import { db } from '~/server/db';
import { type LoadedGroup, assertGroupWritable } from '~/server/externalExpenses';
import {
  STOCK_ITEM_SELECT,
  StockConflictError,
  type StockDb,
  type StockItemView,
  addToShoppingUnlessPending,
  addToStock,
  finishStockItem,
  removeStockItem,
  setShoppingItemChecked,
  updateStockItem,
} from '~/server/stock/service';

/**
 * Lógica con base de la API externa del Stock (Charly). Todo pasa por el servicio de la app
 * (`src/server/stock/service.ts`): mismas reglas de nombres, mismo puente con Compras, misma
 * sección aprendida. Mismo supuesto que gastos y Agenda: la clave es de la familia, pero `addedBy`
 * tiene que ser miembro del grupo de la URL.
 */

export const serializeStockItem = (item: StockItemView) => ({
  id: item.id,
  name: item.name,
  note: item.note,
  section: item.section.toLowerCase(),
  sectionLabel: STOCK_SECTION_LABELS[item.section],
  source: item.source.toLowerCase(),
  addedBy: item.addedByUser
    ? { id: item.addedByUser.id, name: item.addedByUser.name, email: item.addedByUser.email }
    : null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

const stockItemNotFound = () =>
  new ExternalApiError(
    404,
    'stock_item_not_found',
    'Ese producto no está en el Stock de este grupo',
    'Stock item not found in this group',
  );

/** Id de la URL; si no es un uuid, es como si no existiera. */
export const parseStockItemId = (raw: string | undefined): string => {
  if (!isUuid(raw)) {
    throw stockItemNotFound();
  }

  return raw;
};

/** Renombrar al nombre de otro (chequeo previo o choque en el índice) y "ya no existe". */
const mapStockError = (error: unknown) => {
  if (error instanceof StockConflictError || isUniqueViolation(error)) {
    return new ExternalApiError(
      409,
      'already_in_stock',
      'Ya hay un producto con ese nombre en el Stock',
      'There is already a product with that name in the stock',
      'name',
    );
  }

  if (isRecordNotFound(error)) {
    return stockItemNotFound();
  }

  return error;
};

/** Lo que hay, por sección (o lo que contiene `q`). */
export const listExternalStock = async (group: LoadedGroup, query: { q: string | null }) => {
  const items = await db.stockItem.findMany({
    where: { groupId: group.id },
    select: { ...STOCK_ITEM_SELECT, key: true },
  });
  const found = query.q ? stockItemsMatching(items, query.q) : items;
  const sections = groupStockBySection(found);

  return {
    groupId: group.id,
    q: query.q,
    total: found.length,
    sections: sections.map((section) => ({
      section: section.section.toLowerCase(),
      label: section.label,
      items: section.items.map(serializeStockItem),
    })),
    text: stockListText(sections, query.q),
  };
};

/** Pendientes de Compras por clave; si hay dos iguales, el más viejo. */
const loadPendingByKey = async (tx: StockDb, groupId: number) => {
  const pending = await tx.shoppingItem.findMany({
    where: { groupId, checked: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  const byKey = new Map<string, { id: string; name: string }>();

  for (const entry of pending) {
    const key = stockKey(entry.name);

    if (key && !byKey.has(key)) {
      byKey.set(key, entry);
    }
  }

  return byKey;
};

/**
 * Tilda como comprado un pendiente de Compras y lo pasa al Stock por el puente, igual que si lo
 * tildara alguien en la app (misma función: `setShoppingItemChecked`). Si otro lo tildó en el
 * medio, devuelve null y se suma como cualquier otro (el Stock no duplica).
 */
const markBought = async (
  tx: StockDb,
  groupId: number,
  pending: { id: string },
  userId: number | null,
) => {
  const { changed, stock } = await setShoppingItemChecked(tx, {
    id: pending.id,
    groupId,
    checked: true,
    userId,
    source: 'API',
    select: { id: true, name: true },
  });

  return changed ? stock : null;
};

interface AddResult extends Omit<StockAddOutcome, 'name' | 'section'> {
  item: StockItemView;
}

/** Sección y nota pedidas que difieren de lo guardado (vale también para lo que ya estaba). */
const pendingChanges = (entry: ExternalStockAddItem, item: StockItemView) => {
  const changes: { section?: ExternalStockAddItem['section']; note?: string | null } = {};

  if (entry.section && entry.section !== item.section) {
    changes.section = entry.section;
  }
  if (
    undefined !== entry.note &&
    (cleanOptionalText(entry.note, MAX_STOCK_NOTE_LENGTH) ?? null) !== item.note
  ) {
    changes.note = entry.note;
  }

  return 0 < Object.keys(changes).length ? changes : null;
};

/**
 * "Compré pollo, arroz y tomates": lo que estaba pendiente en Compras se tilda (y el puente lo
 * pasa al Stock); el resto entra directo. Nada se duplica. Todo en una transacción: o queda todo
 * o nada.
 */
export const addExternalStock = async (group: LoadedGroup, input: ExternalStockAdd) => {
  assertGroupWritable(group);
  const userId = resolveOptionalMemberId(input.addedBy, group.members, 'addedBy');

  try {
    const results = await db.$transaction(async (tx) => {
      const pendingByKey = await loadPendingByKey(tx, group.id);
      const byKey = new Map<string, AddResult>();
      const direct: ExternalStockAddItem[] = [];

      for (const entry of input.items) {
        const pending = pendingByKey.get(entry.key);
        const bought = pending ? await markBought(tx, group.id, pending, userId) : null;

        if (bought) {
          byKey.set(entry.key, {
            item: bought.item,
            status: bought.created ? 'added' : 'already',
            fromShopping: true,
          });
        } else {
          direct.push(entry);
        }
      }

      if (0 < direct.length) {
        const { created, duplicates } = await addToStock(tx, {
          groupId: group.id,
          items: direct.map((entry) => ({ name: entry.name, note: entry.note })),
          source: 'API',
          addedBy: userId,
        });

        for (const item of created) {
          byKey.set(stockKey(item.name), { item, status: 'added', fromShopping: false });
        }
        for (const item of duplicates) {
          byKey.set(stockKey(item.name), { item, status: 'already', fromShopping: false });
        }
      }

      // En el orden del pedido; la sección pedida queda aprendida (como al corregirla en la app).
      const ordered: AddResult[] = [];

      for (const entry of input.items) {
        const result = byKey.get(entry.key);

        if (!result) {
          continue;
        }

        const changes = pendingChanges(entry, result.item);
        const item = changes
          ? ((await updateStockItem(tx, { groupId: group.id, id: result.item.id, ...changes })) ??
            result.item)
          : result.item;

        ordered.push({ ...result, item });
      }

      return ordered;
    });

    return {
      groupId: group.id,
      items: results.map((result) => ({
        ...serializeStockItem(result.item),
        status: result.status,
        fromShopping: result.fromShopping,
      })),
      text: stockAddText(
        results.map((result) => ({
          name: result.item.name,
          section: result.item.section,
          status: result.status,
          fromShopping: result.fromShopping,
        })),
      ),
    };
  } catch (error) {
    throw mapStockError(error);
  }
};

/**
 * "Se terminó la leche": sale del Stock y va a Compras (si ya está pendiente ahí, no se repite).
 * Si no estaba en el Stock, igual va a Compras: el que avisa que se acabó quiere comprarlo. Un
 * nombre que solo coincide a medias ("pollo" con "Pechugas de pollo") no toca nada: vuelve con
 * los candidatos para que se elija.
 */
export const finishExternalStock = async (group: LoadedGroup, input: ExternalStockFinish) => {
  assertGroupWritable(group);
  const userId = resolveOptionalMemberId(input.addedBy, group.members, 'addedBy');

  try {
    const outcomes = await db.$transaction(async (tx) => {
      let stock = await tx.stockItem.findMany({
        where: { groupId: group.id },
        select: { id: true, name: true, key: true },
      });
      const results: (StockFinishOutcome & { item?: ReturnType<typeof serializeStockItem> })[] = [];

      for (const name of input.items) {
        const { exact, candidates } = matchStockName(stock, name);

        if (exact) {
          stock = stock.filter((item) => item.id !== exact.id);
          const finished = await finishStockItem(tx, {
            groupId: group.id,
            id: exact.id,
            userId,
            source: 'API',
          });

          if (finished) {
            results.push({
              name: finished.item.name,
              status: 'finished',
              addedToShopping: finished.addedToShopping,
              item: serializeStockItem(finished.item),
            });
            continue;
          }
        }

        if (0 < candidates.length) {
          results.push({
            name,
            status: 'candidates',
            candidates: candidates.map((item) => item.name),
          });
          continue;
        }

        const addedToShopping = await addToShoppingUnlessPending(tx, {
          groupId: group.id,
          name,
          userId,
          source: 'API',
        });
        results.push({ name, status: 'not_in_stock', addedToShopping });
      }

      return results;
    });

    return { groupId: group.id, items: outcomes, text: stockFinishText(outcomes) };
  } catch (error) {
    throw mapStockError(error);
  }
};

/** Cambiar nombre, nota o sección. La sección cambiada queda aprendida para ese producto. */
export const updateExternalStockItem = async (
  group: LoadedGroup,
  id: string,
  patch: ExternalStockPatch,
) => {
  assertGroupWritable(group);

  try {
    const item = await db.$transaction((tx) =>
      updateStockItem(tx, { groupId: group.id, id, ...patch }),
    );

    if (!item) {
      throw stockItemNotFound();
    }

    return serializeStockItem(item);
  } catch (error) {
    throw mapStockError(error);
  }
};

/** Sacar sin comprar: sale del Stock y no va a Compras. */
export const removeExternalStockItem = async (group: LoadedGroup, id: string) => {
  assertGroupWritable(group);

  try {
    const item = await removeStockItem(db, { groupId: group.id, id });

    if (!item) {
      throw stockItemNotFound();
    }

    return serializeStockItem(item);
  } catch (error) {
    throw mapStockError(error);
  }
};
