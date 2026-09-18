import { SplitType, type User } from '@prisma/client';

import { DEFAULT_CATEGORY } from '~/lib/category';
import {
  EXTERNAL_SETTLEMENT_NAME,
  ExternalApiError,
  isUuid,
  parseAmountToMinorUnits,
  parseExpenseDate,
  parseExternalEntry,
  parseListLimit,
  resolveMember,
} from '~/lib/externalExpense';
import { buildSettlementInput } from '~/lib/settlement';

const makeUser = (id: number, name: string, email: string): User => ({
  id,
  name,
  email,
  currency: 'ARS',
  defaultCurrency: null,
  emailVerified: null,
  image: null,
  preferredLanguage: 'es-AR',
  obapiProviderId: null,
  bankingId: null,
  hiddenFriendIds: [],
});

const pato = makeUser(1, 'Pato', 'patodorf@gmail.com');
const belen = makeUser(2, 'Belén', 'mbelenbilbao@gmail.com');
const tercero = makeUser(3, 'Tercero', 'tercero@example.com');
const ajeno = makeUser(9, 'Ajeno', 'ajeno@example.com');

const NOW = new Date('2026-09-18T18:00:00.000Z');
const casa = { groupId: 1, defaultCurrency: 'ARS', members: [pato, belen] };
const trio = { groupId: 5, defaultCurrency: 'ARS', members: [pato, belen, tercero] };

/** Ejecuta y devuelve el ExternalApiError lanzado, para poder mirar campo y código. */
const catchError = (fn: () => unknown): ExternalApiError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ExternalApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an ExternalApiError');
};

describe('parseAmountToMinorUnits', () => {
  it('converts units to cents without floating point errors', () => {
    expect(parseAmountToMinorUnits(45000, 2)).toBe(4500000n);
    expect(parseAmountToMinorUnits(45000.5, 2)).toBe(4500050n);
    expect(parseAmountToMinorUnits(0.29, 2)).toBe(29n);
    expect(parseAmountToMinorUnits(1.005, 3)).toBe(1005n);
    expect(parseAmountToMinorUnits('45000.50', 2)).toBe(4500050n);
    expect(parseAmountToMinorUnits('  12 ', 2)).toBe(1200n);
    expect(parseAmountToMinorUnits(1500, 0)).toBe(1500n);
  });

  it('rejects more decimals than the currency allows', () => {
    expect(catchError(() => parseAmountToMinorUnits(10.123, 2)).field).toBe('amount');
    expect(() => parseAmountToMinorUnits(0.1 + 0.2, 2)).toThrow(ExternalApiError);
    expect(() => parseAmountToMinorUnits(10.5, 0)).toThrow(ExternalApiError);
  });

  it('rejects zero, negatives, garbage and exponents', () => {
    for (const bad of [
      0,
      -5,
      '-5',
      'abc',
      '1.000,50',
      '45,5',
      '',
      NaN,
      Infinity,
      1e21,
      '1e3',
      null,
    ]) {
      expect(() => parseAmountToMinorUnits(bad, 2)).toThrow(ExternalApiError);
    }
  });

  it('allows zero only when asked (exact shares)', () => {
    expect(parseAmountToMinorUnits(0, 2, 'x', { allowZero: true })).toBe(0n);
  });

  it('rejects absurdly large amounts', () => {
    expect(() => parseAmountToMinorUnits('99999999999999', 2)).toThrow(ExternalApiError);
    expect(parseAmountToMinorUnits('9999999999999', 2)).toBe(999999999999900n);
  });
});

describe('parseExpenseDate', () => {
  it('defaults to now', () => {
    expect(parseExpenseDate(undefined, NOW)).toBe(NOW);
  });

  it('stores a plain date at noon in Buenos Aires', () => {
    expect(parseExpenseDate('2026-09-10', NOW).toISOString()).toBe('2026-09-10T15:00:00.000Z');
  });

  it('reads a datetime without zone as Buenos Aires time and respects explicit zones', () => {
    expect(parseExpenseDate('2026-09-10T21:30', NOW).toISOString()).toBe(
      '2026-09-11T00:30:00.000Z',
    );
    expect(parseExpenseDate('2026-09-10T21:30:00Z', NOW).toISOString()).toBe(
      '2026-09-10T21:30:00.000Z',
    );
  });

  it('rejects invalid or out of range dates', () => {
    for (const bad of [
      '2026-02-30',
      '10/09/2026',
      'ayer',
      '2026-9-1',
      '1999-12-31',
      '2028-01-01',
    ]) {
      expect(catchError(() => parseExpenseDate(bad, NOW)).field).toBe('date');
    }
  });
});

