import {
  addMonths,
  compareYearMonth,
  computeShare,
  getCategoryTranslationKey,
  getCurrentYearMonth,
  getMonthRange,
  monthOverMonthChange,
  percentageOf,
  toUtcTimestampLiteral,
  zonedStartOfMonth,
} from '~/lib/stats';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

describe('computeShare', () => {
  it('returns amount minus the stored value for the payer', () => {
    // 49.343,00 split equally: the payer row stores 24.671,50
    expect(
      computeShare({
        expenseAmount: 4934300n,
        paidBy: 2,
        userId: 2,
        participantAmount: 2467150n,
      }),
    ).toBe(2467150n);
  });

  it('flips the sign for the non-payers', () => {
    expect(
      computeShare({
        expenseAmount: 4934300n,
        paidBy: 2,
        userId: 1,
        participantAmount: -2467150n,
      }),
    ).toBe(2467150n);
  });

  it('handles unequal splits', () => {
    // 100,00 paid by user 1, who only owes 30,00
    expect(
      computeShare({ expenseAmount: 10000n, paidBy: 1, userId: 1, participantAmount: 7000n }),
    ).toBe(3000n);
    expect(
      computeShare({ expenseAmount: 10000n, paidBy: 1, userId: 2, participantAmount: -7000n }),
    ).toBe(7000n);
  });

  it('shares of every participant add up to the expense amount', () => {
    const amount = 10000n;
    const rows = [
      { userId: 1, participantAmount: 6000n },
      { userId: 2, participantAmount: -2500n },
      { userId: 3, participantAmount: -3500n },
    ];

    const total = rows.reduce(
      (acc, row) =>
        acc +
        computeShare({
          expenseAmount: amount,
          paidBy: 1,
          userId: row.userId,
          participantAmount: row.participantAmount,
        }),
      0n,
    );

    expect(total).toBe(amount);
  });

  it('returns zero when the user does not take part in the expense', () => {
    expect(
      computeShare({ expenseAmount: 10000n, paidBy: 1, userId: 9, participantAmount: undefined }),
    ).toBe(0n);
  });
});

describe('month boundaries', () => {
  it('starts the month at local midnight in the user time zone', () => {
    expect(zonedStartOfMonth(2026, 8, BUENOS_AIRES).toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('returns a half-open range covering the whole month', () => {
    const { from, to } = getMonthRange(2026, 8, BUENOS_AIRES);

    expect(from.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('keeps imported expenses (15:00 UTC) inside their local month', () => {
    const { from, to } = getMonthRange(2026, 8, BUENOS_AIRES);
    const firstOfAugust = new Date('2026-08-01T15:00:00.000Z');
    const lastOfJuly = new Date('2026-07-31T15:00:00.000Z');

    expect(firstOfAugust >= from && firstOfAugust < to).toBe(true);
    expect(lastOfJuly >= from && lastOfJuly < to).toBe(false);
  });

  it('rolls over the year in December', () => {
    const { from, to } = getMonthRange(2026, 12, BUENOS_AIRES);

    expect(from.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('respects daylight saving time in zones that use it', () => {
    // Madrid is UTC+1 in winter and UTC+2 in summer.
    expect(zonedStartOfMonth(2026, 1, 'Europe/Madrid').toISOString()).toBe(
      '2025-12-31T23:00:00.000Z',
    );
    expect(zonedStartOfMonth(2026, 7, 'Europe/Madrid').toISOString()).toBe(
      '2026-06-30T22:00:00.000Z',
    );
  });

  it('falls back to UTC for an unknown time zone', () => {
    expect(zonedStartOfMonth(2026, 8, 'Not/AZone').toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('serializes a range boundary as a UTC wall-clock literal', () => {
    expect(toUtcTimestampLiteral(new Date('2026-08-01T03:00:00.000Z'))).toBe(
      '2026-08-01T03:00:00.000',
    );
  });

  it('reads the current month in the user time zone', () => {
    // 2026-01-01 01:00 UTC is still 2025-12-31 22:00 in Buenos Aires.
    expect(getCurrentYearMonth(BUENOS_AIRES, new Date('2026-01-01T01:00:00.000Z'))).toEqual({
      year: 2025,
      month: 12,
    });
    expect(getCurrentYearMonth(BUENOS_AIRES, new Date('2026-01-01T04:00:00.000Z'))).toEqual({
      year: 2026,
      month: 1,
    });
  });
});

describe('month arithmetic', () => {
  it('moves forwards and backwards across year boundaries', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 });
  });

  it('orders year-months', () => {
    expect(compareYearMonth({ year: 2026, month: 9 }, { year: 2026, month: 9 })).toBe(0);
    expect(compareYearMonth({ year: 2026, month: 10 }, { year: 2026, month: 9 })).toBeGreaterThan(
      0,
    );
    expect(compareYearMonth({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBeLessThan(0);
  });
});

describe('percentages', () => {
  it('computes the share of a total', () => {
    expect(percentageOf(5000n, 10000n)).toBe(50);
    expect(Math.round(percentageOf(2105000n, 60348617n))).toBe(3);
  });

  it('returns zero instead of dividing by zero', () => {
    expect(percentageOf(5000n, 0n)).toBe(0);
  });

  it('computes the variation against the previous month', () => {
    expect(monthOverMonthChange(12000n, 10000n)).toBeCloseTo(20);
    expect(monthOverMonthChange(8000n, 10000n)).toBeCloseTo(-20);
    expect(monthOverMonthChange(10000n, 10000n)).toBe(0);
  });

  it('has no variation to report when the previous month is empty', () => {
    expect(monthOverMonthChange(10000n, 0n)).toBeNull();
  });
});

describe('category labels', () => {
  it('resolves a leaf category inside its section', () => {
    expect(getCategoryTranslationKey('groceries')).toBe('categories_list.food.items.groceries');
    expect(getCategoryTranslationKey('electricity')).toBe(
      'categories_list.utilities.items.electricity',
    );
  });

  it('resolves a section picked as "other"', () => {
    expect(getCategoryTranslationKey('general')).toBe('categories_list.general.name');
    expect(getCategoryTranslationKey('travel')).toBe('categories_list.travel.name');
  });

  it('falls back to the default category for unknown values', () => {
    expect(getCategoryTranslationKey('definitely-not-a-category')).toBe(
      'categories_list.general.name',
    );
  });
});
