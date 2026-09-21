import { Prisma, SplitType } from '@prisma/client';
import { z } from 'zod';

import { type BalanceCard, type BalancePerson, buildBalanceCards } from '~/lib/balanceCards';
import { DEFAULT_CATEGORY } from '~/lib/category';
import { addMonths, computeShare, getMonthRange, toUtcTimestampLiteral } from '~/lib/stats';
import {
  type CategoryUsage,
  TOP_CATEGORIES_LIMIT,
  TOP_CATEGORIES_RECENT_MONTHS,
  monthsAgo,
  rankTopCategories,
} from '~/lib/topCategories';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';
import { COUNTS_AS_SPENDING_SQL, expenseDateRangeSql, memberShareSql } from '~/server/statsQueries';

/** Movements that are not spending and must never show up in the stats. */
const NON_EXPENSE_SPLIT_TYPES = [SplitType.SETTLEMENT, SplitType.CURRENCY_CONVERSION];

const monthInput = z.object({
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  timeZone: z.string().min(1).max(64),
  groupId: z.number().int().positive().nullish(),
});

interface MonthlyAggregateRow {
  period: 'current' | 'previous';
  currency: string;
  category: string;
  ours: bigint;
  mine: bigint;
  count: number;
}

export interface CategoryTotal {
  category: string;
  ours: bigint;
  mine: bigint;
  count: number;
}

export interface CurrencyTotal {
  currency: string;
  ours: bigint;
  mine: bigint;
  categories: CategoryTotal[];
}

const getMyGroupIds = async (userId: number): Promise<number[]> => {
  const rows = await db.groupUser.findMany({ where: { userId }, select: { groupId: true } });

  return rows.map(({ groupId }) => groupId);
};

const emptyCurrencyTotal = (currency: string): CurrencyTotal => ({
  currency,
  ours: 0n,
  mine: 0n,
  categories: [],
});

/** Replaces the raw participant row by the plain share of the current user. */
const withMyShare = <
  T extends { amount: bigint; paidBy: number; expenseParticipants: { amount: bigint }[] },
>(
  expense: T,
  userId: number,
): Omit<T, 'expenseParticipants'> & { mine: bigint } => {
  const { expenseParticipants, ...rest } = expense;

  return {
    ...rest,
    mine: computeShare({
      expenseAmount: expense.amount,
      paidBy: expense.paidBy,
      userId,
      participantAmount: expenseParticipants[0]?.amount,
    }),
  };
};

