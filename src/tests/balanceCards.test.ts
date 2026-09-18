import {
  type BalanceCardGroup,
  type BalancePerson,
  balanceSentence,
  buildBalanceCards,
} from '~/lib/balanceCards';

const PATO: BalancePerson = { id: 1, name: 'Pato', email: 'pato@example.com', image: null };
const BELEN: BalancePerson = { id: 2, name: 'Belén', email: 'belen@example.com', image: null };
const CARLA: BalancePerson = { id: 3, name: 'Carla', email: null, image: null };
const PEOPLE = { 1: PATO, 2: BELEN, 3: CARLA };

const CASA: BalanceCardGroup = {
  id: 1,
  name: 'Casa',
  image: null,
  defaultCurrency: 'ARS',
  pinned: false,
  memberIds: [1, 2],
};
const USD: BalanceCardGroup = {
  id: 2,
  name: 'USD',
  image: 'group.png',
  defaultCurrency: 'USD',
  pinned: false,
  memberIds: [1, 2],
};

describe('buildBalanceCards', () => {
  it('should build one card per group and currency, with the other member as counterpart', () => {
    const cards = buildBalanceCards({
      userId: 1,
      groups: [CASA, USD],
      rows: [
        { groupId: 1, friendId: 2, currency: 'ARS', amount: 26258369n },
        { groupId: 2, friendId: 2, currency: 'USD', amount: -109493n },
      ],
      people: PEOPLE,
    });

    expect(cards).toEqual([
      {
        key: 'group-1-ARS',
        kind: 'group',
        href: '/groups/1',
        name: 'Casa',
        image: null,
        currency: 'ARS',
        amount: 26258369n,
        counterpart: BELEN,
      },
      {
        key: 'group-2-USD',
        kind: 'group',
        href: '/groups/2',
        name: 'USD',
        image: 'group.png',
        currency: 'USD',
        amount: -109493n,
        counterpart: BELEN,
      },
    ]);
  });

  it('should show the mirrored balance from the other member side', () => {
    const cards = buildBalanceCards({
      userId: 2,
      groups: [CASA],
      rows: [{ groupId: 1, friendId: 1, currency: 'ARS', amount: -26258369n }],
      people: PEOPLE,
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]!.amount).toBe(-26258369n);
    expect(cards[0]!.counterpart).toBe(PATO);
  });

  it('should keep a settled group as a single zero card in its default currency', () => {
    const cards = buildBalanceCards({
      userId: 1,
      groups: [CASA],
      rows: [{ groupId: 1, friendId: 2, currency: 'ARS', amount: 0n }],
      people: PEOPLE,
    });

    expect(cards).toEqual([
      expect.objectContaining({ key: 'group-1', currency: 'ARS', amount: 0n }),
    ]);
  });

  it('should add up every friend of a group and drop the counterpart when there are several', () => {
    const cards = buildBalanceCards({
      userId: 1,
      groups: [{ ...CASA, memberIds: [1, 2, 3] }],
      rows: [
        { groupId: 1, friendId: 2, currency: 'ARS', amount: 500n },
        { groupId: 1, friendId: 3, currency: 'ARS', amount: -200n },
      ],
      people: PEOPLE,
    });

    expect(cards).toEqual([
      expect.objectContaining({ amount: 300n, counterpart: null, currency: 'ARS' }),
    ]);
  });

  it('should list the default currency first and then the rest alphabetically', () => {
    const cards = buildBalanceCards({
      userId: 1,
      groups: [CASA],
      rows: [
        { groupId: 1, friendId: 2, currency: 'USD', amount: 10n },
        { groupId: 1, friendId: 2, currency: 'EUR', amount: 10n },
        { groupId: 1, friendId: 2, currency: 'ARS', amount: 10n },
      ],
      people: PEOPLE,
    });

    expect(cards.map(({ currency }) => currency)).toEqual(['ARS', 'EUR', 'USD']);
  });

  it('should put pinned groups first', () => {
    const cards = buildBalanceCards({
      userId: 1,
      groups: [CASA, { ...USD, pinned: true }],
      rows: [],
      people: PEOPLE,
    });

    expect(cards.map(({ name }) => name)).toEqual(['USD', 'Casa']);
  });

  it('should add non zero balances outside groups after the groups', () => {
    const cards = buildBalanceCards({
      userId: 1,
      groups: [CASA],
      rows: [
        { groupId: null, friendId: 3, currency: 'ARS', amount: -700n },
        { groupId: null, friendId: 2, currency: 'ARS', amount: 0n },
      ],
      people: PEOPLE,
    });

    expect(cards.map(({ key }) => key)).toEqual(['group-1', 'friend-3-ARS']);
    expect(cards[1]).toEqual(
      expect.objectContaining({ href: '/balances/3', name: 'Carla', counterpart: CARLA }),
    );
  });
});

describe('balanceSentence', () => {
  it('should pick the sentence from the sign and the counterpart', () => {
    expect(balanceSentence({ amount: 10n, counterpart: BELEN })).toBe('owes_you');
    expect(balanceSentence({ amount: -10n, counterpart: BELEN })).toBe('you_owe');
    expect(balanceSentence({ amount: 10n, counterpart: null })).toBe('owed_generic');
    expect(balanceSentence({ amount: -10n, counterpart: null })).toBe('owe_generic');
    expect(balanceSentence({ amount: 0n, counterpart: BELEN })).toBe('settled');
  });
});
