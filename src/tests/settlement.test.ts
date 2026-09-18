import { SplitType, type User } from '@prisma/client';

import { DEFAULT_CATEGORY } from '~/lib/category';
import { buildSettlementInput, resolveTransferReceiver } from '~/lib/settlement';
import { useAddExpenseStore } from '~/store/addStore';

jest.mock('~/utils/array', () => ({
  shuffleArray: jest.fn(<T>(arr: T[]): T[] => arr),
}));

const makeUser = (id: number, name: string): User => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  currency: 'ARS',
  defaultCurrency: null,
  emailVerified: null,
  image: null,
  preferredLanguage: 'es-AR',
  obapiProviderId: null,
  bankingId: null,
  hiddenFriendIds: [],
});

const pato = makeUser(1, 'Pato');
const belen = makeUser(2, 'Belen');
const tercero = makeUser(3, 'Tercero');

describe('buildSettlementInput', () => {
  it('should build the same row shape the settle up flow creates', () => {
    const input = buildSettlementInput({
      sender: pato,
      receiver: belen,
      amount: 500000n,
      currency: 'ARS',
      groupId: 1,
      name: 'Transferencia de saldo',
    });

    expect(input).toEqual({
      name: 'Transferencia de saldo',
      currency: 'ARS',
      amount: 500000n,
      splitType: SplitType.SETTLEMENT,
      category: DEFAULT_CATEGORY,
      groupId: 1,
      paidBy: pato.id,
      participants: [
        { userId: pato.id, amount: 500000n },
        { userId: belen.id, amount: -500000n },
      ],
    });
  });

  it('should give the sender the positive amount whichever way it goes', () => {
    const inverted = buildSettlementInput({
      sender: belen,
      receiver: pato,
      amount: 500000n,
      currency: 'ARS',
      groupId: 1,
      name: 'Transferencia de saldo',
    });

    expect(inverted.paidBy).toBe(belen.id);
    expect(inverted.participants).toEqual([
      { userId: belen.id, amount: 500000n },
      { userId: pato.id, amount: -500000n },
    ]);
  });

  it('should always balance out to zero', () => {
    const { participants } = buildSettlementInput({
      sender: pato,
      receiver: belen,
      amount: 123456n,
      currency: 'USD',
      groupId: null,
      name: 'x',
    });

    expect(participants.reduce((acc, p) => acc + p.amount, 0n)).toBe(0n);
  });

  it('should omit the optional fields when they are not given', () => {
    const input = buildSettlementInput({
      sender: pato,
      receiver: belen,
      amount: 1n,
      currency: 'ARS',
      groupId: null,
      name: 'x',
    });

    expect('expenseDate' in input).toBe(false);
    expect('expenseId' in input).toBe(false);
    expect(input.groupId).toBeNull();
  });

  it('should keep the date and the id when editing an existing settlement', () => {
    const expenseDate = new Date('2026-09-18T12:00:00Z');
    const input = buildSettlementInput({
      sender: pato,
      receiver: belen,
      amount: 1n,
      currency: 'ARS',
      groupId: 2,
      name: 'x',
      expenseDate,
      expenseId: 'abc',
    });

    expect(input.expenseDate).toBe(expenseDate);
    expect(input.expenseId).toBe('abc');
  });
});

describe('resolveTransferReceiver', () => {
  it('should pick the other one when there are exactly two participants', () => {
    expect(resolveTransferReceiver([pato, belen], pato.id)).toBe(belen);
    expect(resolveTransferReceiver([pato, belen], belen.id)).toBe(pato);
  });

  it('should ignore a stale pick when there are only two participants', () => {
    expect(resolveTransferReceiver([pato, belen], pato.id, 99)).toBe(belen);
  });

  it('should require an explicit pick with three or more participants', () => {
    expect(resolveTransferReceiver([pato, belen, tercero], pato.id)).toBeUndefined();
    expect(resolveTransferReceiver([pato, belen, tercero], pato.id, tercero.id)).toBe(tercero);
  });

  it('should never return the sender', () => {
    expect(resolveTransferReceiver([pato, belen, tercero], pato.id, pato.id)).toBeUndefined();
  });

  it('should return nothing without a sender', () => {
    expect(resolveTransferReceiver([pato, belen], undefined)).toBeUndefined();
  });
});

describe('addStore transfer mode', () => {
  const { actions } = useAddExpenseStore.getState();

  beforeEach(() => {
    actions.setCurrentUser(pato);
    actions.resetState();
    actions.setParticipants([pato, belen]);
  });

  it('should default the payer to the current user', () => {
    expect(useAddExpenseStore.getState().paidBy?.id).toBe(pato.id);
  });

  it('should keep the payer chosen by hand', () => {
    actions.setPaidBy(belen);

    expect(useAddExpenseStore.getState().paidBy?.id).toBe(belen.id);
  });

  it('should switch the entry mode', () => {
    actions.setEntryMode('TRANSFER');

    expect(useAddExpenseStore.getState().entryMode).toBe('TRANSFER');
  });

  it('should swap the direction of the transfer', () => {
    actions.setEntryMode('TRANSFER');
    actions.swapTransferDirection();

    const swapped = useAddExpenseStore.getState();
    expect(swapped.paidBy?.id).toBe(belen.id);
    expect(
      resolveTransferReceiver(swapped.participants, swapped.paidBy?.id, swapped.transferToId)?.id,
    ).toBe(pato.id);

    actions.swapTransferDirection();

    const back = useAddExpenseStore.getState();
    expect(back.paidBy?.id).toBe(pato.id);
    expect(resolveTransferReceiver(back.participants, back.paidBy?.id, back.transferToId)?.id).toBe(
      belen.id,
    );
  });

  it('should swap among three participants only once the receiver is picked', () => {
    actions.setParticipants([pato, belen, tercero]);
    actions.setEntryMode('TRANSFER');
    actions.swapTransferDirection();

    // Sin destinatario elegido no hay transferencia posible, así que invertir no hace nada.
    expect(useAddExpenseStore.getState().paidBy?.id).toBe(pato.id);

    actions.setTransferTo(tercero.id);
    actions.swapTransferDirection();

    const swapped = useAddExpenseStore.getState();
    expect(swapped.paidBy?.id).toBe(tercero.id);
    expect(swapped.transferToId).toBe(pato.id);
  });

  it('should go back to expense mode when the form is reset', () => {
    actions.setEntryMode('TRANSFER');
    actions.setTransferTo(belen.id);
    actions.resetState();

    const state = useAddExpenseStore.getState();
    expect(state.entryMode).toBe('EXPENSE');
    expect(state.transferToId).toBeUndefined();
    expect(state.paidBy?.id).toBe(pato.id);
  });
});
