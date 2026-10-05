import { type DayRange, addDaysToKey, compareAgendaItems, formatDay, parseDay } from '~/lib/agenda';
import { cronOccurrencesBetween } from '~/lib/cron';
import { REMINDER_TIME_ZONE } from '~/lib/documentReminders';
import { getZonedCalendarDay, zonedStartOfDay } from '~/lib/stats';
import {
  type AgendaEventItem,
  type AgendaItemBase,
  type AgendaScope,
  findEventItems,
  scopeGroupFilter,
} from '~/server/calendar/events';
import { type db as dbClient } from '~/server/db';

/**
 * Todo lo que muestra la Agenda en un rango: eventos propios más lo que aparece solo (vencimientos
 * de documentos y gastos recurrentes). Lo usan el router `calendar` (la app) y la API externa.
 */

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

export type AgendaItem = AgendaEventItem | AgendaExpiryItem | AgendaRecurringItem;

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

/**
 * Vencimientos de documentos del rango. El día se cuenta en Argentina, igual que los avisos de
 * Inicio y la pantalla de Documentos (así "vence el 12" es el 12 en todos lados).
 */
export const findExpiryItems = async (
  db: Db,
  scope: AgendaScope,
  range: DayRange,
): Promise<AgendaExpiryItem[]> => {
  const { from, to } = instantRange(range, REMINDER_TIME_ZONE);
  const documents = await db.document.findMany({
    where: { deletedAt: null, group: scopeGroupFilter(scope), expiresAt: { gte: from, lt: to } },
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
 * Próximas veces que se carga cada gasto recurrente dentro del rango: los que comparte la persona
 * (app) o los del grupo (API externa). El cron de la base está en UTC; el día se muestra en la zona
 * pedida.
 */
export const findRecurringItems = async (
  db: Db,
  scope: AgendaScope,
  range: DayRange,
  timeZone: string,
): Promise<AgendaRecurringItem[]> => {
  const visible =
    'userId' in scope
      ? { deletedBy: null, expenseParticipants: { some: { userId: scope.userId } } }
      : { deletedBy: null, groupId: scope.groupId };
  const recurrences = await db.expenseRecurrence.findMany({
    where: { job: { active: true }, expense: { some: visible } },
    select: {
      id: true,
      job: { select: { schedule: true } },
      expense: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        where: visible,
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

/** Todo lo del rango (días incluidos), ya ordenado. */
export const findAgendaItems = async (
  db: Db,
  scope: AgendaScope,
  range: DayRange,
  timeZone: string,
): Promise<AgendaItem[]> => {
  const [events, expiries, recurring] = await Promise.all([
    findEventItems(db, scope, range),
    findExpiryItems(db, scope, range),
    // Sin pg_cron (o con un cron roto) la Agenda sigue andando, sólo sin los recurrentes.
    findRecurringItems(db, scope, range, timeZone).catch((error: unknown) => {
      console.error('agenda: recurring expenses unavailable', error);
      return [];
    }),
  ]);

  const items: AgendaItem[] = [...events, ...expiries, ...recurring];

  return items.sort(compareAgendaItems);
};
