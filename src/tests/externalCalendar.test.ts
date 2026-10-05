import { ExternalApiError } from '~/lib/externalExpense';
import {
  MAX_EXTERNAL_AGENDA_DAYS,
  parseExternalAgendaQuery,
  parseExternalEventCreate,
  parseExternalEventPatch,
} from '~/lib/externalCalendar';
import {
  createExternalEvent,
  deleteExternalEvent,
  listGroupAgenda,
  parseEventId,
  updateExternalEvent,
} from '~/server/externalCalendar';
import type { LoadedGroup } from '~/server/externalExpenses';

const mockDb = {
  calendarEvent: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  document: { findMany: jest.fn() },
  expenseRecurrence: { findMany: jest.fn() },
};

jest.mock('~/server/db', () => ({
  get db() {
    return mockDb;
  },
}));
jest.mock('~/server/api/services/splitService', () => ({
  createExpense: jest.fn(),
  deleteExpense: jest.fn(),
}));

const pato = { id: 1, name: 'Pato', email: 'patodorf@gmail.com' };
const belen = { id: 2, name: 'Belén', email: 'mbelenbilbao@gmail.com' };

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- grupo mínimo de prueba
const casa = { id: 1, archivedAt: null, members: [pato, belen] } as unknown as LoadedGroup;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- grupo mínimo de prueba
const archivado = { ...casa, archivedAt: new Date() } as unknown as LoadedGroup;

const TODAY = { year: 2026, month: 10, day: 5 };

/** Ejecuta y devuelve el ExternalApiError lanzado. */
const catchError = async (fn: () => unknown): Promise<ExternalApiError> => {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ExternalApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('No lanzó error');
};

const eventRow = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  groupId: 1,
  title: 'Viene el plomero',
  date: new Date('2026-10-09T00:00:00Z'),
  time: '10:00',
  note: null,
  repeat: 'NONE',
  createdAt: new Date('2026-10-05T17:00:00Z'),
  createdBy: pato,
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.calendarEvent.findMany.mockResolvedValue([]);
  mockDb.document.findMany.mockResolvedValue([]);
  mockDb.expenseRecurrence.findMany.mockResolvedValue([]);
});

describe('parseExternalAgendaQuery', () => {
  it('defaults to today and the next 13 days', () => {
    expect(parseExternalAgendaQuery({}, TODAY)).toEqual({
      range: { from: '2026-10-05', to: '2026-10-18' },
      search: null,
    });
  });

  it('takes 14 days from "from" when "to" is missing, and normalizes the search', () => {
    expect(parseExternalAgendaQuery({ from: '2026-12-25', q: ' Cumpleaños ' }, TODAY)).toEqual({
      range: { from: '2026-12-25', to: '2027-01-07' },
      search: 'cumpleanos',
    });
  });

  it('rejects bad dates, reversed ranges and ranges longer than a year', async () => {
    expect(
      (await catchError(() => parseExternalAgendaQuery({ from: '2026-02-30' }, TODAY))).field,
    ).toBe('from');
    expect(
      (
        await catchError(() =>
          parseExternalAgendaQuery({ from: '2026-10-10', to: '2026-10-09' }, TODAY),
        )
      ).code,
    ).toBe('invalid_range');
    expect(
      (
        await catchError(() =>
          parseExternalAgendaQuery({ from: '2026-01-01', to: '2027-01-02' }, TODAY),
        )
      ).code,
    ).toBe('invalid_range');
    expect(MAX_EXTERNAL_AGENDA_DAYS).toBe(366);
  });
});

describe('event bodies', () => {
  it('creates with defaults: all day, no note, no repeat', () => {
    expect(parseExternalEventCreate({ title: '  Turno   dentista ', date: '2026-10-09' })).toEqual({
      title: 'Turno dentista',
      date: '2026-10-09',
      time: null,
      note: null,
      repeat: 'NONE',
    });
  });

  it('accepts repeat in any case and a createdBy', () => {
    expect(
      parseExternalEventCreate({
        title: 'Cumple de Clari',
        date: '2026-03-14',
        repeat: 'yearly',
        createdBy: 'patodorf@gmail.com',
      }),
    ).toMatchObject({ repeat: 'YEARLY', createdBy: 'patodorf@gmail.com' });
  });

  it('rejects a bad time, an unknown field and a missing title', async () => {
    expect(
      (
        await catchError(() =>
          parseExternalEventCreate({ title: 'X', date: '2026-10-09', time: '25:00' }),
        )
      ).field,
    ).toBe('time');
    expect(
      (
        await catchError(() =>
          parseExternalEventCreate({ title: 'X', date: '2026-10-09', hora: '10:00' }),
        )
      ).code,
    ).toBe('validation_error');
    expect((await catchError(() => parseExternalEventCreate({ date: '2026-10-09' }))).field).toBe(
      'title',
    );
  });

  it('patches only what comes, and null time means all day', () => {
    expect(parseExternalEventPatch({ date: '2026-10-10' })).toEqual({ date: '2026-10-10' });
    expect(parseExternalEventPatch({ time: null })).toEqual({ time: null });
  });

  it('rejects an empty patch', async () => {
    expect((await catchError(() => parseExternalEventPatch({}))).code).toBe('validation_error');
  });
});

