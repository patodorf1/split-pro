import { Prisma, SplitType, type User } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';

import {
  ExternalApiError,
  type ParsedExternalEntry,
  minorToUnits,
  parseExternalEntry,
} from '~/lib/externalExpense';
import { simplifyDebts } from '~/lib/simplify';
import { createExpense, deleteExpense } from '~/server/api/services/splitService';
import { db } from '~/server/db';
import { getBearerToken, isExternalApiEnabled, isValidExternalApiKey } from '~/server/externalApi';
import { getCurrencyHelpers } from '~/utils/numbers';

/**
 * Lógica con base de datos de la API externa de gastos. Los endpoints viven en
 * `src/pages/api/external/groups/**` y son finitos: autenticación, cargar el grupo y delegar acá.
 *
 * Supuesto de seguridad: la clave es global de la instalación (una sola familia), así que puede
 * leer y escribir en cualquier grupo. Lo que NUNCA se permite es asignar como pagador, participante
 * o autor a alguien que no sea miembro del grupo indicado en la URL.
 */

/** Una reserva de idempotencia sin gasto más vieja que esto se considera abandonada. */
const STALE_RESERVATION_MS = 2 * 60 * 1000;

export const readSingleQueryParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const sendExternalError = (res: NextApiResponse, error: ExternalApiError) =>
  res.status(error.status).json(error.toJSON());

/**
 * Mismo portón que la API de compras: sin `EXTERNAL_API_KEY` la API no existe (404) y con clave
 * mala o ausente es 401. Devuelve `false` si ya respondió.
 */
export const guardExternalRequest = (req: NextApiRequest, res: NextApiResponse): boolean => {
  if (!isExternalApiEnabled()) {
    res.status(404).json({ error: 'Not found' });
    return false;
  }

  if (!isValidExternalApiKey(getBearerToken(req.headers.authorization))) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({
      error: 'Falta la clave o es incorrecta / Missing or invalid API key',
      code: 'unauthorized',
    });
    return false;
  }

  return true;
};

export const handleExternalError = (res: NextApiResponse, error: unknown, context: string) => {
  if (error instanceof ExternalApiError) {
    return sendExternalError(res, error);
  }

  // Nunca devolvemos el stack: queda en el log del servidor.
  console.error(`External expenses API error (${context}):`, error);
  return res.status(500).json({ error: 'Error interno / Internal Server Error', code: 'internal' });
};

const MEMBER_SELECT = { id: true, name: true, email: true } as const;

const serializePerson = (user: { id: number; name: string | null; email: string | null }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
});

/** Grupo con sus miembros (Users completos: `calculateParticipantSplit` trabaja con User). */
export const loadGroup = async (rawGroupId: string | undefined) => {
  const groupId = Number(rawGroupId);

  if (!Number.isInteger(groupId) || 0 >= groupId) {
    throw new ExternalApiError(
      400,
      'invalid_group',
      'groupId inválido',
      'Invalid groupId',
      'groupId',
    );
  }

  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { groupUsers: { include: { user: true }, orderBy: { userId: 'asc' } } },
  });

  if (!group) {
    throw new ExternalApiError(404, 'group_not_found', 'Grupo no encontrado', 'Group not found');
  }

  return { ...group, members: group.groupUsers.map((gu) => gu.user) };
};

export type LoadedGroup = Awaited<ReturnType<typeof loadGroup>>;

const assertGroupWritable = (group: LoadedGroup) => {
  if (group.archivedAt) {
    throw new ExternalApiError(
      409,
      'group_archived',
      'El grupo está archivado',
      'The group is archived',
    );
  }
};

export const listGroups = async () => {
  const groups = await db.group.findMany({
    orderBy: { id: 'asc' },
    include: {
      groupUsers: { include: { user: { select: MEMBER_SELECT } }, orderBy: { userId: 'asc' } },
    },
  });

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    defaultCurrency: g.defaultCurrency,
    archived: Boolean(g.archivedAt),
    members: g.groupUsers.map((gu) => serializePerson(gu.user)),
  }));
};

/**
 * Saldo del grupo con la misma fuente que la app: la vista BalanceView, simplificada si el grupo
 * tiene "simplificar deudas" activado. En la vista, `amount > 0` significa que `friendId` le debe a
 * `userId` (es lo que la app muestra como "te deben").
 */
