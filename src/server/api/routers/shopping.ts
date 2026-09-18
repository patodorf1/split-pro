import { type Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  MAX_SHOPPING_ITEM_NAME_LENGTH,
  MAX_SHOPPING_ITEM_NOTE_LENGTH,
  MAX_SHOPPING_ITEM_QUANTITY_LENGTH,
  cleanOptionalText,
  cleanShoppingItemName,
  normalizeShoppingItemName,
  parseShoppingItems,
} from '~/lib/shopping';
import { createTRPCRouter, groupProcedure } from '~/server/api/trpc';
import { type db as dbClient } from '~/server/db';

const SHOPPING_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

export const SHOPPING_ITEM_SELECT = {
  id: true,
  name: true,
  quantity: true,
  note: true,
  checked: true,
  checkedAt: true,
  source: true,
  externalId: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  addedByUser: { select: SHOPPING_USER_SELECT },
  checkedByUser: { select: SHOPPING_USER_SELECT },
} as const;

/** Pendientes: lo fijado a mano primero, después lo último cargado (feedback inmediato al tipear). */
export const PENDING_SHOPPING_ITEM_ORDER: Prisma.ShoppingItemOrderByWithRelationInput[] = [
  { sortOrder: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'desc' },
];

export const shoppingRouter = createTRPCRouter({
  getList: groupProcedure
    .input(z.object({ checkedLimit: z.number().int().min(0).max(200).default(30) }))
    .query(async ({ ctx, input }) => {
      const [pending, checked, checkedTotal] = await Promise.all([
        ctx.db.shoppingItem.findMany({
          where: { groupId: input.groupId, checked: false },
          orderBy: PENDING_SHOPPING_ITEM_ORDER,
          select: SHOPPING_ITEM_SELECT,
        }),
        ctx.db.shoppingItem.findMany({
          where: { groupId: input.groupId, checked: true },
          orderBy: [{ checkedAt: 'desc' }, { updatedAt: 'desc' }],
          take: input.checkedLimit,
          select: SHOPPING_ITEM_SELECT,
        }),
        ctx.db.shoppingItem.count({ where: { groupId: input.groupId, checked: true } }),
      ]);

      return { pending, checked, checkedTotal };
    }),

  /**
   * Acepta varios ítems en un solo texto: "leche, pan\nhuevos" carga tres.
   * Si el nombre ya está pendiente en el grupo, devuelve el existente en vez de duplicarlo.
   */
  addItems: groupProcedure
    .input(
      z.object({
        text: z.string().min(1).max(2000),
        quantity: z.string().max(MAX_SHOPPING_ITEM_QUANTITY_LENGTH).optional(),
        note: z.string().max(MAX_SHOPPING_ITEM_NOTE_LENGTH).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = parseShoppingItems(input.text);

      if (0 === parsed.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No items in text' });
      }

      const pending = await ctx.db.shoppingItem.findMany({
        where: { groupId: input.groupId, checked: false },
        select: SHOPPING_ITEM_SELECT,
      });

      const pendingByKey = new Map(
        pending.map((item) => [normalizeShoppingItemName(item.name), item]),
      );

      // La cantidad y la nota solo tienen sentido cuando se carga un ítem a la vez.
      const isSingle = 1 === parsed.length;
      const quantity = isSingle
        ? cleanOptionalText(input.quantity, MAX_SHOPPING_ITEM_QUANTITY_LENGTH)
        : undefined;
      const note = isSingle
        ? cleanOptionalText(input.note, MAX_SHOPPING_ITEM_NOTE_LENGTH)
        : undefined;

      const duplicates = [];
      const toCreate = [];

      for (const item of parsed) {
        const existing = pendingByKey.get(item.key);
        if (existing) {
          duplicates.push(existing);
        } else {
          toCreate.push(item);
        }
      }

      const created = await Promise.all(
        toCreate.map((item) =>
          ctx.db.shoppingItem.create({
            data: {
              groupId: input.groupId,
              name: item.name,
              quantity,
              note,
              addedBy: ctx.session.user.id,
              source: 'APP',
            },
            select: SHOPPING_ITEM_SELECT,
          }),
        ),
      );

      return { created, duplicates };
    }),

  updateItem: groupProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(MAX_SHOPPING_ITEM_NAME_LENGTH).optional(),
        quantity: z.string().max(MAX_SHOPPING_ITEM_QUANTITY_LENGTH).nullable().optional(),
        note: z.string().max(MAX_SHOPPING_ITEM_NOTE_LENGTH).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertItemInGroup(ctx.db, input.id, input.groupId);

      const name = undefined === input.name ? undefined : cleanShoppingItemName(input.name);

      if ('' === name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Empty item name' });
      }

      return ctx.db.shoppingItem.update({
        where: { id: input.id },
        data: {
          name,
          quantity:
            undefined === input.quantity
              ? undefined
              : (cleanOptionalText(input.quantity, MAX_SHOPPING_ITEM_QUANTITY_LENGTH) ?? null),
          note:
            undefined === input.note
              ? undefined
              : (cleanOptionalText(input.note, MAX_SHOPPING_ITEM_NOTE_LENGTH) ?? null),
        },
        select: SHOPPING_ITEM_SELECT,
      });
    }),

  setChecked: groupProcedure
    .input(z.object({ id: z.string().uuid(), checked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertItemInGroup(ctx.db, input.id, input.groupId);

      return ctx.db.shoppingItem.update({
        where: { id: input.id },
        data: {
          checked: input.checked,
          checkedAt: input.checked ? new Date() : null,
          checkedBy: input.checked ? ctx.session.user.id : null,
        },
        select: SHOPPING_ITEM_SELECT,
      });
    }),

  deleteItem: groupProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.shoppingItem.deleteMany({
        where: { id: input.id, groupId: input.groupId },
      });

      if (0 === count) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Shopping item not found' });
      }

      return { id: input.id };
    }),

  clearChecked: groupProcedure.mutation(async ({ ctx, input }) => {
    const { count } = await ctx.db.shoppingItem.deleteMany({
      where: { groupId: input.groupId, checked: true },
    });

    return { count };
  }),

  /** Nombres más usados históricamente en el grupo, para autocompletar mientras se escribe. */
  suggestions: groupProcedure
    .input(
      z.object({
        query: z.string().max(MAX_SHOPPING_ITEM_NAME_LENGTH).optional(),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    )
    .query(async ({ ctx, input }) => {
      const grouped = await ctx.db.shoppingItem.groupBy({
        by: ['name'],
        where: { groupId: input.groupId },
        _count: { _all: true },
        _max: { createdAt: true },
      });

      const queryKey = normalizeShoppingItemName(input.query ?? '');
      const merged = new Map<string, { name: string; count: number; lastUsed: Date }>();

      for (const row of grouped) {
        const key = normalizeShoppingItemName(row.name);

        if (!key || (queryKey && !key.includes(queryKey))) {
          continue;
        }

        const count = row._count._all;
        const lastUsed = row._max.createdAt ?? new Date(0);
        const previous = merged.get(key);

        if (!previous) {
          merged.set(key, { name: row.name, count, lastUsed });
        } else {
          merged.set(key, {
            // Nos quedamos con la grafía más reciente del mismo nombre.
            name: lastUsed > previous.lastUsed ? row.name : previous.name,
            count: previous.count + count,
            lastUsed: lastUsed > previous.lastUsed ? lastUsed : previous.lastUsed,
          });
        }
      }

      return [...merged.values()]
        .sort((a, b) => b.count - a.count || b.lastUsed.getTime() - a.lastUsed.getTime())
        .slice(0, input.limit)
        .map(({ name, count }) => ({ name, count }));
    }),
});

const assertItemInGroup = async (db: typeof dbClient, id: string, groupId: number) => {
  const count = await db.shoppingItem.count({ where: { id, groupId } });

  if (0 === count) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Shopping item not found' });
  }
};

export type ShoppingRouter = typeof shoppingRouter;
