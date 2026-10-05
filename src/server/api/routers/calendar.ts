import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  type DayRange,
  MAX_RANGE_DAYS,
  addDaysToKey,
  calendarEventFieldsSchema,
  compareAgendaItems,
  dayKeySchema,
  dbDateFromDayKey,
  formatDay,
  parseDay,
  rangeLength,
} from '~/lib/agenda';
import { cronOccurrencesBetween } from '~/lib/cron';
import { REMINDER_TIME_ZONE } from '~/lib/documentReminders';
import { getZonedCalendarDay, zonedStartOfDay } from '~/lib/stats';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import {
  type AgendaEventItem,
  type AgendaItemBase,
  EVENT_SELECT,
  findEventItems,
} from '~/server/calendar/events';
import { memberOf } from '~/server/documents/access';
import { type db as dbClient } from '~/server/db';

type Db = typeof dbClient;

export interface AgendaExpiryItem extends AgendaItemBase {
  kind: 'expiry';
  documentId: string;
  mimeType: string;
  folderId: number;
  folderName: string;
}

export interface AgendaRecurringItem extends AgendaItemBase {
  kind: 'recurring';
  expenseId: string;
  recurrenceId: number;
  amount: bigint;
  currency: string;
  category: string;
}

export { type AgendaEventItem, findEventItems };

export type AgendaItem = AgendaEventItem | AgendaExpiryItem | AgendaRecurringItem;

const eventIdSchema = z.number().int().positive();

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });

/** Comienzo (en UTC) del día "AAAA-MM-DD" en la zona dada. */
const startOfDayIn = (key: string, timeZone: string): Date => {
  const { year, month, day } = parseDay(key)!;

  return zonedStartOfDay(year, month, day, timeZone);
};

/** Instantes `[desde, hasta)` que cubren los días del rango en la zona dada. */
const instantRange = (range: DayRange, timeZone: string) => ({
  from: startOfDayIn(range.from, timeZone),
  to: startOfDayIn(addDaysToKey(range.to, 1), timeZone),
});

const zonedDayKey = (instant: Date, timeZone: string): string =>
  formatDay(getZonedCalendarDay(timeZone, instant));

/** Evento al que el usuario tiene acceso (miembro del grupo dueño), o null. */
export const findAccessibleEvent = async (db: Db, id: number, userId: number) =>
  db.calendarEvent.findFirst({ where: { id, group: memberOf(userId) } });

/**
 * Vencimientos de documentos del rango. El día se cuenta en Argentina, igual que los avisos de
 * Inicio y la pantalla de Documentos (así "vence el 12" es el 12 en todos lados).
 */
export const findExpiryItems = async (
  db: Db,
  userId: number,
  range: DayRange,
): Promise<AgendaExpiryItem[]> => {
  const { from, to } = instantRange(range, REMINDER_TIME_ZONE);
  const documents = await db.document.findMany({
    where: { deletedAt: null, group: memberOf(userId), expiresAt: { gte: from, lt: to } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      mimeType: true,
      folderId: true,
      expiresAt: true,
      folder: { select: { name: true } },
    },
  });

  return documents.flatMap((document) =>
    document.expiresAt
      ? [
          {
            key: `expiry-${document.id}`,
            kind: 'expiry' as const,
            date: zonedDayKey(document.expiresAt, REMINDER_TIME_ZONE),
            time: null,
            title: document.name,
            documentId: document.id,
            mimeType: document.mimeType,
            folderId: document.folderId,
            folderName: document.folder.name,
          },
        ]
      : [],
  );
};

/**
 * Próximas veces que se carga cada gasto recurrente (en los que participa el usuario) dentro del
 * rango. El cron de la base está en UTC; el día se muestra en la zona del teléfono.
 */
export const findRecurringItems = async (
  db: Db,
  userId: number,
  range: DayRange,
  timeZone: string,
): Promise<AgendaRecurringItem[]> => {
  const participant = { deletedBy: null, expenseParticipants: { some: { userId } } };
  const recurrences = await db.expenseRecurrence.findMany({
    where: { job: { active: true }, expense: { some: participant } },
    select: {
      id: true,
      job: { select: { schedule: true } },
      expense: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        where: participant,
        select: { id: true, name: true, amount: true, currency: true, category: true },
      },
    },
  });
  const { from, to } = instantRange(range, timeZone);

  return recurrences.flatMap((recurrence) => {
    const expense = recurrence.expense[0];

    if (!expense) {
      return [];
    }

    let occurrences: Date[];
    try {
      occurrences = cronOccurrencesBetween(recurrence.job.schedule, from, to);
    } catch {
      console.error(`Failed to parse cron expression: ${recurrence.job.schedule}`);
      return [];
    }

    return occurrences.map((at) => {
      const date = zonedDayKey(at, timeZone);

      return {
        key: `recurring-${recurrence.id}-${at.getTime()}`,
        kind: 'recurring' as const,
        date,
        time: null,
        title: expense.name,
        expenseId: expense.id,
        recurrenceId: recurrence.id,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
      };
    });
  });
};

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

    const userId = ctx.session.user.id;
    const [events, expiries, recurring] = await Promise.all([
      findEventItems(ctx.db, userId, range),
      findExpiryItems(ctx.db, userId, range),
      // Sin pg_cron (o con un cron roto) la Agenda sigue andando, sólo sin los recurrentes.
      findRecurringItems(ctx.db, userId, range, input.timeZone).catch((error: unknown) => {
        console.error('calendar.range: recurring expenses unavailable', error);
        return [];
      }),
    ]);

    const items: AgendaItem[] = [...events, ...expiries, ...recurring];

    return items.sort(compareAgendaItems);
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
