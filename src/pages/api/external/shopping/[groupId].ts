import { type Prisma, type ShoppingItemSource } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import {
  MAX_SHOPPING_ITEM_NAME_LENGTH,
  MAX_SHOPPING_ITEM_NOTE_LENGTH,
  MAX_SHOPPING_ITEM_QUANTITY_LENGTH,
  type ShoppingUpsertMatchKind,
  cleanOptionalText,
  cleanShoppingItemName,
  normalizeShoppingItemName,
  resolveShoppingUpsertFields,
} from '~/lib/shopping';
import { PENDING_SHOPPING_ITEM_ORDER, SHOPPING_ITEM_SELECT } from '~/server/api/routers/shopping';
import { db } from '~/server/db';
import { getBearerToken, isExternalApiEnabled, isValidExternalApiKey } from '~/server/externalApi';

/**
 * API externa de la lista de compras, pensada para Home Assistant / n8n.
 *
 * Se protege con `Authorization: Bearer <EXTERNAL_API_KEY>`. No expone nada de gastos, balances
 * ni usuarios más allá del nombre de quien pidió o marcó cada ítem.
 */

const MAX_EXTERNAL_BATCH = 100;

const SOURCE_TO_API = {
  APP: 'app',
  ALEXA: 'alexa',
  API: 'api',
} as const satisfies Record<ShoppingItemSource, string>;

const externalSourceSchema = z.enum(['alexa', 'api']).default('api');

const upsertItemSchema = z.object({
  externalId: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(MAX_SHOPPING_ITEM_NAME_LENGTH),
  quantity: z.string().max(MAX_SHOPPING_ITEM_QUANTITY_LENGTH).nullish(),
  note: z.string().max(MAX_SHOPPING_ITEM_NOTE_LENGTH).nullish(),
  checked: z.boolean().optional(),
});

const postBodySchema = z.object({
  source: externalSourceSchema,
  items: z.array(upsertItemSchema).min(1).max(MAX_EXTERNAL_BATCH),
});

const patchItemSchema = z
  .object({
    id: z.string().uuid().optional(),
    externalId: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(MAX_SHOPPING_ITEM_NAME_LENGTH).optional(),
    checked: z.boolean(),
  })
  .refine(
    (item) => Boolean(item.id ?? item.externalId ?? item.name),
    'Se necesita id, externalId o name',
  );

const patchBodySchema = z.object({
  items: z.array(patchItemSchema).min(1).max(MAX_EXTERNAL_BATCH),
});

const deleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).max(MAX_EXTERNAL_BATCH).optional(),
  externalIds: z.array(z.string().min(1).max(200)).max(MAX_EXTERNAL_BATCH).optional(),
  names: z
    .array(z.string().min(1).max(MAX_SHOPPING_ITEM_NAME_LENGTH))
    .max(MAX_EXTERNAL_BATCH)
    .optional(),
  checked: z.boolean().optional(),
});

type ShoppingItemPayload = Prisma.ShoppingItemGetPayload<{ select: typeof SHOPPING_ITEM_SELECT }>;

