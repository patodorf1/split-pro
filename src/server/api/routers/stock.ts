import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { MAX_SHOPPING_ITEM_NAME_LENGTH, parseShoppingItems } from '~/lib/shopping';
import { MAX_STOCK_NOTE_LENGTH, STOCK_SECTIONS } from '~/lib/stock';
import { isRecordNotFound, isUniqueViolation } from '~/server/api/prismaErrors';
import { createTRPCRouter, groupProcedure } from '~/server/api/trpc';
import {
  STOCK_ITEM_SELECT,
  StockConflictError,
  addToStock,
  finishStockItem,
  removeStockItem,
  updateStockItem,
} from '~/server/stock/service';

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Stock item not found' });
const alreadyInStock = () => new TRPCError({ code: 'CONFLICT', message: 'already_in_stock' });

/**
 * Carreras entre dos teléfonos: P2025 es "ya no existe" (doble toque, otro lo sacó antes) y P2002
 * es "ese nombre ya está" (dos renombres a la vez). Se traducen a lo mismo que ya responde el
 * chequeo previo.
 */
const mapRaceError = (error: unknown) => {
  if (error instanceof StockConflictError || isUniqueViolation(error)) {
    return alreadyInStock();
  }

  if (isRecordNotFound(error)) {
    return notFound();
  }

  return error;
};

/** Stock de la casa: qué hay. Mismo criterio de acceso que Compras (miembros del grupo). */
export const stockRouter = createTRPCRouter({
  getList: groupProcedure.query(({ ctx, input }) =>
    ctx.db.stockItem.findMany({
      where: { groupId: input.groupId },
      orderBy: { key: 'asc' },
      select: STOCK_ITEM_SELECT,
    }),
  ),

  /** "leche, arroz\ntomates" carga tres. La nota solo vale cuando se carga uno. */
  addItems: groupProcedure
    .input(
      z.object({
        text: z.string().min(1).max(2000),
        note: z.string().max(MAX_STOCK_NOTE_LENGTH).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = parseShoppingItems(input.text);

      if (0 === parsed.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No items in text' });
      }

      const note = 1 === parsed.length ? input.note : undefined;

      return addToStock(ctx.db, {
        groupId: input.groupId,
        items: parsed.map((item) => ({ name: item.name, note })),
        source: 'APP',
        addedBy: ctx.session.user.id,
      });
    }),

  updateItem: groupProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(MAX_SHOPPING_ITEM_NAME_LENGTH).optional(),
        note: z.string().max(MAX_STOCK_NOTE_LENGTH).nullable().optional(),
        section: z.enum(STOCK_SECTIONS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Los chequeos (nombre repetido) y las escrituras (sección aprendida + cambio) van juntos.
        const item = await ctx.db.$transaction((tx) => updateStockItem(tx, input));

        if (!item) {
          throw notFound();
        }

        return item;
      } catch (error) {
        throw mapRaceError(error);
      }
    }),

  /** "Se acabó": sale del Stock y va a Compras, las dos cosas juntas o ninguna. */
  finish: groupProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.db.$transaction((tx) =>
          finishStockItem(tx, {
            groupId: input.groupId,
            id: input.id,
            userId: ctx.session.user.id,
            source: 'APP',
          }),
        );

        if (!result) {
          throw notFound();
        }

        return result;
      } catch (error) {
        throw mapRaceError(error);
      }
    }),

  /** Sacar sin comprar. */
  remove: groupProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const item = await removeStockItem(ctx.db, input);

        if (!item) {
          throw notFound();
        }

        return item;
      } catch (error) {
        throw mapRaceError(error);
      }
    }),
});
