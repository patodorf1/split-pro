import { type CalendarEvent } from '@prisma/client';

import { dayKeyFromDbDate, dbDateFromDayKey } from '~/lib/agenda';
import {
  type ExternalAgendaQuery,
  type ExternalEventCreate,
  type ExternalEventPatch,
  normalizeSearch,
} from '~/lib/externalCalendar';
import { ExternalApiError, minorToUnits, resolveMember } from '~/lib/externalExpense';
import { REMINDER_TIME_ZONE } from '~/lib/documentReminders';
import { type AgendaItem, findAgendaItems } from '~/server/calendar/agenda';
import { db } from '~/server/db';
import { type LoadedGroup, assertGroupWritable } from '~/server/externalExpenses';

/**
 * Lógica con base de datos de la API externa de la Agenda. Mismo supuesto que gastos: la clave es
 * de la familia y puede tocar cualquier grupo, pero `createdBy` tiene que ser miembro del grupo de
 * la URL. Lo que se ve es lo mismo que en la app para ese grupo: eventos propios, vencimientos de
 * documentos y gastos recurrentes, con los días contados en Argentina.
 */

const EVENT_WITH_AUTHOR = {
  id: true,
  groupId: true,
  title: true,
  date: true,
  time: true,
  note: true,
  repeat: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

type EventWithAuthor = Pick<
  CalendarEvent,
  'id' | 'groupId' | 'title' | 'date' | 'time' | 'note' | 'repeat' | 'createdAt'
> & { createdBy: { id: number; name: string | null; email: string | null } | null };

export const serializeEvent = (event: EventWithAuthor) => ({
  id: event.id,
  groupId: event.groupId,
  title: event.title,
  date: dayKeyFromDbDate(event.date),
  time: event.time,
  note: event.note,
  repeat: event.repeat.toLowerCase(),
  createdBy: event.createdBy,
  createdAt: event.createdAt.toISOString(),
});

const serializeItem = (item: AgendaItem) => {
  const base = { kind: item.kind, date: item.date, time: item.time, title: item.title };

  switch (item.kind) {
    case 'event':
      return {
        ...base,
        eventId: item.eventId,
        note: item.note,
        repeat: item.repeat.toLowerCase(),
        startDate: item.startDate,
      };
    case 'expiry':
      return { ...base, documentId: item.documentId, folder: item.folderName };
    case 'recurring':
      return {
        ...base,
        expenseId: item.expenseId,
        amount: minorToUnits(item.amount, item.currency),
        currency: item.currency,
        category: item.category,
      };
  }
};

const matchesSearch = (item: AgendaItem, search: string) =>
  normalizeSearch(item.title).includes(search) ||
  ('event' === item.kind && null !== item.note && normalizeSearch(item.note).includes(search));

export const listGroupAgenda = async (group: LoadedGroup, query: ExternalAgendaQuery) => {
  const items = await findAgendaItems(db, { groupId: group.id }, query.range, REMINDER_TIME_ZONE);
  const found = query.search ? items.filter((item) => matchesSearch(item, query.search!)) : items;

  return {
    groupId: group.id,
    from: query.range.from,
    to: query.range.to,
    q: query.search,
    items: found.map(serializeItem),
  };
};

const eventNotFound = () =>
  new ExternalApiError(
    404,
    'event_not_found',
    'Evento no encontrado en este grupo',
    'Event not found in this group',
  );

/** Id de evento de la URL; si no es un número válido, es como si no existiera. */
export const parseEventId = (raw: string | undefined): number => {
  const id = Number(raw);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw eventNotFound();
  }

  return id;
};

const findGroupEvent = async (group: LoadedGroup, eventId: number) => {
  const event = await db.calendarEvent.findFirst({
    where: { id: eventId, groupId: group.id },
    select: EVENT_WITH_AUTHOR,
  });

  if (!event) {
    throw eventNotFound();
  }

  return event;
};

/**
 * Crea un evento. Si ya hay uno igual en el grupo (mismo título sin importar mayúsculas, mismo día
 * de inicio y misma hora) devuelve ese con `created: false`: un reintento del asistente no duplica.
 */
export const createExternalEvent = async (group: LoadedGroup, input: ExternalEventCreate) => {
  assertGroupWritable(group);

  const createdBy = input.createdBy
    ? resolveMember(input.createdBy, group.members, 'createdBy')
    : null;
  const date = dbDateFromDayKey(input.date);

  const existing = await db.calendarEvent.findFirst({
    where: {
      groupId: group.id,
      date,
      time: input.time,
      title: { equals: input.title, mode: 'insensitive' },
    },
    orderBy: { id: 'asc' },
    select: EVENT_WITH_AUTHOR,
  });

  if (existing) {
    return { created: false, event: serializeEvent(existing) };
  }

  const event = await db.calendarEvent.create({
    data: {
      groupId: group.id,
      title: input.title,
      date,
      time: input.time,
      note: input.note,
      repeat: input.repeat,
      createdById: createdBy?.id ?? null,
    },
    select: EVENT_WITH_AUTHOR,
  });

  return { created: true, event: serializeEvent(event) };
};

/** Cambia solo los campos que vienen; `time: null` lo pasa a "todo el día". */
export const updateExternalEvent = async (
  group: LoadedGroup,
  eventId: number,
  patch: ExternalEventPatch,
) => {
  assertGroupWritable(group);
  await findGroupEvent(group, eventId);

  const event = await db.calendarEvent.update({
    where: { id: eventId },
    data: {
      ...(undefined === patch.title ? {} : { title: patch.title }),
      ...(undefined === patch.date ? {} : { date: dbDateFromDayKey(patch.date) }),
      ...(undefined === patch.time ? {} : { time: patch.time }),
      ...(undefined === patch.note ? {} : { note: patch.note }),
      ...(undefined === patch.repeat ? {} : { repeat: patch.repeat }),
    },
    select: EVENT_WITH_AUTHOR,
  });

  return serializeEvent(event);
};

/** Borra el evento (como la app: no hay papelera). Devuelve lo que se borró. */
export const deleteExternalEvent = async (group: LoadedGroup, eventId: number) => {
  assertGroupWritable(group);
  const event = await findGroupEvent(group, eventId);

  await db.calendarEvent.delete({ where: { id: event.id } });

  return serializeEvent(event);
};