export const statsRouter = createTRPCRouter({
  /**
   * Totals and per-category breakdown of a month, plus the previous month's
   * totals so the UI can show the variation. Everything is aggregated by the
   * database in a single pass; amounts are never mixed across currencies.
   */
  monthlySummary: protectedProcedure.input(monthInput).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const { year, month, timeZone, groupId } = input;

    const previous = addMonths({ year, month }, -1);
    const { from, to } = getMonthRange(year, month, timeZone);
    const { from: previousFrom } = getMonthRange(previous.year, previous.month, timeZone);

    const fromLiteral = toUtcTimestampLiteral(from);

    /*
     * Without a group filter the scope is "every expense that concerns me":
     * anything in one of my groups plus one-to-one expenses I take part in.
     * With a group filter, the membership check keeps other groups out.
     */
    const groupFilter = groupId
      ? Prisma.sql`
          AND e."groupId" = ${groupId}
          AND e."groupId" IN (SELECT "groupId" FROM "GroupUser" WHERE "userId" = ${userId})`
      : Prisma.sql`
          AND (
            p."userId" IS NOT NULL
            OR e."groupId" IN (SELECT "groupId" FROM "GroupUser" WHERE "userId" = ${userId})
          )`;

    const rows = await db.$queryRaw<MonthlyAggregateRow[]>`
      WITH scoped AS (
        SELECT
          CASE
            WHEN e."expenseDate" >= ${fromLiteral}::timestamp THEN 'current'
            ELSE 'previous'
          END AS period,
          e.currency AS currency,
          e.category AS category,
          e.amount AS ours,
          ${memberShareSql(Prisma.sql`${userId}`)} AS mine
        FROM "Expense" e
        LEFT JOIN "ExpenseParticipant" p
          ON p."expenseId" = e.id AND p."userId" = ${userId}
        WHERE ${COUNTS_AS_SPENDING_SQL}
          AND ${expenseDateRangeSql(previousFrom, to)}
          ${groupFilter}
      )
      SELECT
        period,
        currency,
        category,
        SUM(ours)::bigint AS ours,
        SUM(mine)::bigint AS mine,
        COUNT(*)::int AS count
      FROM scoped
      GROUP BY period, currency, category
    `;

    const current = new Map<string, CurrencyTotal>();
    const previousTotals = new Map<string, { currency: string; ours: bigint; mine: bigint }>();

    for (const row of rows) {
      if ('previous' === row.period) {
        const entry = previousTotals.get(row.currency) ?? {
          currency: row.currency,
          ours: 0n,
          mine: 0n,
        };
        entry.ours += row.ours;
        entry.mine += row.mine;
        previousTotals.set(row.currency, entry);
      } else {
        const entry = current.get(row.currency) ?? emptyCurrencyTotal(row.currency);
        entry.ours += row.ours;
        entry.mine += row.mine;
        entry.categories.push({
          category: row.category,
          ours: row.ours,
          mine: row.mine,
          count: row.count,
        });
        current.set(row.currency, entry);
      }
    }

    const sortedCurrent = [...current.values()].sort((a, b) => (a.ours > b.ours ? -1 : 1));
    sortedCurrent.forEach((entry) => {
      entry.categories.sort((a, b) => (a.ours > b.ours ? -1 : 1));
    });

    return {
      current: sortedCurrent,
      previous: [...previousTotals.values()],
    };
  }),

  /** Expenses behind one category of one month, for the drill-down. */
  categoryExpenses: protectedProcedure
    .input(monthInput.extend({ currency: z.string().min(1).max(8), category: z.string().max(64) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { from, to } = getMonthRange(input.year, input.month, input.timeZone);
      const myGroupIds = await getMyGroupIds(userId);

      const expenses = await db.expense.findMany({
        where: {
          deletedAt: null,
          splitType: { notIn: NON_EXPENSE_SPLIT_TYPES },
          currency: input.currency,
          category: input.category,
          expenseDate: { gte: from, lt: to },
          ...(input.groupId
            ? { groupId: { in: myGroupIds.filter((id) => id === input.groupId) } }
            : {
                OR: [
                  { groupId: { in: myGroupIds } },
                  { expenseParticipants: { some: { userId } } },
                ],
              }),
        },
        select: {
          id: true,
          name: true,
          amount: true,
          currency: true,
          category: true,
          expenseDate: true,
          paidBy: true,
          groupId: true,
          paidByUser: { select: { id: true, name: true, email: true, image: true } },
          expenseParticipants: { where: { userId }, select: { amount: true } },
        },
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      });

      return expenses.map((expense) => withMyShare(expense, userId));
    }),

  /**
   * Categorías más usadas, para los botones rápidos de "Agregar gasto". Con `groupId` mira solo
   * ese grupo (previa verificación de que el usuario sea miembro); sin grupo, los gastos en los
   * que participa. Cuenta los últimos 12 meses y, si no llegan a llenar el renglón, completa con
   * el histórico. Las cuentas las hace la base, acá solo se ordena.
   */
  topCategories: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive().nullish() }).optional())
    .query(async ({ ctx, input }): Promise<string[]> => {
      const userId = ctx.session.user.id;
      const groupId = input?.groupId ?? null;

      if (groupId) {
        const membership = await db.groupUser.findUnique({
          where: { groupId_userId: { groupId, userId } },
          select: { groupId: true },
        });

        if (!membership) {
          return [];
        }
      }

      const scope: Prisma.ExpenseWhereInput = {
        deletedAt: null,
        splitType: { not: SplitType.SETTLEMENT },
        category: { not: DEFAULT_CATEGORY },
        ...(groupId ? { groupId } : { expenseParticipants: { some: { userId } } }),
      };

      const countByCategory = async (where: Prisma.ExpenseWhereInput): Promise<CategoryUsage[]> => {
        const rows = await db.expense.groupBy({
          by: ['category'],
          where,
          _count: { _all: true },
        });

        return rows.map(({ category, _count }) => ({ category, count: _count._all }));
      };

      const recent = await countByCategory({
        ...scope,
        expenseDate: { gte: monthsAgo(TOP_CATEGORIES_RECENT_MONTHS) },
      });
      const topOfRecent = rankTopCategories(recent);

      if (TOP_CATEGORIES_LIMIT <= topOfRecent.length) {
        return topOfRecent;
      }

      return rankTopCategories(recent, await countByCategory(scope));
    }),

  /**
   * Tarjetas de saldo de Inicio: una por grupo activo y moneda (o una "al día"
   * si el grupo está saldado) más los saldos con amigos fuera de grupos. El neto
   * de cada grupo sale de la vista de saldos, que no cambia con la simplificación
   * de deudas; por eso alcanza con sumar las filas del usuario.
   */
  homeBalances: protectedProcedure.query(async ({ ctx }): Promise<BalanceCard[]> => {
    const userId = ctx.session.user.id;
    const hiddenFriendIds = ctx.session.user.hiddenFriendIds;

    const [memberships, rows] = await Promise.all([
      db.groupUser.findMany({
        where: { userId, group: { archivedAt: null } },
        select: {
          pinned: true,
          group: {
            select: {
              id: true,
              name: true,
              image: true,
              defaultCurrency: true,
              groupUsers: { select: { userId: true } },
            },
          },
        },
      }),
      db.balanceView.findMany({
        where: { userId },
        select: { groupId: true, friendId: true, currency: true, amount: true },
      }),
    ]);

    const groups = memberships.map(({ pinned, group }) => ({
      id: group.id,
      name: group.name,
      image: group.image,
      defaultCurrency: group.defaultCurrency,
      pinned,
      memberIds: group.groupUsers.map((member) => member.userId),
    }));

    // Los amigos ocultos no aparecen con sus saldos sueltos (igual que en Saldos).
    const visibleRows = rows.filter(
      (row) => null !== row.groupId || !hiddenFriendIds.includes(row.friendId),
    );

    const personIds = new Set<number>(visibleRows.map((row) => row.friendId));
    groups.forEach((group) => group.memberIds.forEach((id) => personIds.add(id)));
    personIds.delete(userId);

    const users = await db.user.findMany({
      where: { id: { in: [...personIds] } },
      select: { id: true, name: true, email: true, image: true },
    });
    const people: Record<number, BalancePerson> = Object.fromEntries(
      users.map((person) => [person.id, person]),
    );

    return buildBalanceCards({ userId, groups, rows: visibleRows, people });
  }),

  /** Last movements of the user, settlements included. */
  recentActivity: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(5) }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const expenses = await db.expense.findMany({
        where: { deletedAt: null, expenseParticipants: { some: { userId } } },
        select: {
          id: true,
          name: true,
          amount: true,
          currency: true,
          category: true,
          splitType: true,
          expenseDate: true,
          paidBy: true,
          groupId: true,
          paidByUser: { select: { id: true, name: true, email: true, image: true } },
          expenseParticipants: { where: { userId }, select: { amount: true } },
        },
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        take: input?.limit ?? 5,
      });

      return expenses.map((expense) => withMyShare(expense, userId));
    }),
});

export type StatsRouter = typeof statsRouter;
