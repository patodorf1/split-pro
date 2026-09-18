import { SplitType } from '@prisma/client';

import { DEFAULT_CATEGORY } from '~/lib/category';
import type { CreateExpense } from '~/types/expense.types';

/** Lo mínimo que hace falta de una persona para armar una transferencia de saldo. */
export interface SettlementParty {
  id: number;
}

export interface BuildSettlementInput {
  /** Quién entrega la plata. Queda como `paidBy` y con el importe en positivo. */
  sender: SettlementParty;
  /** Quién la recibe. Queda con el importe en negativo. */
  receiver: SettlementParty;
  /** Importe siempre positivo. */
  amount: bigint;
  currency: string;
  groupId: number | null;
  /** Nombre visible del movimiento (traducido por quien llama). */
  name: string;
  expenseDate?: Date;
  /** Solo al editar una transferencia existente. */
  expenseId?: string;
}

/**
 * Arma el payload de una transferencia de saldo (SETTLEMENT) para `expense.addOrEditExpense`.
 *
 * Es la única fuente de la forma del registro: la usan "Saldar cuentas" del amigo, la del grupo,
 * la edición de una transferencia y el modo Transferencia de /add. Así todas crean exactamente la
 * misma fila, con el mismo criterio de signos: el que paga suma, el que recibe resta.
 */
export const buildSettlementInput = ({
  sender,
  receiver,
  amount,
  currency,
  groupId,
  name,
  expenseDate,
  expenseId,
}: BuildSettlementInput): CreateExpense => ({
  name,
  currency,
  amount,
  splitType: SplitType.SETTLEMENT,
  category: DEFAULT_CATEGORY,
  groupId,
  paidBy: sender.id,
  participants: [
    { userId: sender.id, amount },
    { userId: receiver.id, amount: -amount },
  ],
  ...(expenseDate ? { expenseDate } : {}),
  ...(expenseId ? { expenseId } : {}),
});

/**
 * Resuelve quién recibe una transferencia dentro de /add: con dos participantes es siempre "el
 * otro"; con tres o más hay que elegirlo a mano, y hasta que no se elija no hay transferencia
 * posible. Nunca devuelve al que paga.
 */
export const resolveTransferReceiver = <T extends SettlementParty>(
  participants: T[],
  senderId?: number,
  pickedReceiverId?: number,
): T | undefined => {
  if (undefined === senderId) {
    return undefined;
  }

  const others = participants.filter((p) => p.id !== senderId);

  if (1 === others.length) {
    return others[0];
  }

  return others.find((p) => p.id === pickedReceiverId);
};
