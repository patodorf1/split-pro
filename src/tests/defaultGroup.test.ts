import {
  pickDefaultGroup,
  resolveDefaultForAddToggle,
  resolveGroupCurrency,
  shouldPreselectDefaultGroup,
} from '~/lib/defaultGroup';

describe('resolveDefaultForAddToggle', () => {
  it('should activate the group and clear every other default of the user', () => {
    const rows = [
      { groupId: 1, defaultForAdd: false },
      { groupId: 2, defaultForAdd: true },
      { groupId: 3, defaultForAdd: false },
    ];

    expect(resolveDefaultForAddToggle(rows, 1)).toEqual({
      defaultForAdd: true,
      groupIdsToClear: [2],
    });
  });

  it('should clear several stale defaults at once', () => {
    const rows = [
      { groupId: 1, defaultForAdd: false },
      { groupId: 2, defaultForAdd: true },
      { groupId: 3, defaultForAdd: true },
    ];

    expect(resolveDefaultForAddToggle(rows, 1)).toEqual({
      defaultForAdd: true,
      groupIdsToClear: [2, 3],
    });
  });

  it('should not clear anything when turning the default off', () => {
    const rows = [
      { groupId: 1, defaultForAdd: true },
      { groupId: 2, defaultForAdd: false },
    ];

    expect(resolveDefaultForAddToggle(rows, 1)).toEqual({
      defaultForAdd: false,
      groupIdsToClear: [],
    });
  });

  it('should leave the toggled group out of the groups to clear', () => {
    const rows = [{ groupId: 1, defaultForAdd: false }];

    expect(resolveDefaultForAddToggle(rows, 1)).toEqual({
      defaultForAdd: true,
      groupIdsToClear: [],
    });
  });

  it('should return null when the user is not a member of the group', () => {
    const rows = [{ groupId: 1, defaultForAdd: true }];

    expect(resolveDefaultForAddToggle(rows, 99)).toBeNull();
  });
});

describe('pickDefaultGroup', () => {
  it('should return the group flagged as default', () => {
    const rows = [
      { groupId: 1, defaultForAdd: false },
      { groupId: 2, defaultForAdd: true },
    ];

    expect(pickDefaultGroup(rows)).toEqual({ groupId: 2, defaultForAdd: true });
  });

  it('should return undefined when no group is flagged', () => {
    expect(pickDefaultGroup([{ groupId: 1, defaultForAdd: false }])).toBeUndefined();
  });

  it('should return undefined while the groups are still loading', () => {
    expect(pickDefaultGroup(undefined)).toBeUndefined();
  });

  it('should keep the first one if the data somehow has more than one default', () => {
    const rows = [
      { groupId: 2, defaultForAdd: true },
      { groupId: 3, defaultForAdd: true },
    ];

    expect(pickDefaultGroup(rows)).toEqual({ groupId: 2, defaultForAdd: true });
  });
});

describe('shouldPreselectDefaultGroup', () => {
  const base = { isReady: true, alreadyApplied: false, query: {} };

  it('should preselect on a blank add page', () => {
    expect(shouldPreselectDefaultGroup(base)).toBe(true);
  });

  it('should still preselect when only description and category are in the URL', () => {
    // La lista de compras abre /add?description=Yerba&category=groceries
    expect(shouldPreselectDefaultGroup({ ...base, query: {} })).toBe(true);
  });

  it.each([
    ['groupId', { groupId: '3' }],
    ['friendId', { friendId: '2' }],
    ['expenseId', { expenseId: 'abc' }],
  ])('should not preselect when the URL already has %s', (_name, query) => {
    expect(shouldPreselectDefaultGroup({ ...base, query })).toBe(false);
  });

  it('should not preselect before the router is ready', () => {
    expect(shouldPreselectDefaultGroup({ ...base, isReady: false })).toBe(false);
  });

  it('should not preselect twice, so removing the group keeps it removed', () => {
    expect(shouldPreselectDefaultGroup({ ...base, alreadyApplied: true })).toBe(false);
  });
});

describe('resolveGroupCurrency', () => {
  it('should prefer the currency the user is already using', () => {
    expect(
      resolveGroupCurrency({ currency: 'ARS', defaultCurrency: 'EUR' }, { defaultCurrency: 'USD' }),
    ).toBe('ARS');
  });

  it('should fall back to the group currency', () => {
    expect(
      resolveGroupCurrency({ currency: null, defaultCurrency: 'EUR' }, { defaultCurrency: 'USD' }),
    ).toBe('USD');
  });

  it('should fall back to the user default currency', () => {
    expect(
      resolveGroupCurrency({ currency: null, defaultCurrency: 'EUR' }, { defaultCurrency: null }),
    ).toBe('EUR');
  });

  it('should return undefined when nothing is set', () => {
    expect(resolveGroupCurrency({}, {})).toBeUndefined();
  });
});