describe('listGroupAgenda', () => {
  it('reads only the group of the URL and serializes every kind', async () => {
    mockDb.calendarEvent.findMany.mockResolvedValue([eventRow()]);
    mockDb.document.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        name: 'Seguro del auto',
        mimeType: 'application/pdf',
        folderId: 4,
        // 2026-10-12 a las 00:00 en Argentina.
        expiresAt: new Date('2026-10-12T03:00:00Z'),
        folder: { name: 'Auto' },
      },
    ]);
    mockDb.expenseRecurrence.findMany.mockResolvedValue([
      {
        id: 8,
        job: { schedule: '0 15 7 * *' },
        expense: [
          { id: 'exp-1', name: 'Alquiler', amount: 50000000n, currency: 'ARS', category: 'rent' },
        ],
      },
    ]);

    const result = await listGroupAgenda(casa, {
      range: { from: '2026-10-05', to: '2026-10-18' },
      search: null,
    });

    expect(mockDb.calendarEvent.findMany.mock.calls[0][0].where.group).toEqual({ id: 1 });
    expect(mockDb.document.findMany.mock.calls[0][0].where.group).toEqual({ id: 1 });
    expect(mockDb.expenseRecurrence.findMany.mock.calls[0][0].where.expense.some).toEqual({
      deletedBy: null,
      groupId: 1,
    });
    expect(result.items).toEqual([
      {
        kind: 'recurring',
        date: '2026-10-07',
        time: null,
        title: 'Alquiler',
        expenseId: 'exp-1',
        amount: 500000,
        currency: 'ARS',
        category: 'rent',
      },
      {
        kind: 'event',
        date: '2026-10-09',
        time: '10:00',
        title: 'Viene el plomero',
        eventId: 10,
        note: null,
        repeat: 'none',
        startDate: '2026-10-09',
      },
      {
        kind: 'expiry',
        date: '2026-10-12',
        time: null,
        title: 'Seguro del auto',
        documentId: 'doc-1',
        folder: 'Auto',
      },
    ]);
  });

  it('filters by text without accents or case', async () => {
    mockDb.calendarEvent.findMany.mockResolvedValue([
      eventRow({ id: 1, title: 'Cumpleaños de Clari', repeat: 'YEARLY', time: null }),
      eventRow({ id: 2, title: 'Plomero' }),
    ]);

    const result = await listGroupAgenda(casa, {
      range: { from: '2026-10-05', to: '2026-10-18' },
      search: 'cumpleanos',
    });

    expect(result.items.map((item) => item.title)).toEqual(['Cumpleaños de Clari']);
  });
});

describe('createExternalEvent', () => {
  const input = {
    title: 'Viene el plomero',
    date: '2026-10-09',
    time: '10:00',
    note: null,
    repeat: 'NONE' as const,
    createdBy: 'patodorf@gmail.com',
  };

  it('creates the event with its author', async () => {
    mockDb.calendarEvent.findFirst.mockResolvedValue(null);
    mockDb.calendarEvent.create.mockResolvedValue(eventRow());

    const result = await createExternalEvent(casa, input);

    expect(result.created).toBe(true);
    expect(result.event).toMatchObject({
      id: 10,
      date: '2026-10-09',
      time: '10:00',
      repeat: 'none',
    });
    expect(mockDb.calendarEvent.create.mock.calls[0][0].data).toMatchObject({
      groupId: 1,
      createdById: 1,
      date: new Date('2026-10-09T00:00:00Z'),
    });
  });

  it('returns the existing one instead of duplicating', async () => {
    mockDb.calendarEvent.findFirst.mockResolvedValue(eventRow());

    const result = await createExternalEvent(casa, input);

    expect(result.created).toBe(false);
    expect(mockDb.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('rejects an author outside the group and archived groups', async () => {
    expect(
      (await catchError(() => createExternalEvent(casa, { ...input, createdBy: 'otro@x.com' })))
        .field,
    ).toBe('createdBy');
    expect((await catchError(() => createExternalEvent(archivado, input))).code).toBe(
      'group_archived',
    );
    expect(mockDb.calendarEvent.create).not.toHaveBeenCalled();
  });
});

describe('update and delete', () => {
  it('only touches events of the group in the URL', async () => {
    mockDb.calendarEvent.findFirst.mockResolvedValue(null);

    expect(
      (await catchError(() => updateExternalEvent(casa, 10, { date: '2026-10-10' }))).code,
    ).toBe('event_not_found');
    expect((await catchError(() => deleteExternalEvent(casa, 10))).code).toBe('event_not_found');
    expect(mockDb.calendarEvent.findFirst.mock.calls[0][0].where).toEqual({ id: 10, groupId: 1 });
    expect(mockDb.calendarEvent.update).not.toHaveBeenCalled();
    expect(mockDb.calendarEvent.delete).not.toHaveBeenCalled();
  });

  it('changes only the fields that come', async () => {
    mockDb.calendarEvent.findFirst.mockResolvedValue(eventRow());
    mockDb.calendarEvent.update.mockResolvedValue(eventRow({ time: null }));

    await updateExternalEvent(casa, 10, { time: null });

    expect(mockDb.calendarEvent.update.mock.calls[0][0].data).toEqual({ time: null });
  });

  it('deletes and returns what was deleted', async () => {
    mockDb.calendarEvent.findFirst.mockResolvedValue(eventRow());

    const event = await deleteExternalEvent(casa, 10);

    expect(event.title).toBe('Viene el plomero');
    expect(mockDb.calendarEvent.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  it('treats a non numeric id as not found', async () => {
    expect((await catchError(() => parseEventId('abc'))).code).toBe('event_not_found');
    expect(parseEventId('12')).toBe(12);
  });
});