describe('resolveMember', () => {
  it('finds members by id, numeric string or email (case insensitive)', () => {
    expect(resolveMember(2, casa.members, 'paidBy')).toBe(belen);
    expect(resolveMember('2', casa.members, 'paidBy')).toBe(belen);
    expect(resolveMember(' MBelenBilbao@gmail.com ', casa.members, 'paidBy')).toBe(belen);
  });

  it('never resolves someone outside the group', () => {
    const error = catchError(() => resolveMember('ajeno@example.com', casa.members, 'paidBy'));
    expect(error.status).toBe(400);
    expect(error.code).toBe('not_a_member');
    expect(error.field).toBe('paidBy');
    expect(() => resolveMember(9, casa.members, 'paidBy')).toThrow(ExternalApiError);
  });
});

describe('parseExternalEntry — expenses', () => {
  it('defaults to an equal split among all members, in the group currency', () => {
    const { kind, input, createdBy } = parseExternalEntry(
      {
        description: 'Supermercado',
        amount: 45000,
        paidBy: 'patodorf@gmail.com',
        category: 'groceries',
      },
      casa,
      NOW,
    );

    expect(kind).toBe('expense');
    expect(createdBy).toBe(pato);
    expect(input).toEqual({
      name: 'Supermercado',
      currency: 'ARS',
      amount: 4500000n,
      splitType: SplitType.EQUAL,
      category: 'groceries',
      groupId: 1,
      paidBy: 1,
      participants: [
        { userId: 1, amount: 2250000n },
        { userId: 2, amount: -2250000n },
      ],
      expenseDate: NOW,
    });
  });

  it('builds the payer-positive / others-negative shape when Belén pays', () => {
    const { input, createdBy } = parseExternalEntry(
      { description: 'Verdu', amount: '1000.01', paidBy: 2, createdBy: 1 },
      casa,
      NOW,
    );

    expect(input.category).toBe(DEFAULT_CATEGORY);
    expect(createdBy).toBe(pato);
    const total = input.participants.reduce((acc, p) => acc + p.amount, 0n);
    expect(total).toBe(0n);
    const byUser = Object.fromEntries(input.participants.map((p) => [p.userId, p.amount]));
    expect(0n < byUser[2]!).toBe(true);
    expect(0n > byUser[1]!).toBe(true);
    // El centavo que sobra se reparte, pero nadie queda con más de un centavo de diferencia.
    expect([50000n, 50001n]).toContain(-byUser[1]!);
  });

  it('supports an equal split among a subset, keeping the payer even with a zero share', () => {
    const { input } = parseExternalEntry(
      {
        description: 'Regalo',
        amount: 300,
        paidBy: 1,
        split: { type: 'EQUAL', participants: ['mbelenbilbao@gmail.com', 3] },
      },
      trio,
      NOW,
    );

    expect(input.participants).toEqual([
      { userId: 2, amount: -15000n },
      { userId: 3, amount: -15000n },
      { userId: 1, amount: 30000n },
    ]);
  });

  it('supports an EXACT split that adds up to the total', () => {
    const { input } = parseExternalEntry(
      {
        description: 'Cena',
        amount: 100,
        paidBy: 'patodorf@gmail.com',
        split: { type: 'EXACT', shares: { 'patodorf@gmail.com': 30, '2': 70 } },
      },
      casa,
      NOW,
    );

    expect(input.splitType).toBe(SplitType.EXACT);
    expect(input.participants.toSorted((a, b) => a.userId - b.userId)).toEqual([
      { userId: 1, amount: 7000n },
      { userId: 2, amount: -7000n },
    ]);
  });

  it('rejects an EXACT split that does not add up', () => {
    const error = catchError(() =>
      parseExternalEntry(
        {
          description: 'Cena',
          amount: 100,
          paidBy: 1,
          split: { type: 'EXACT', shares: { 1: 30, 2: 60 } },
        },
        casa,
        NOW,
      ),
    );
    expect(error.code).toBe('split_mismatch');
    expect(error.field).toBe('split.shares');
    expect(error.es).toContain('90.00');
  });

  it('rejects the same person twice in a split', () => {
    const error = catchError(() =>
      parseExternalEntry(
        {
          description: 'Cena',
          amount: 100,
          paidBy: 1,
          split: { type: 'EXACT', shares: { 1: 50, 'patodorf@gmail.com': 50 } },
        },
        casa,
        NOW,
      ),
    );
    expect(error.field).toBe('split.shares');
  });

  it('rejects payers, creators and participants that are not members', () => {
    expect(
      catchError(() =>
        parseExternalEntry({ description: 'X', amount: 1, paidBy: 'ajeno@example.com' }, casa, NOW),
      ).field,
    ).toBe('paidBy');
    expect(
      catchError(() =>
        parseExternalEntry(
          { description: 'X', amount: 1, paidBy: 1, createdBy: ajeno.id },
          casa,
          NOW,
        ),
      ).field,
    ).toBe('createdBy');
    expect(
      catchError(() =>
        parseExternalEntry(
          { description: 'X', amount: 1, paidBy: 1, split: { type: 'EQUAL', participants: [9] } },
          casa,
          NOW,
        ),
      ).field,
    ).toBe('split.participants.0');
  });

  it('rejects unknown categories and currencies', () => {
    expect(
      catchError(() =>
        parseExternalEntry(
          { description: 'X', amount: 1, paidBy: 1, category: 'super' },
          casa,
          NOW,
        ),
      ).code,
    ).toBe('unknown_category');
    expect(
      catchError(() =>
        parseExternalEntry({ description: 'X', amount: 1, paidBy: 1, currency: 'XXX' }, casa, NOW),
      ).field,
    ).toBe('currency');
    // Secciones enteras también son categorías válidas en la app.
    expect(
      parseExternalEntry({ description: 'X', amount: 1, paidBy: 1, category: 'travel' }, casa, NOW)
        .input.category,
    ).toBe('travel');
  });

  it('validates required fields, lengths and unknown keys', () => {
    expect(catchError(() => parseExternalEntry({ amount: 1, paidBy: 1 }, casa, NOW)).field).toBe(
      'description',
    );
    expect(
      catchError(() =>
        parseExternalEntry({ description: 'x'.repeat(101), amount: 1, paidBy: 1 }, casa, NOW),
      ).field,
    ).toBe('description');
    const missingPayer = catchError(() =>
      parseExternalEntry({ description: 'X', amount: 1 }, casa, NOW),
    );
    expect(missingPayer.field).toBe('paidBy');
    expect(missingPayer.es).toContain('es obligatorio');
    expect(
      catchError(() =>
        parseExternalEntry({ description: 'X', amount: 1, paidBy: 1, paidby: 2 }, casa, NOW),
      ).es,
    ).toContain('paidby');
    expect(catchError(() => parseExternalEntry([], casa, NOW)).field).toBe('body');
  });

  it('uses the given date and keeps notes and idempotency key', () => {
    const parsed = parseExternalEntry(
      {
        description: 'Nafta',
        amount: 20000,
        paidBy: 1,
        category: 'fuel',
        date: '2026-09-15',
        notes: 'YPF',
        idempotencyKey: 'wa-ABC123',
      },
      casa,
      NOW,
    );
    expect(parsed.input.expenseDate.toISOString()).toBe('2026-09-15T15:00:00.000Z');
    expect(parsed.notes).toBe('YPF');
    expect(parsed.idempotencyKey).toBe('wa-ABC123');
  });

  it('requires a currency when the group has none', () => {
    expect(
      catchError(() =>
        parseExternalEntry(
          { description: 'X', amount: 1, paidBy: 1 },
          { ...casa, defaultCurrency: null },
          NOW,
        ),
      ).field,
    ).toBe('currency');
  });
});

