import {
  REMINDER_SNOOZE_MS,
  calendarDaysUntil,
  formatExpiryDate,
  isExpired,
  isReminderVisible,
  reminderWindowEnd,
} from '~/lib/documentReminders';
import {
  dismissReminder,
  findUpcomingExpiries,
  snoozeReminder,
} from '~/server/documents/reminders';

const UUID = '3f1c2a4e-1111-4222-8333-444455556666';

// 21/09/2026 12:00 en Buenos Aires (UTC-3).
const NOW = new Date('2026-09-21T15:00:00Z');
const at = (iso: string) => new Date(iso);

describe('calendarDaysUntil (Argentina calendar days)', () => {
  it.each([
    ['2026-09-21T15:00:00Z', 0],
    // 21/09 22:00 en Argentina (ya es 22/09 en UTC): sigue siendo hoy.
    ['2026-09-22T01:00:00Z', 0],
    // 22/09 00:30 en Argentina: mañana.
    ['2026-09-22T03:30:00Z', 1],
    ['2026-09-28T15:00:00Z', 7],
    ['2026-09-20T15:00:00Z', -1],
    ['2026-09-01T12:00:00Z', -20],
  ])('%s is %p days away', (expiresAt, expected) => {
    expect(calendarDaysUntil(at(expiresAt), NOW)).toBe(expected);
  });

  it('counts by calendar date, not by 24h blocks', () => {
    // 23:59 de hoy → 00:01 de mañana: dos minutos, pero un día de calendario.
    expect(calendarDaysUntil(at('2026-09-22T03:01:00Z'), at('2026-09-22T02:59:00Z'))).toBe(1);
  });
});

describe('formatExpiryDate / isExpired (Argentina calendar days)', () => {
  it.each([
    ['2027-08-12T15:00:00Z', '12/08/2027'],
    // Medianoche UTC = 21:00 del día anterior en Argentina.
    ['2027-08-12T00:00:00Z', '11/08/2027'],
    ['2024-04-19T03:00:00Z', '19/04/2024'],
  ])('%s is shown as %s', (expiresAt, expected) => {
    expect(formatExpiryDate(at(expiresAt))).toBe(expected);
  });

  it('counts as expired only from the next calendar day', () => {
    expect(isExpired(at('2026-09-21T23:00:00Z'), NOW)).toBe(false);
    expect(isExpired(at('2026-09-21T03:00:00Z'), NOW)).toBe(false);
    expect(isExpired(at('2026-09-21T02:59:00Z'), NOW)).toBe(true);
    expect(isExpired(at('2024-04-19T15:00:00Z'), NOW)).toBe(true);
    expect(isExpired(at('2027-08-12T15:00:00Z'), NOW)).toBe(false);
  });
});

describe('reminderWindowEnd', () => {
  it('is the start (Argentina) of the 8th day from today', () => {
    expect(reminderWindowEnd(NOW)).toEqual(at('2026-09-29T03:00:00Z'));
  });

  it('crosses month boundaries', () => {
    expect(reminderWindowEnd(at('2026-09-28T15:00:00Z'))).toEqual(at('2026-10-06T03:00:00Z'));
  });
});

describe('isReminderVisible', () => {
  const expiresAt = at('2026-09-24T15:00:00Z');

  it('shows documents expiring within 7 days, today, or already expired', () => {
    expect(isReminderVisible(expiresAt, null, NOW)).toBe(true);
    expect(isReminderVisible(at('2026-09-21T20:00:00Z'), null, NOW)).toBe(true);
    expect(isReminderVisible(at('2026-09-29T02:59:00Z'), null, NOW)).toBe(true);
    expect(isReminderVisible(at('2025-01-01T00:00:00Z'), null, NOW)).toBe(true);
  });

  it('hides documents further than 7 days or without expiry', () => {
    expect(isReminderVisible(at('2026-09-29T03:00:00Z'), null, NOW)).toBe(false);
    expect(isReminderVisible(null, null, NOW)).toBe(false);
  });

  it('hides snoozed reminders until the snooze ends', () => {
    const state = { snoozedUntil: at('2026-09-22T15:00:00Z'), dismissedForExpiresAt: null };

    expect(isReminderVisible(expiresAt, state, NOW)).toBe(false);
    expect(isReminderVisible(expiresAt, state, at('2026-09-22T15:00:01Z'))).toBe(true);
  });

  it('hides dismissed reminders only for the dismissed expiry date', () => {
    const state = { snoozedUntil: null, dismissedForExpiresAt: expiresAt };

    expect(isReminderVisible(expiresAt, state, NOW)).toBe(false);
    expect(isReminderVisible(at('2026-09-26T15:00:00Z'), state, NOW)).toBe(true);
  });
});

