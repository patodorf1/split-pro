/**
 * Armado de las tarjetas de saldo de Inicio: una tarjeta por grupo y moneda (y
 * por amigo y moneda para los gastos sueltos, fuera de grupos). Todo puro para
 * poder testearlo y usarlo tanto en el servidor como en el cliente.
 */

export interface BalancePerson {
  id: number;
  name: string | null;
  email: string | null;
  image: string | null;
}

export interface BalanceCardGroup {
  id: number;
  name: string;
  image: string | null;
  defaultCurrency: string | null;
  pinned: boolean;
  memberIds: number[];
}

export interface BalanceCardRow {
  groupId: number | null;
  friendId: number;
  currency: string;
  amount: bigint;
}

export interface BalanceCard {
  key: string;
  kind: 'group' | 'friend';
  href: string;
  name: string;
  image: string | null;
  /** `null` sólo en un grupo sin movimientos ni moneda por defecto. */
  currency: string | null;
  /** Positivo: me deben. Negativo: debo. Cero: al día. */
  amount: bigint;
  /** La otra persona del saldo, cuando es una sola (grupo de a dos o amigo). */
  counterpart: BalancePerson | null;
}

export type BalanceSentence = 'owes_you' | 'you_owe' | 'owed_generic' | 'owe_generic' | 'settled';

/** Qué frase va debajo del monto de una tarjeta. */
export const balanceSentence = (
  card: Pick<BalanceCard, 'amount' | 'counterpart'>,
): BalanceSentence => {
  if (0n === card.amount) {
    return 'settled';
  }

  if (0n < card.amount) {
    return card.counterpart ? 'owes_you' : 'owed_generic';
  }

  return card.counterpart ? 'you_owe' : 'owe_generic';
};

const byCurrency =
  (defaultCurrency: string | null) =>
  (a: string, b: string): number => {
    if (a === defaultCurrency) {
      return -1;
    }
    if (b === defaultCurrency) {
      return 1;
    }
    return a.localeCompare(b);
  };

/**
 * `rows` son las filas del usuario en la vista de saldos (una por grupo, amigo y
 * moneda). Los grupos van primero (fijados antes, después por antigüedad) y
 * muestran una tarjeta por moneda con saldo, o una sola "al día" si no deben
 * nada. Después van los saldos con amigos fuera de grupos, sólo si no son cero.
 */
export const buildBalanceCards = ({
  userId,
  groups,
  rows,
  people,
}: {
  userId: number;
  groups: BalanceCardGroup[];
  rows: BalanceCardRow[];
  people: Record<number, BalancePerson | undefined>;
}): BalanceCard[] => {
  const cards: BalanceCard[] = [];

  const sortedGroups = [...groups].sort((a, b) =>
    a.pinned === b.pinned ? a.id - b.id : a.pinned ? -1 : 1,
  );

  for (const group of sortedGroups) {
    const totals = new Map<string, bigint>();

    for (const row of rows) {
      if (row.groupId === group.id) {
        totals.set(row.currency, (totals.get(row.currency) ?? 0n) + row.amount);
      }
    }

    const others = group.memberIds.filter((id) => id !== userId);
    const counterpart = 1 === others.length ? (people[others[0]!] ?? null) : null;
    const base = {
      kind: 'group' as const,
      href: `/groups/${group.id}`,
      name: group.name,
      image: group.image,
      counterpart,
    };

    const withBalance = [...totals.entries()]
      .filter(([, amount]) => 0n !== amount)
      .sort(([a], [b]) => byCurrency(group.defaultCurrency)(a, b));

    if (0 === withBalance.length) {
      const currency = group.defaultCurrency ?? [...totals.keys()].sort()[0] ?? null;
      cards.push({ ...base, key: `group-${group.id}`, currency, amount: 0n });
    } else {
      withBalance.forEach(([currency, amount]) => {
        cards.push({ ...base, key: `group-${group.id}-${currency}`, currency, amount });
      });
    }
  }

  const friendTotals = new Map<string, { friendId: number; currency: string; amount: bigint }>();

  for (const row of rows.filter(({ groupId }) => null === groupId)) {
    const key = `${row.friendId}-${row.currency}`;
    const entry = friendTotals.get(key) ?? {
      friendId: row.friendId,
      currency: row.currency,
      amount: 0n,
    };
    entry.amount += row.amount;
    friendTotals.set(key, entry);
  }

  const friendCards = [...friendTotals.values()]
    .filter(({ amount, friendId }) => 0n !== amount && people[friendId])
    .map(({ friendId, currency, amount }): BalanceCard => {
      const friend = people[friendId]!;

      return {
        key: `friend-${friendId}-${currency}`,
        kind: 'friend',
        href: `/balances/${friendId}`,
        name: friend.name ?? friend.email ?? '',
        image: friend.image,
        currency,
        amount,
        counterpart: friend,
      };
    })
    .sort(
      (a, b) => a.name.localeCompare(b.name) || (a.currency ?? '').localeCompare(b.currency ?? ''),
    );

  return [...cards, ...friendCards];
};
