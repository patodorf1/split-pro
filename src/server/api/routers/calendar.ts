import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  MAX_RANGE_DAYS,
  calendarEventFieldsSchema,
  dayKeySchema,
  dbDateFromDayKey,
  rangeLength,
} from '~/lib/agenda';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { findAgendaItems } from '~/server/calendar/agenda';
import { EVENT_SELECT } from '~/server/calendar/events';
import { memberOf } from '~/server/documents/access';
import { type db as dbClient } from '~/server/db';

type Db = typeof dbClient;

const eventIdSchema = z.number().int().positive();

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });

/** Evento al que el usuario tiene acceso (miembro del grupo dueño), o null. */
export const findAccessibleEvent = async (db: Db, id: number, userId: number) =>
  db.calendarEvent.findFirst({ where: { id, group: memberOf(userId) } });

const rangeInputSchema = z.object({
  from: dayKeySchema,
  to: dayKeySchema,
  /** Zona del teléfono, sólo para los gastos recurrentes. Se usa en JS, nunca en SQL. */
  timeZone: z.string().min(1).max(64),
});

/**
 * Agenda de la casa: eventos propios (compartidos por grupo, mismo criterio de membresía que
 * Documentos y Emergencias: si no sos miembro, el evento "no existe") más lo que aparece solo
 * (vencimientos de documentos y gastos recurrentes).
 */
export const calendarRouter = createTRPCRouter({
  /** Todo lo que cae entre `from` y `to` (días incluidos), ya ordenado. */
  range: protectedProcedure.input(rangeInputSchema).query(async ({ ctx, input }) => {
    const range = { from: input.from, to: input.to };
    const length = rangeLength(range);

    if (length < 1 || length > MAX_RANGE_DAYS) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid_range' });
    }

    return findAgendaItems(ctx.db, { userId: ctx.session.user.id }, range, input.timeZone);
  }),

  /** Grupos del usuario para elegir dónde guardar un evento nuevo. */
  groups: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const groups = await ctx.db.group.findMany({
      where: { archivedAt: null, ...memberOf(userId) },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        groupUsers: { where: { userId }, select: { defaultForAdd: true } },
        _count: { select: { calendarEvents: true } },
      },
    });

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      defaultForAdd: group.groupUsers[0]?.defaultForAdd ?? false,
      eventCount: group._count.calendarEvents,
    }));
  }),

  create: protectedProcedure
    .input(calendarEventFieldsSchema.extend({ groupId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.db.groupUser.findFirst({
        where: { groupId: input.groupId, userId: ctx.session.user.id },
      });

      if (!membership) {
        throw notFound();
      }

      return ctx.db.calendarEvent.create({
        data: {
          groupId: input.groupId,
          title: input.title,
          date: dbDateFromDayKey(input.date),
          time: input.time,
          note: input.note,
          repeat: input.repeat,
          createdById: ctx.session.user.id,
        },
        select: EVENT_SELECT,
      });
    }),

  update: protectedProcedure
    .input(calendarEventFieldsSchema.extend({ id: eventIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const event = await findAccessibleEvent(ctx.db, input.id, ctx.session.user.id);

      if (!event) {
        throw notFound();
      }

      return ctx.db.calendarEvent.update({
        where: { id: event.id },
        data: {
          title: input.title,
          date: dbDateFromDayKey(input.date),
          time: input.time,
          note: input.note,
          repeat: input.repeat,
        },
        select: EVENT_SELECT,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: eventIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const event = await findAccessibleEvent(ctx.db, input.id, ctx.session.user.id);

      if (!event) {
        throw notFound();
      }

      await ctx.db.calendarEvent.delete({ where: { id: event.id } });

      return { id: event.id };
    }),
});