describe('findUpcomingExpiries', () => {
  const makeDb = (rows: unknown[]) => {
    const document = { findMany: jest.fn().mockResolvedValue(rows) };
    return { db: { document } as never, document };
  };

  const row = (
    id: string,
    expiresAt: string,
    reminders: { snoozedUntil: Date | null; dismissedForExpiresAt: Date | null }[] = [],
  ) => ({
    id,
    name: `Doc ${id}`,
    mimeType: 'application/pdf',
    folderId: 4,
    expiresAt: at(expiresAt),
    folder: { name: 'Kuga' },
    reminders,
  });

  it('queries only live documents of the user groups inside the window, with his state', async () => {
    const { db, document } = makeDb([]);

    await findUpcomingExpiries(db, 7, NOW);

    expect(document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          group: { groupUsers: { some: { userId: 7 } } },
          expiresAt: { not: null, lt: at('2026-09-29T03:00:00Z') },
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      }),
    );
    const { select } = document.findMany.mock.calls[0][0];
    expect(select.reminders).toEqual({
      where: { userId: 7 },
      select: { snoozedUntil: true, dismissedForExpiresAt: true },
    });
  });

  it('keeps upcoming and expired ones, drops snoozed and dismissed ones', async () => {
    const { db } = makeDb([
      row('expired', '2026-09-19T15:00:00Z'),
      row('today', '2026-09-22T01:00:00Z'),
      row('soon', '2026-09-24T15:00:00Z'),
      row('day7', '2026-09-28T23:00:00Z'),
      row('snoozed', '2026-09-23T15:00:00Z', [
        { snoozedUntil: at('2026-09-22T10:00:00Z'), dismissedForExpiresAt: null },
      ]),
      row('snooze-over', '2026-09-23T15:00:00Z', [
        { snoozedUntil: at('2026-09-21T10:00:00Z'), dismissedForExpiresAt: null },
      ]),
      row('dismissed', '2026-09-25T15:00:00Z', [
        { snoozedUntil: null, dismissedForExpiresAt: at('2026-09-25T15:00:00Z') },
      ]),
      row('dismissed-then-changed', '2026-09-26T15:00:00Z', [
        { snoozedUntil: null, dismissedForExpiresAt: at('2026-09-10T15:00:00Z') },
      ]),
    ]);

    const result = await findUpcomingExpiries(db, 7, NOW);

    expect(result.map(({ id, daysLeft }) => [id, daysLeft])).toEqual([
      ['expired', -2],
      ['today', 0],
      ['soon', 3],
      ['day7', 7],
      ['snooze-over', 2],
      ['dismissed-then-changed', 5],
    ]);
    expect(result[0]).toEqual({
      id: 'expired',
      name: 'Doc expired',
      mimeType: 'application/pdf',
      folderId: 4,
      folderName: 'Kuga',
      expiresAt: at('2026-09-19T15:00:00Z'),
      daysLeft: -2,
    });
  });
});

describe('snooze and dismiss', () => {
  const EXPIRES = at('2026-09-24T15:00:00Z');

  const makeDb = (found: unknown) => {
    const document = { findFirst: jest.fn().mockResolvedValue(found) };
    const documentReminderState = { upsert: jest.fn().mockResolvedValue({}) };
    return { db: { document, documentReminderState } as never, document, documentReminderState };
  };

  it('snoozes for one day, only after checking membership', async () => {
    const { db, document, documentReminderState } = makeDb({ id: UUID, expiresAt: EXPIRES });

    const result = await snoozeReminder(db, UUID, 7, NOW);

    const snoozedUntil = new Date(NOW.getTime() + REMINDER_SNOOZE_MS);
    expect(result).toEqual({ snoozedUntil });
    expect(document.findFirst).toHaveBeenCalledWith({
      where: { id: UUID, deletedAt: null, group: { groupUsers: { some: { userId: 7 } } } },
    });
    expect(documentReminderState.upsert).toHaveBeenCalledWith({
      where: { documentId_userId: { documentId: UUID, userId: 7 } },
      create: { documentId: UUID, userId: 7, snoozedUntil },
      update: { snoozedUntil },
    });
  });

  it('dismisses for the current expiry date', async () => {
    const { db, documentReminderState } = makeDb({ id: UUID, expiresAt: EXPIRES });

    await expect(dismissReminder(db, UUID, 7)).resolves.toEqual({
      dismissedForExpiresAt: EXPIRES,
    });
    expect(documentReminderState.upsert).toHaveBeenCalledWith({
      where: { documentId_userId: { documentId: UUID, userId: 7 } },
      create: { documentId: UUID, userId: 7, dismissedForExpiresAt: EXPIRES },
      update: { dismissedForExpiresAt: EXPIRES },
    });
  });

  it('does nothing for documents the user cannot see', async () => {
    const { db, documentReminderState } = makeDb(null);

    await expect(snoozeReminder(db, UUID, 7, NOW)).resolves.toBeNull();
    await expect(dismissReminder(db, UUID, 7)).resolves.toBeNull();
    await expect(snoozeReminder(db, '../etc', 7, NOW)).resolves.toBeNull();
    expect(documentReminderState.upsert).not.toHaveBeenCalled();
  });
});
