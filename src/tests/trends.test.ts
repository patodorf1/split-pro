import {
  TREND_VISIBLE_MONTHS,
  averageOfNonZero,
  categoryTrends,
  indexOfMonth,
  monthsEndingAt,
  trendWindowEnd,
} from '~/lib/trends';
import { parseEvolution } from '~/server/api/services/dolarBlueService';

jest.mock('~/server/db', () => ({ db: {} }));

describe('trendWindowEnd', () => {
  const current = { year: 2026, month: 9 };

  it('keeps the chart ending at the current month while the selection is visible', () => {
    expect(trendWindowEnd({ year: 2026, month: 3 }, current)).toEqual(current);
    expect(trendWindowEnd({ year: 2025, month: 10 }, current)).toEqual(current);
  });

  it('moves the chart back when the selection is older than the visible months', () => {
    expect(trendWindowEnd({ year: 2025, month: 9 }, current)).toEqual({ year: 2025, month: 9 });
  });
});

describe('monthsEndingAt', () => {
  it('lists the months oldest first, crossing the year', () => {
    const months = monthsEndingAt({ year: 2026, month: 2 }, TREND_VISIBLE_MONTHS);

    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 3 });
    expect(months.at(-1)).toEqual({ year: 2026, month: 2 });
    expect(indexOfMonth(months, { year: 2025, month: 12 })).toBe(9);
    expect(indexOfMonth(months, { year: 2024, month: 12 })).toBe(-1);
  });
});

describe('averageOfNonZero', () => {
  it('ignores empty months', () => {
    expect(averageOfNonZero([0n, 100n, 300n])).toBe(200n);
    expect(averageOfNonZero([0n, 0n])).toBe(0n);
  });
});

describe('categoryTrends', () => {
  it('compares the month against the average of the three previous ones', () => {
    const [trend] = categoryTrends([{ category: 'food', values: [100n, 200n, 300n, 300n] }], 3);

    expect(trend).toEqual({ category: 'food', current: 300n, baseline: 200n, change: 50 });
  });

  it('marks categories without history as new and drops the ones without spending', () => {
    const trends = categoryTrends(
      [
        { category: 'new', values: [0n, 0n, 0n, 500n] },
        { category: 'none', values: [0n, 0n, 0n, 0n] },
      ],
      3,
    );

    expect(trends).toEqual([{ category: 'new', current: 500n, baseline: 0n, change: null }]);
  });

  it('sorts by how much money each category went up', () => {
    const trends = categoryTrends(
      [
        { category: 'small', values: [100n, 100n, 100n, 300n] },
        { category: 'big', values: [10000n, 10000n, 10000n, 12000n] },
        { category: 'down', values: [500n, 500n, 500n, 100n] },
      ],
      3,
    );

    expect(trends.map(({ category }) => category)).toEqual(['big', 'small', 'down']);
  });
});

describe('parseEvolution', () => {
  it('keeps only valid blue rows, one per day, oldest first', () => {
    expect(
      parseEvolution([
        { date: '2026-09-25', source: 'Blue', value_sell: 1560, value_buy: 1513 },
        { date: '2026-09-25', source: 'Oficial', value_sell: 1538, value_buy: 1486 },
        { date: '2026-09-24', source: 'Blue', value_sell: 1555, value_buy: 1510 },
        { date: 'ayer', source: 'Blue', value_sell: 1, value_buy: 1 },
        { date: '2026-09-23', source: 'Blue', value_sell: 0, value_buy: 0 },
      ]),
    ).toEqual([
      { date: '2026-09-24', buy: 1510, sell: 1555 },
      { date: '2026-09-25', buy: 1513, sell: 1560 },
    ]);
  });

  it('returns nothing for an unexpected payload', () => {
    expect(parseEvolution({ error: 'down' })).toEqual([]);
  });
});