const serializeItem = (item: ShoppingItemPayload) => ({
  id: item.id,
  name: item.name,
  quantity: item.quantity,
  note: item.note,
  checked: item.checked,
  checkedAt: item.checkedAt?.toISOString() ?? null,
  checkedBy: item.checkedByUser?.name ?? null,
  addedBy: item.addedByUser?.name ?? null,
  source: SOURCE_TO_API[item.source],
  externalId: item.externalId,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

const readSingleQueryParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Sin clave configurada, la API externa directamente no existe.
  if (!isExternalApiEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!isValidExternalApiKey(getBearerToken(req.headers.authorization))) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const groupId = Number(readSingleQueryParam(req.query.groupId));

  if (!Number.isInteger(groupId) || 0 >= groupId) {
    return res.status(400).json({ error: 'Invalid groupId' });
  }

  const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true } });

  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, groupId);
      case 'POST':
        return await handlePost(req, res, groupId);
      case 'PATCH':
        return await handlePatch(req, res, groupId);
      case 'DELETE':
        return await handleDelete(req, res, groupId);
      default:
        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid body', details: error.flatten() });
    }

    console.error('External shopping API error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, groupId: number) {
  const status = readSingleQueryParam(req.query.status) ?? 'all';

  if (!['all', 'pending', 'checked'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const items = await db.shoppingItem.findMany({
    where: {
      groupId,
      ...('all' === status ? {} : { checked: 'checked' === status }),
    },
    orderBy:
      'checked' === status
        ? [{ checkedAt: 'desc' }]
        : [{ checked: 'asc' }, ...PENDING_SHOPPING_ITEM_ORDER],
    select: SHOPPING_ITEM_SELECT,
  });

  return res.status(200).json({ groupId, items: items.map(serializeItem) });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, groupId: number) {
  const body = postBodySchema.parse(req.body);
  const source: ShoppingItemSource = 'alexa' === body.source ? 'ALEXA' : 'API';

  const existing = await db.shoppingItem.findMany({
    where: { groupId },
    select: { id: true, name: true, externalId: true, checked: true, addedBy: true },
  });

  const byExternalId = new Map(
    existing.filter((item) => item.externalId).map((item) => [item.externalId!, item]),
  );
  /**
   * Para el match por nombre solo miramos lo pendiente: un "pan" comprado la semana pasada no
   * debería impedir que se vuelva a pedir pan.
   */
  const pendingByName = new Map(
    existing
      .filter((item) => !item.checked)
      .map((item) => [normalizeShoppingItemName(item.name), item]),
  );

  /** Mantiene los índices al día dentro del mismo lote. */
  const remember = (item: (typeof existing)[number]) => {
    if (item.externalId) {
      byExternalId.set(item.externalId, item);
    }
    if (item.checked) {
      pendingByName.delete(normalizeShoppingItemName(item.name));
    } else {
      pendingByName.set(normalizeShoppingItemName(item.name), item);
    }
  };

  const results = [];
  let created = 0;
  let updated = 0;

  for (const input of body.items) {
    const name = cleanShoppingItemName(input.name);

    if (!name) {
      continue;
    }

    /**
     * Primero por `externalId`, que es el ancla de la sync. Si ese id todavía no existe acá,
     * caemos al nombre: así un ítem que cargó una persona adopta el id externo en vez de
     * duplicarse, y la próxima sync ya lo encuentra por id.
     */
    const matchByExternalId = input.externalId ? byExternalId.get(input.externalId) : undefined;
    const match = matchByExternalId ?? pendingByName.get(normalizeShoppingItemName(name));
    const matchedBy: ShoppingUpsertMatchKind = matchByExternalId ? 'externalId' : 'name';

    const quantity =
      undefined === input.quantity
        ? undefined
        : (cleanOptionalText(input.quantity, MAX_SHOPPING_ITEM_QUANTITY_LENGTH) ?? null);
    const note =
      undefined === input.note
        ? undefined
        : (cleanOptionalText(input.note, MAX_SHOPPING_ITEM_NOTE_LENGTH) ?? null);

    if (match) {
      /**
       * No pisamos `addedBy` ni `source`, y el nombre solo se reescribe cuando el ítem es de la
       * fuente externa. Ver `resolveShoppingUpsertFields`.
       */
      const owned = resolveShoppingUpsertFields(matchedBy, match, {
        name,
        externalId: input.externalId,
      });

      const item = await db.shoppingItem.update({
        where: { id: match.id },
        data: {
          name: owned.name,
          externalId: owned.externalId,
          quantity,
          note,
          ...(undefined === input.checked
            ? {}
            : {
                checked: input.checked,
                checkedAt: input.checked ? new Date() : null,
                checkedBy: null,
              }),
        },
        select: SHOPPING_ITEM_SELECT,
      });
      updated += 1;
      results.push(item);
      remember({ ...match, name: item.name, externalId: item.externalId, checked: item.checked });
    } else {
      const item = await db.shoppingItem.create({
        data: {
          groupId,
          name,
          quantity: quantity ?? null,
          note: note ?? null,
          source,
          externalId: input.externalId ?? null,
          checked: input.checked ?? false,
          checkedAt: input.checked ? new Date() : null,
        },
        select: SHOPPING_ITEM_SELECT,
      });
      created += 1;
      results.push(item);
      // Lo creó la sync, así que no tiene persona detrás.
      remember({
        id: item.id,
        name: item.name,
        externalId: item.externalId,
        checked: item.checked,
        addedBy: null,
      });
    }
  }

  return res.status(200).json({ groupId, created, updated, items: results.map(serializeItem) });
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, groupId: number) {
  const body = patchBodySchema.parse(req.body);

  const results = [];
  const notFound = [];

  for (const input of body.items) {
    const match = await db.shoppingItem.findFirst({
      where: {
        groupId,
        ...(input.id ? { id: input.id } : {}),
        ...(input.externalId ? { externalId: input.externalId } : {}),
        ...(input.name && !input.id && !input.externalId
          ? { name: { equals: cleanShoppingItemName(input.name), mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ checked: 'asc' }, { createdAt: 'desc' }],
      select: { id: true },
    });

    if (!match) {
      notFound.push(input.id ?? input.externalId ?? input.name);
      continue;
    }

    results.push(
      await db.shoppingItem.update({
        where: { id: match.id },
        data: {
          checked: input.checked,
          checkedAt: input.checked ? new Date() : null,
          // Quien marcó fue un sistema externo, no una persona de la app.
          checkedBy: null,
        },
        select: SHOPPING_ITEM_SELECT,
      }),
    );
  }

  return res.status(200).json({
    groupId,
    updated: results.length,
    notFound,
    items: results.map(serializeItem),
  });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, groupId: number) {
  const fromQuery = {
    ids: readSingleQueryParam(req.query.id) ? [readSingleQueryParam(req.query.id)!] : undefined,
    externalIds: readSingleQueryParam(req.query.externalId)
      ? [readSingleQueryParam(req.query.externalId)!]
      : undefined,
    names: readSingleQueryParam(req.query.name)
      ? [readSingleQueryParam(req.query.name)!]
      : undefined,
    checked: 'true' === readSingleQueryParam(req.query.checked) ? true : undefined,
  };

  const body = deleteBodySchema.parse({
    ...(req.body && 'object' === typeof req.body ? req.body : {}),
    ...Object.fromEntries(Object.entries(fromQuery).filter(([, value]) => undefined !== value)),
  });

  const filters = [];

  if (body.ids?.length) {
    filters.push({ id: { in: body.ids } });
  }
  if (body.externalIds?.length) {
    filters.push({ externalId: { in: body.externalIds } });
  }
  if (body.names?.length) {
    filters.push({
      name: { in: body.names.map(cleanShoppingItemName), mode: 'insensitive' as const },
    });
  }
  if (true === body.checked) {
    filters.push({ checked: true });
  }

  if (0 === filters.length) {
    return res
      .status(400)
      .json({ error: 'Se necesita al menos uno de: ids, externalIds, names, checked' });
  }

  const { count } = await db.shoppingItem.deleteMany({
    where: { groupId, OR: filters },
  });

  return res.status(200).json({ groupId, deleted: count });
}