export const getGroupBalances = async (group: Pick<LoadedGroup, 'id' | 'simplifyDebts'>) => {
  const rows = await db.balanceView.findMany({ where: { groupId: group.id } });
  const balances = group.simplifyDebts ? simplifyDebts(rows) : rows;
  const owed = balances.filter((b) => 0n < b.amount);

  const userIds = [...new Set(owed.flatMap((b) => [b.userId, b.friendId]))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: MEMBER_SELECT });
  const byId = new Map(users.map((u) => [u.id, u]));
  const nameOf = (id: number) => byId.get(id)?.name ?? byId.get(id)?.email ?? `#${id}`;

  return owed
    .toSorted((a, b) => a.currency.localeCompare(b.currency))
    .map((b) => {
      const formatted = getCurrencyHelpers({ currency: b.currency, locale: 'es-AR' }).toUIString(
        b.amount,
      );

      return {
        currency: b.currency,
        amount: minorToUnits(b.amount, b.currency),
        debtor: serializePerson(
          byId.get(b.friendId) ?? { id: b.friendId, name: null, email: null },
        ),
        creditor: serializePerson(byId.get(b.userId) ?? { id: b.userId, name: null, email: null }),
        text: `${nameOf(b.friendId)} le debe ${formatted} a ${nameOf(b.userId)}`,
      };
    });
};

