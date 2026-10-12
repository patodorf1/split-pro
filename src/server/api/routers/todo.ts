import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { MAX_TODO_TITLE_LENGTH, cleanTodoTitle, parseTodoItems } from '~/lib/todo';
import { createTRPCRouter, groupProcedure } from '~/server/api/trpc';

const TODO_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

export const TODO_ITEM_SELECT = {
  id: true,
  title: true,
  done: true,
  doneAt: true,
  createdAt: true,
  addedByUser: { select: TODO_USER_SELECT },
  doneByUser: { select: TODO_USER_SELECT },
} as const;

/** To Do de la casa: pendientes (lo más viejo primero, como una fila) y hechas. */
export const todoRouter = createTRPCRouter({
  getList: groupProcedure
    .input(z.object({ doneLimit: z.number().int().min(0).max(200).default(30) }))
    .query(async ({ ctx, input }) => {
      const [pending, done, doneTotal] = await Promise.all([
        ctx.db.todoItem.findMany({
          where: { groupId: input.groupId, done: false },
          orderBy: { createdAt: 'asc' },
          select: TODO_ITEM_SELECT,
        }),
        ctx.db.todoItem.findMany({
          where: { groupId: input.groupId, done: true },
          orderBy: [{ doneAt: 'desc' }, { updatedAt: 'desc' }],
          take: input.doneLimit,
          select: TODO_ITEM_SELECT,
        }),
        ctx.db.todoItem.count({ where: { groupId: input.groupId, done: true } }),
      ]);

      return { pending, done, doneTotal };
    }),

  /** Una tarea por renglón: pegar una lista carga varias de una vez. */
  add: groupProcedure
    .input(z.object({ text: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const titles = parseTodoItems(input.text);

      if (0 === titles.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No tasks in text' });
      }

      const created = await ctx.db.$transaction(
        titles.map((title) =>
          ctx.db.todoItem.create({
            data: { groupId: input.groupId, title, addedBy: ctx.session.user.id },
            select: TODO_ITEM_SELECT,
          }),
        ),
      );

      return { created };
    }),

  update: groupProcedure
    .input(z.object({ id: z.string().uuid(), title: z.string().min(1).max(MAX_TODO_TITLE_LENGTH) }))
    .mutation(async ({ ctx, input }) => {
      const title = cleanTodoTitle(input.title);

      if (!title) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Empty task' });
      }

      const { count } = await ctx.db.todoItem.updateMany({
        where: { id: input.id, groupId: input.groupId },
        data: { title },
      });

      if (0 === count) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { id: input.id };
    }),

  setDone: groupProcedure
    .input(z.object({ id: z.string().uuid(), done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.todoItem.updateMany({
        where: { id: input.id, groupId: input.groupId },
        data: input.done
          ? { done: true, doneAt: new Date(), doneBy: ctx.session.user.id }
          : { done: false, doneAt: null, doneBy: null },
      });

      if (0 === count) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { id: input.id };
    }),

  delete: groupProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.todoItem.deleteMany({
        where: { id: input.id, groupId: input.groupId },
      });

      if (0 === count) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { id: input.id };
    }),

  clearDone: groupProcedure.mutation(async ({ ctx, input }) => {
    const { count } = await ctx.db.todoItem.deleteMany({
      where: { groupId: input.groupId, done: true },
    });

    return { count };
  }),
});