describe('parseExternalEntry — transfers', () => {
  it('builds exactly the same input as buildSettlementInput', () => {
    const { kind, input, createdBy } = parseExternalEntry(
      { type: 'transfer', from: 'patodorf@gmail.com', to: 'mbelenbilbao@gmail.com', amount: 5000 },
      casa,
      NOW,
    );

    expect(kind).toBe('transfer');
    expect(createdBy).toBe(pato);
    expect(input).toEqual(
      buildSettlementInput({
        sender: pato,
        receiver: belen,
        amount: 500000n,
        currency: 'ARS',
        groupId: 1,
        name: EXTERNAL_SETTLEMENT_NAME,
        expenseDate: NOW,
      }),
    );
    expect(input.splitType).toBe(SplitType.SETTLEMENT);
  });

  it('rejects transfers to oneself, to non members, and expense-only fields', () => {
    expect(
      catchError(() =>
        parseExternalEntry({ type: 'transfer', from: 1, to: 1, amount: 5 }, casa, NOW),
      ).field,
    ).toBe('to');
    expect(
      catchError(() =>
        parseExternalEntry({ type: 'transfer', from: 1, to: 9, amount: 5 }, casa, NOW),
      ).code,
    ).toBe('not_a_member');
    expect(
      catchError(() =>
        parseExternalEntry(
          { type: 'transfer', from: 1, to: 2, amount: 5, category: 'groceries' },
          casa,
          NOW,
        ),
      ).code,
    ).toBe('validation_error');
  });
});

describe('small helpers', () => {
  it('parses the list limit', () => {
    expect(parseListLimit(undefined)).toBe(10);
    expect(parseListLimit('25')).toBe(25);
    expect(() => parseListLimit('0')).toThrow(ExternalApiError);
    expect(() => parseListLimit('51')).toThrow(ExternalApiError);
    expect(() => parseListLimit('1;DROP')).toThrow(ExternalApiError);
  });

  it('validates uuids before they reach the database', () => {
    expect(isUuid('eb30b680-a83e-46f9-8fc5-011977d1091c')).toBe(true);
    expect(isUuid("1' OR '1'='1")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