const EXPENSE_INCLUDE = {
  paidByUser: { select: MEMBER_SELECT },
  addedByUser: { select: MEMBER_SELECT },
  expenseParticipants: { include: { user: { select: MEMBER_SELECT } } },
  externalExpense: { select: { idempotencyKey: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseWithDetails = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

const isTransferType = (splitType: SplitType) =>
  SplitType.SETTLEMENT === splitType || SplitType.CURRENCY_CONVERSION === splitType;

export const serializeExpense = (expense: ExpenseWithDetails) => {
  const toUnits = (value: bigint) => minorToUnits(value, expense.currency);

  return {
    id: expense.id,
    type: isTransferType(expense.splitType) ? 'transfer' : 'expense',
    description: expense.name,
    amount: toUnits(expense.amount),
    currency: expense.currency,
    category: isTransferType(expense.splitType) ? null : expense.category,
    splitType: expense.splitType,
    date: expense.expenseDate.toISOString(),
    createdAt: expense.createdAt.toISOString(),
    paidBy: serializePerson(expense.paidByUser),
    createdBy: serializePerson(expense.addedByUser),
    source: expense.externalExpense ? 'api' : 'app',
    idempotencyKey: expense.externalExpense?.idempotencyKey ?? null,
    deleted: Boolean(expense.deletedAt),
    participants: expense.expenseParticipants
      .toSorted((a, b) => a.userId - b.userId)
      .map((p) => {
        // En la base: quien pagó tiene total − su parte; el resto, −su parte.
        const share = p.userId === expense.paidBy ? expense.amount - p.amount : -p.amount;
        return {
          ...serializePerson(p.user),
          share: toUnits(share),
          balance: toUnits(p.amount),
        };
      }),
  };
};

export const listGroupExpenses = async (groupId: number, limit: number) => {
  const expenses = await db.expense.findMany({
    where: { groupId, deletedAt: null },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: EXPENSE_INCLUDE,
  });

  return expenses.map(serializeExpense);
};

/** Gastos por id, en el orden de `ids` (el que ya decidió la consulta filtrada). */
export const listExpensesByIds = async (ids: string[]) => {
  if (0 === ids.length) {
    return [];
  }

  const expenses = await db.expense.findMany({
    where: { id: { in: ids } },
    include: EXPENSE_INCLUDE,
  });
  const byId = new Map(expenses.map((expense) => [expense.id, expense]));

  return ids.flatMap((id) => {
    const expense = byId.get(id);
    return expense ? [serializeExpense(expense)] : [];
  });
};

const findExpense = (id: string) =>
  db.expense.findUnique({ where: { id }, include: EXPENSE_INCLUDE });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && 'P2002' === error.code;

type Reservation = { reservationId: number } | { existingExpenseId: string };

/**
 * Reserva la clave de idempotencia ANTES de crear el gasto: el índice único (groupId,
 * idempotencyKey) hace que, si llegan dos pedidos iguales a la vez, uno solo pase. Sin clave
 * también se reserva una fila (con clave NULL): es la marca de "cargado por la API".
 */
const reserveExternalExpense = async (
  groupId: number,
  idempotencyKey: string | undefined,
  retry = true,
): Promise<Reservation> => {
  try {
    const row = await db.externalExpense.create({
      data: { groupId, idempotencyKey: idempotencyKey ?? null },
      select: { id: true },
    });
    return { reservationId: row.id };
  } catch (error) {
    if (!idempotencyKey || !isUniqueViolation(error)) {
      throw error;
    }
  }

  const existing = await db.externalExpense.findUnique({
    where: { groupId_idempotencyKey: { groupId, idempotencyKey } },
  });

  if (existing?.expenseId) {
    return { existingExpenseId: existing.expenseId };
  }

  // Reserva colgada (el proceso murió entre reservar y crear): la liberamos y reintentamos una vez.
  if (existing && retry && Date.now() - existing.createdAt.getTime() > STALE_RESERVATION_MS) {
    await db.externalExpense.deleteMany({ where: { id: existing.id, expenseId: null } });
    return reserveExternalExpense(groupId, idempotencyKey, false);
  }

  throw new ExternalApiError(
    409,
    'idempotency_in_progress',
    'Ya hay un pedido con esa idempotencyKey en curso, reintentá en unos segundos',
    'A request with this idempotencyKey is already in progress, retry in a few seconds',
    'idempotencyKey',
  );
};

/** Un reintento con la misma clave tiene que describir el mismo movimiento. */
const assertSameEntry = (existing: ExpenseWithDetails, parsed: ParsedExternalEntry) => {
  const same =
    existing.groupId === parsed.input.groupId &&
    existing.amount === parsed.input.amount &&
    existing.currency === parsed.input.currency &&
    existing.paidBy === parsed.input.paidBy &&
    (SplitType.SETTLEMENT === existing.splitType) === ('transfer' === parsed.kind);

  if (!same) {
    throw new ExternalApiError(
      409,
      'idempotency_key_reused',
      'Esa idempotencyKey ya se usó para otro gasto distinto',
      'This idempotencyKey was already used for a different expense',
      'idempotencyKey',
    );
  }
};

export const createExternalEntry = async (group: LoadedGroup, rawBody: unknown) => {
  const parsed = parseExternalEntry<User>(rawBody, {
    groupId: group.id,
    defaultCurrency: group.defaultCurrency,
    members: group.members,
  });

  assertGroupWritable(group);

  const reservation = await reserveExternalExpense(group.id, parsed.idempotencyKey);

  if ('existingExpenseId' in reservation) {
    const existing = await findExpense(reservation.existingExpenseId);

    if (!existing) {
      throw new ExternalApiError(
        404,
        'expense_not_found',
        'Gasto no encontrado',
        'Expense not found',
      );
    }

    assertSameEntry(existing, parsed);
    return { created: false, expense: serializeExpense(existing) };
  }

  let expenseId: string;

  try {
    // El mismo servicio que usa la mutación tRPC `expense.addOrEditExpense`: arma las filas,
    // Dispara las notificaciones push y deja todo igual que una carga desde la app.
    const expense = await createExpense(parsed.input, parsed.createdBy.id);
    expenseId = expense.id;
  } catch (error) {
    await db.externalExpense.delete({ where: { id: reservation.reservationId } }).catch(() => null);
    throw error;
  }

  await db.externalExpense.update({
    where: { id: reservation.reservationId },
    data: { expenseId },
  });

  if (parsed.notes) {
    await db.expenseNote.create({
      data: { expenseId, note: parsed.notes, createdById: parsed.createdBy.id },
    });
  }

  const created = await findExpense(expenseId);

  return { created: true, expense: serializeExpense(created!) };
};

export const deleteExternalEntry = async (
  group: LoadedGroup,
  expenseId: string,
  deletedBy: User,
) => {
  const expense = await db.expense.findFirst({
    where: { id: expenseId, groupId: group.id },
    include: EXPENSE_INCLUDE,
  });

  if (!expense) {
    throw new ExternalApiError(
      404,
      'expense_not_found',
      'Gasto no encontrado en este grupo',
      'Expense not found in this group',
    );
  }

  if (!expense.externalExpense) {
    throw new ExternalApiError(
      403,
      'not_created_by_api',
      'Solo se pueden borrar gastos cargados por la API; este se cargó desde la app',
      'Only expenses created through the API can be deleted; this one was created in the app',
    );
  }

  if (expense.deletedAt) {
    throw new ExternalApiError(
      409,
      'already_deleted',
      'El gasto ya estaba borrado',
      'The expense was already deleted',
    );
  }

  assertGroupWritable(group);

  // Borrado lógico con el servicio de la app (deletedAt + deletedBy, notificación incluida).
  await deleteExpense(expense.id, deletedBy.id);

  const deleted = await findExpense(expense.id);
  return serializeExpense(deleted!);
};
