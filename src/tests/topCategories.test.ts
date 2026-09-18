import {
  TOP_CATEGORIES_LIMIT,
  TOP_CATEGORIES_RECENT_MONTHS,
  monthsAgo,
  rankTopCategories,
} from '~/lib/topCategories';

describe('rankTopCategories', () => {
  it('should order the recent categories by usage, most used first', () => {
    const recent = [
      { category: 'fuel', count: 3 },
      { category: 'groceries', count: 10 },
      { category: 'diningOut', count: 7 },
    ];

    expect(rankTopCategories(recent)).toEqual(['groceries', 'diningOut', 'fuel']);
  });

  it('should keep at most six categories', () => {
    const recent = [
      { category: 'groceries', count: 10 },
      { category: 'diningOut', count: 9 },
      { category: 'fuel', count: 8 },
      { category: 'services', count: 7 },
      { category: 'electricity', count: 6 },
      { category: 'cleaning', count: 5 },
      { category: 'childcare', count: 4 },
    ];

    expect(rankTopCategories(recent)).toHaveLength(TOP_CATEGORIES_LIMIT);
    expect(rankTopCategories(recent)).not.toContain('childcare');
  });

  it('should break ties alphabetically so the row does not jump between reloads', () => {
    const recent = [
      { category: 'fuel', count: 4 },
      { category: 'childcare', count: 4 },
      { category: 'groceries', count: 4 },
    ];

    expect(rankTopCategories(recent)).toEqual(['childcare', 'fuel', 'groceries']);
  });

  it('should drop the default category, unknown values and categories without usage', () => {
    const recent = [
      { category: 'general', count: 99 },
      { category: 'notACategory', count: 50 },
      { category: 'fuel', count: 0 },
      { category: 'groceries', count: 2 },
    ];

    expect(rankTopCategories(recent)).toEqual(['groceries']);
  });

  it('should complete with the whole history when the recent window is short', () => {
    const recent = [
      { category: 'groceries', count: 5 },
      { category: 'diningOut', count: 2 },
    ];
    const allTime = [
      { category: 'diningOut', count: 40 },
      { category: 'groceries', count: 30 },
      { category: 'rent', count: 20 },
      { category: 'electricity', count: 10 },
    ];

    expect(rankTopCategories(recent, allTime)).toEqual([
      'groceries',
      'diningOut',
      'rent',
      'electricity',
    ]);
  });

  it('should not touch the recent order when the history already covers the limit', () => {
    const recent = [
      { category: 'groceries', count: 1 },
      { category: 'diningOut', count: 2 },
      { category: 'fuel', count: 3 },
      { category: 'services', count: 4 },
      { category: 'electricity', count: 5 },
      { category: 'cleaning', count: 6 },
    ];
    const allTime = [{ category: 'rent', count: 999 }];

    expect(rankTopCategories(recent, allTime)).toEqual([
      'cleaning',
      'electricity',
      'services',
      'fuel',
      'diningOut',
      'groceries',
    ]);
  });

  it('should return nothing when there is no usable category at all', () => {
    expect(rankTopCategories([], [])).toEqual([]);
    expect(rankTopCategories([{ category: 'general', count: 10 }], [])).toEqual([]);
  });

  it('should respect a custom limit', () => {
    const recent = [
      { category: 'groceries', count: 3 },
      { category: 'diningOut', count: 2 },
      { category: 'fuel', count: 1 },
    ];

    expect(rankTopCategories(recent, [], 2)).toEqual(['groceries', 'diningOut']);
  });
});

describe('monthsAgo', () => {
  it('should go back the given amount of months', () => {
    expect(monthsAgo(TOP_CATEGORIES_RECENT_MONTHS, new Date('2026-09-18T12:00:00.000Z'))).toEqual(
      new Date('2025-09-18T12:00:00.000Z'),
    );
  });

  it('should not mutate the received date', () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    monthsAgo(12, now);

    expect(now.toISOString()).toBe('2026-09-18T12:00:00.000Z');
  });
});
