import {
  addDaysToKey,
  calendarEventFieldsSchema,
  compareAgendaItems,
  expandOccurrences,
  monthGrid,
  parseDay,
  rangeLength,
  upcomingRange,
} from '~/lib/agenda';
import { cronOccurrencesBetween } from '~/lib/cron';
import { calendarRouter } from '~/server/api/routers/calendar';

// El router importa el contexto de tRPC, que trae la sesión y el cliente de la base: acá se usa
// Una base falsa por test. superjson es ESM puro y la llamada directa no serializa nada.
jest.mock('~/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('~/server/db', () => ({ db: {} }));
jest.mock('superjson', () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => ({ json: value }),
    deserialize: (value: unknown) => value,
  },
}));

const MEMBER_FILTER = { groupUsers: { some: { userId: 7 } } };

describe('calendar days', () => {
  it('parses valid days and rejects impossible ones', () => {
    expect(parseDay('2026-10-05')).toEqual({ year: 2026, month: 10, day: 5 });
    expect(parseDay('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDay('2026-02-29')).toBeNull();
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('2026-1-1')).toBeNull();
  });

  it('adds days across months and years', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('measures ranges with both ends included', () => {
    expect(rangeLength({ from: '2026-10-05', to: '2026-10-05' })).toBe(1);
    expect(rangeLength({ from: '2026-12-28', to: '2027-01-03' })).toBe(7);
    expect(rangeLength({ from: '2026-10-06', to: '2026-10-05' })).toBe(0);
  });
});

describe('monthGrid', () => {
  it('starts on Monday and ends on Sunday', () => {
    // Octubre 2026 empieza un jueves y termina un sábado.
    const grid = monthGrid(2026, 10);
    expect(grid.from).toBe('2026-09-28');
    expect(grid.to).toBe('2026-11-01');
    expect(grid.days).toHaveLength(35);
  });

  it('handles a month that crosses into the next year', () => {
    const grid = monthGrid(2026, 12);
    expect(grid.from).toBe('2026-11-30');
    expect(grid.to).toBe('2027-01-03');
    expect(grid.days[0]).toBe('2026-11-30');
    expect(grid.days.at(-1)).toBe('2027-01-03');
    expect(grid.days).toHaveLength(35);
  });

  it('handles a month that starts the year', () => {
    // Enero 2027 empieza un viernes: la grilla arranca en diciembre.
    const grid = monthGrid(2027, 1);
    expect(grid.from).toBe('2026-12-28');
    expect(grid.to).toBe('2027-01-31');
  });

  it('uses exactly four weeks when the month fits (February 2027)', () => {
    const grid = monthGrid(2027, 2);
    expect(grid.from).toBe('2027-02-01');
    expect(grid.to).toBe('2027-02-28');
    expect(grid.days).toHaveLength(28);
  });

  it('uses six weeks when needed', () => {
    // Agosto 2026 empieza un sábado y tiene 31 días.
    expect(monthGrid(2026, 8).days).toHaveLength(42);
  });
});

describe('upcomingRange', () => {
  it('covers 14 days including today, across the new year', () => {
    expect(upcomingRange('2026-12-25')).toEqual({ from: '2026-12-25', to: '2027-01-07' });
  });
});

describe('expandOccurrences', () => {
  const range = { from: '2026-09-28', to: '2026-11-01' };

  it('returns a one-off event only inside the range', () => {
    expect(expandOccurrences({ date: '2026-10-10', repeat: 'NONE' }, range)).toEqual([
      '2026-10-10',
    ]);
    expect(expandOccurrences({ date: '2026-11-02', repeat: 'NONE' }, range)).toEqual([]);
    expect(expandOccurrences({ date: '2026-09-27', repeat: 'NONE' }, range)).toEqual([]);
  });

  it('repeats weekly on the same weekday, never before the start', () => {
    expect(expandOccurrences({ date: '2026-10-07', repeat: 'WEEKLY' }, range)).toEqual([
      '2026-10-07',
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
    // Empezó antes del rango: arranca en el primer miércoles del rango.
    expect(expandOccurrences({ date: '2026-01-07', repeat: 'WEEKLY' }, range)).toEqual([
      '2026-09-30',
      '2026-10-07',
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
  });

  it('repeats monthly on the same day, including the grid days of other months', () => {
    expect(expandOccurrences({ date: '2026-01-29', repeat: 'MONTHLY' }, range)).toEqual([
      '2026-09-29',
      '2026-10-29',
    ]);
  });

  it('moves a monthly event on the 31st to the last day of shorter months', () => {
    const occurrences = expandOccurrences(
      { date: '2026-01-31', repeat: 'MONTHLY' },
      { from: '2026-01-01', to: '2026-05-31' },
    );
    expect(occurrences).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    // En años bisiestos, febrero cae el 29.
    expect(
      expandOccurrences(
        { date: '2027-12-31', repeat: 'MONTHLY' },
        { from: '2028-02-01', to: '2028-02-29' },
      ),
    ).toEqual(['2028-02-29']);
  });

  it('repeats yearly (birthdays), across the new year', () => {
    expect(
      expandOccurrences(
        { date: '1990-01-02', repeat: 'YEARLY' },
        { from: '2026-12-28', to: '2027-01-03' },
      ),
    ).toEqual(['2027-01-02']);
    expect(
      expandOccurrences(
        { date: '1990-12-30', repeat: 'YEARLY' },
        { from: '2026-12-28', to: '2027-01-03' },
      ),
    ).toEqual(['2026-12-30']);
  });

  it('puts a February 29 birthday on February 28 in common years', () => {
    const feb = (year: number) => ({ from: `${year}-02-01`, to: `${year}-03-01` });
    expect(expandOccurrences({ date: '2024-02-29', repeat: 'YEARLY' }, feb(2026))).toEqual([
      '2026-02-28',
    ]);
    expect(expandOccurrences({ date: '2024-02-29', repeat: 'YEARLY' }, feb(2028))).toEqual([
      '2028-02-29',
    ]);
  });

  it('never shows a yearly event before the year it was created', () => {
    expect(
      expandOccurrences(
        { date: '2027-10-10', repeat: 'YEARLY' },
        { from: '2026-10-01', to: '2026-10-31' },
      ),
    ).toEqual([]);
  });
});

describe('calendar event validation', () => {
  const VALID = { title: 'Turno médico', date: '2026-10-05', time: '', note: '', repeat: 'NONE' };

  it('stores empty time and note as null and trims the title', () => {
    expect(calendarEventFieldsSchema.parse({ ...VALID, title: '  Turno   médico ' })).toEqual({
      title: 'Turno médico',
      date: '2026-10-05',
      time: null,
      note: null,
      repeat: 'NONE',
    });
  });

  it.each(['09:30', '00:00', '23:59'])('accepts time %p', (time) => {
    expect(calendarEventFieldsSchema.parse({ ...VALID, time }).time).toBe(time);
  });

  it.each(['9:30', '24:00', '12:60', 'mañana'])('rejects time %p', (time) => {
    expect(calendarEventFieldsSchema.safeParse({ ...VALID, time }).success).toBe(false);
  });

  it('rejects an empty title, an impossible date and an unknown repeat', () => {
    expect(calendarEventFieldsSchema.safeParse({ ...VALID, title: '  ' }).success).toBe(false);
    expect(calendarEventFieldsSchema.safeParse({ ...VALID, date: '2026-02-29' }).success).toBe(
      false,
    );
    expect(calendarEventFieldsSchema.safeParse({ ...VALID, repeat: 'DAILY' }).success).toBe(false);
  });
});

describe('compareAgendaItems', () => {
  it('sorts by day, then all-day first, then by time', () => {
    const items = [
      { date: '2026-10-06', time: null, kind: 'event' as const, title: 'B' },
      { date: '2026-10-05', time: '18:00', kind: 'event' as const, title: 'C' },
      { date: '2026-10-05', time: null, kind: 'recurring' as const, title: 'Alquiler' },
      { date: '2026-10-05', time: null, kind: 'event' as const, title: 'Cumple' },
      { date: '2026-10-05', time: '09:00', kind: 'event' as const, title: 'A' },
    ];
    expect(items.sort(compareAgendaItems).map((item) => item.title)).toEqual([
      'Cumple',
      'Alquiler',
      'A',
      'C',
      'B',
    ]);
  });
});

describe('cronOccurrencesBetween', () => {
  it('lists every run of a monthly cron inside the range (UTC, half-open)', () => {
    // Día 5 de cada mes a las 15:00 UTC (= 12:00 en Argentina).
    const runs = cronOccurrencesBetween(
      '0 15 5 * *',
      new Date('2026-09-28T03:00:00Z'),
      new Date('2026-11-02T03:00:00Z'),
    );
    expect(runs.map((run) => run.toISOString())).toEqual(['2026-10-05T15:00:00.000Z']);
  });

  it('understands the "$" (last day of month) used in the database', () => {
    const runs = cronOccurrencesBetween(
      '0 3 $ * *',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(runs.map((run) => run.toISOString())).toEqual([
      '2026-01-31T03:00:00.000Z',
      '2026-02-28T03:00:00.000Z',
    ]);
  });
});

const EVENT_ROW = {
  id: 3,
  groupId: 1,
  title: 'Cumple de mamá',
  date: new Date('1960-10-12T00:00:00Z'),
  time: null,
  note: null,
  repeat: 'YEARLY',
};

const makeDb = ({ found = null as unknown, member = true } = {}) => {
  const calendarEvent = {
    findMany: jest.fn().mockResolvedValue([EVENT_ROW]),
    findFirst: jest.fn().mockResolvedValue(found),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data })),
    update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 3, ...data })),
    delete: jest.fn().mockResolvedValue({}),
  };
  const document = {
    findMany: jest.fn().mockResolvedValue([
      {
        id: 'doc-1',
        name: 'Seguro del auto',
        mimeType: 'application/pdf',
        folderId: 4,
        // 2026-10-20 a las 00:00 en Argentina.
        expiresAt: new Date('2026-10-20T03:00:00Z'),
        folder: { name: 'Auto' },
      },
    ]),
  };
  const expenseRecurrence = {
    findMany: jest.fn().mockResolvedValue([
      {
        id: 8,
        job: { schedule: '0 15 5 * *' },
        expense: [
          { id: 'exp-1', name: 'Alquiler', amount: 50000n, currency: 'ARS', category: 'rent' },
        ],
      },
    ]),
  };
  const groupUser = { findFirst: jest.fn().mockResolvedValue(member ? { groupId: 1 } : null) };
  const group = { findMany: jest.fn().mockResolvedValue([]) };

  return { calendarEvent, document, expenseRecurrence, groupUser, group };
};

const callerFor = (db: ReturnType<typeof makeDb>, userId: number | null = 7) =>
  calendarRouter.createCaller({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sesión mínima de prueba
    session: null === userId ? null : ({ user: { id: userId }, expires: '' } as never),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- base falsa de prueba
    db: db as never,
  });

const RANGE = { from: '2026-09-28', to: '2026-11-01', timeZone: 'America/Buenos_Aires' };

describe('calendar router', () => {
  it('returns events, expiries and recurring expenses of the range, sorted', async () => {
    const db = makeDb();
    const items = await callerFor(db).range(RANGE);

    expect(items.map((item) => [item.kind, item.date, item.title])).toEqual([
      ['recurring', '2026-10-05', 'Alquiler'],
      ['event', '2026-10-12', 'Cumple de mamá'],
      ['expiry', '2026-10-20', 'Seguro del auto'],
    ]);
    // Todo filtrado por membresía del grupo.
    expect(db.calendarEvent.findMany.mock.calls[0][0].where.group).toEqual(MEMBER_FILTER);
    expect(db.document.findMany.mock.calls[0][0].where.group).toEqual(MEMBER_FILTER);
    expect(
      db.expenseRecurrence.findMany.mock.calls[0][0].where.expense.some.expenseParticipants,
    ).toEqual({ some: { userId: 7 } });
  });

  it('still answers when recurring expenses cannot be read', async () => {
    const db = makeDb();
    db.expenseRecurrence.findMany.mockRejectedValue(
      new Error('relation "cron.job" does not exist'),
    );
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const items = await callerFor(db).range(RANGE);

    expect(items.map((item) => item.kind)).toEqual(['event', 'expiry']);
    spy.mockRestore();
  });

  it('rejects ranges that are reversed or too long', async () => {
    const caller = callerFor(makeDb());
    await expect(caller.range({ ...RANGE, from: '2026-11-02' })).rejects.toThrow('invalid_range');
    await expect(caller.range({ ...RANGE, to: '2027-01-31' })).rejects.toThrow('invalid_range');
  });

  it('requires a session', async () => {
    await expect(callerFor(makeDb(), null).range(RANGE)).rejects.toThrow();
  });

  it('creates an event only in a group the user belongs to', async () => {
    const db = makeDb();
    await callerFor(db).create({
      groupId: 1,
      title: 'Visita',
      date: '2026-10-10',
      time: '18:30',
      note: '',
      repeat: 'NONE',
    });
    expect(db.calendarEvent.create.mock.calls[0][0].data).toMatchObject({
      groupId: 1,
      title: 'Visita',
      date: new Date('2026-10-10T00:00:00Z'),
      time: '18:30',
      note: null,
      createdById: 7,
    });

    const outsider = makeDb({ member: false });
    await expect(
      callerFor(outsider).create({
        groupId: 2,
        title: 'Visita',
        date: '2026-10-10',
        time: null,
        note: null,
        repeat: 'NONE',
      }),
    ).rejects.toThrow('Not found');
    expect(outsider.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('updates and deletes only accessible events', async () => {
    const db = makeDb({ found: { id: 3, groupId: 1 } });
    await callerFor(db).update({
      id: 3,
      title: 'Cumple',
      date: '1960-10-12',
      time: null,
      note: null,
      repeat: 'YEARLY',
    });
    expect(db.calendarEvent.findFirst.mock.calls[0][0].where).toEqual({
      id: 3,
      group: MEMBER_FILTER,
    });
    await callerFor(db).delete({ id: 3 });
    expect(db.calendarEvent.delete).toHaveBeenCalledWith({ where: { id: 3 } });

    const missing = makeDb();
    await expect(callerFor(missing).delete({ id: 3 })).rejects.toThrow('Not found');
    expect(missing.calendarEvent.delete).not.toHaveBeenCalled();
  });
});
