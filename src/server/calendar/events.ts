import {
  type AgendaKind,
  type DayRange,
  type EventRepeat,
  dayKeyFromDbDate,
  dbDateFromDayKey,
  expandOccurrences,
} from '~/lib/agenda';
import { type db as dbClient } from '~/server/db';
import { memberOf } from '~/server/documents/access';

/**
 * Eventos propios de la Agenda, sin nada de la capa web: los usa el router `calendar` y también el
 * aviso de la mañana (que corre en el servidor, sin sesión).
 */

type Db = typeof dbClient;

export const EVENT_SELECT = {
  id: true,
  groupId: true,
  title: true,
  date: true,
  time: true,
  note: true,
  repeat: true,
} as const;

export interface AgendaItemBase {
  /** Clave única dentro de una respuesta (sirve de `key` en React). */
  key: string;
  kind: AgendaKind;
  /** Día de calendario "AAAA-MM-DD". */
  date: string;
  /** "HH:MM" o null (todo el día). */
  time: string | null;
  title: string;
}

export interface AgendaEventItem extends AgendaItemBase {
  kind: 'event';
  eventId: number;
  groupId: number;
  note: string | null;
  repeat: EventRepeat;
  /** Fecha de inicio guardada (la de la primera vez), para editar el evento. */
  startDate: string;
}

/**
 * De quién es la Agenda que se mira: la app muestra todos los grupos de la persona; la API externa
 * (el asistente) mira un solo grupo, el de la URL.
 */
export type AgendaScope = { userId: number } | { groupId: number };

/** Filtro de grupo para Prisma según el alcance. */
export const scopeGroupFilter = (scope: AgendaScope) =>
  'userId' in scope ? memberOf(scope.userId) : { id: scope.groupId };

/** Eventos propios del alcance, con las repeticiones ya abiertas en el rango. */
export const findEventItems = async (
  db: Db,
  scope: AgendaScope,
  range: DayRange,
): Promise<AgendaEventItem[]> => {
  const events = await db.calendarEvent.findMany({
    where: {
      group: scopeGroupFilter(scope),
      date: { lte: dbDateFromDayKey(range.to) },
      OR: [{ repeat: { not: 'NONE' } }, { date: { gte: dbDateFromDayKey(range.from) } }],
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    select: EVENT_SELECT,
  });

  return events.flatMap((event) => {
    const startDate = dayKeyFromDbDate(event.date);

    return expandOccurrences({ date: startDate, repeat: event.repeat }, range).map((date) => ({
      key: `event-${event.id}-${date}`,
      kind: 'event' as const,
      date,
      time: event.time,
      title: event.title,
      eventId: event.id,
      groupId: event.groupId,
      note: event.note,
      repeat: event.repeat,
      startDate,
    }));
  });
};
