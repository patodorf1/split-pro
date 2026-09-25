import { Prisma, SplitType } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { type BalanceCard, type BalancePerson, buildBalanceCards } from '~/lib/balanceCards';
import { DEFAULT_CATEGORY } from '~/lib/category';
import {
  addMonths,
  computeShare,
  getMonthRange,
  getTimeZoneOffsetMs,
  getZonedCalendarDay,
  toUtcTimestampLiteral,
} from '~/lib/stats';
import {
  type CategoryUsage,
  TOP_CATEGORIES_LIMIT,
  TOP_CATEGORIES_RECENT_MONTHS,
  monthsAgo,
  rankTopCategories,
} from '~/lib/topCategories';
import {
  DolarBlueUnavailableError,
  blueRateForDates,
  ensureDolarBlueRates,
} from '~/server/api/services/dolarBlueService';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';
import {
  BLUE_SOURCE_CURRENCY,
  BLUE_TARGET_CURRENCY,
  COUNTS_AS_SPENDING_SQL,
  type Valuation,
  expenseDateRangeSql,
  expenseLocalDateSql,
  memberShareSql,
  valuationSql,
} from '~/server/statsQueries';

/** Movements that are not spending and must never show up in the stats. */
const NON_EXPENSE_SPLIT_TYPES = [SplitType.SETTLEMENT, SplitType.CURRENCY_CONVERSION];

const monthInput = z.object({
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  timeZone: z.string().min(1).max(64),
  groupId: z.number().int().positive().nullish(),
  /** "blue": todo pasado a dólares con el blue del día de cada gasto. */
  valuation: z.enum(['native', 'blue']).default('native'),
});

interface MonthlyAggregateRow {
  period: 'current' | 'previous';
  nativeCurrency: string;
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

/**
 * Sin filtro de grupo entra "todo gasto que me toca": los de mis grupos más los gastos sueltos en
 * los que participo. Con filtro de grupo, la membresía deja afuera a los grupos ajenos.
 */
const scopeFilterSql = (userId: number, groupId: number | null | undefined) =>
  groupId
    ? Prisma.sql`
          AND e."groupId" = ${groupId}
          AND e."groupId" IN (SELECT "groupId" FROM "GroupUser" WHERE "userId" = ${userId})`
    : Prisma.sql`
          AND (
            p."userId" IS NOT NULL
            OR e."groupId" IN (SELECT "groupId" FROM "GroupUser" WHERE "userId" = ${userId})
          )`;

/** Antes de una consulta en dólares, deja las cotizaciones al día (o avisa que no hay). */
const prepareValuation = async (valuation: Valuation) => {
  if ('blue' !== valuation) {
    return;
  }

  try {
    await ensureDolarBlueRates();
  } catch (error) {
    if (error instanceof DolarBlueUnavailableError) {
      throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'dolar_blue_unavailable' });
    }
    throw error;
  }
};

interface TrendAggregateRow {
  ym: string;
  currency: string;
  category: string;
  ours: bigint;
  mine: bigint;
}

export interface TrendSeries {
  currency: string;
  ours: bigint[];
  mine: bigint[];
  categories: { category: string; ours: bigint[]; mine: bigint[] }[];
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

    await prepareValuation(input.valuation);
    const offsetMinutes = Math.round(getTimeZoneOffsetMs(from, timeZone) / 60_000);
    const valued = valuationSql(
      input.valuation,
      expenseLocalDateSql(Prisma.sql`${offsetMinutes}::int`),
    );

    const rows = await db.$queryRaw<MonthlyAggregateRow[]>`
      WITH scoped AS (
        SELECT
          CASE
            WHEN e."expenseDate" >= ${fromLiteral}::timestamp THEN 'current'
            ELSE 'previous'
          END AS period,
          e.currency AS "nativeCurrency",
          ${valued.currency} AS currency,
          e.category AS category,
          ${valued.amount(Prisma.sql`e.amount`)} AS ours,
          ${valued.amount(memberShareSql(Prisma.sql`${userId}`))} AS mine
        FROM "Expense" e
        LEFT JOIN "ExpenseParticipant" p
          ON p."expenseId" = e.id AND p."userId" = ${userId}
        WHERE ${COUNTS_AS_SPENDING_SQL}
          AND ${expenseDateRangeSql(previousFrom, to)}
          ${scopeFilterSql(userId, groupId)}
          ${valued.filter}
      )
      SELECT
        period,
        "nativeCurrency",
        currency,
        category,
        SUM(ours)::bigint AS ours,
        SUM(mine)::bigint AS mine,
        COUNT(*)::int AS count
      FROM scoped
      GROUP BY period, "nativeCurrency", currency, category
    `;

    const current = new Map<string, CurrencyTotal>();
    const previousTotals = new Map<string, { currency: string; ours: bigint; mine: bigint }>();
    // Monedas en las que se cargaron los gastos del mes, más gastadora primero: son las opciones
    // Del selector de moneda aunque se esté viendo todo en dólares.
    const nativeTotals = new Map<string, bigint>();

    for (const row of rows) {
      if ('current' === row.period) {
        nativeTotals.set(
          row.nativeCurrency,
          (nativeTotals.get(row.nativeCurrency) ?? 0n) + row.ours,
        );
      }

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
        // En dólares, pesos y dólares de una misma categoría llegan en filas separadas.
        const category = entry.categories.find((item) => item.category === row.category);
        if (category) {
          category.ours += row.ours;
          category.mine += row.mine;
          category.count += row.count;
        } else {
          entry.categories.push({
            category: row.category,
            ours: row.ours,
            mine: row.mine,
            count: row.count,
          });
        }
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
      currencies: [...nativeTotals.entries()]
        .sort((a, b) => (a[1] > b[1] ? -1 : 1))
        .map(([currency]) => currency),
    };
  }),

  /**
   * Serie mes a mes (total y por categoría) de los `months` meses que terminan en el mes pedido,
   * para los gráficos de /stats. Una serie por moneda; en "blue", una sola en dólares.
   */
  monthlyTrend: protectedProcedure
    .input(monthInput.extend({ months: z.number().int().min(2).max(24).default(15) }))
    .query(async ({ ctx, input }): Promise<TrendSeries[]> => {
      const userId = ctx.session.user.id;
      const { year, month, timeZone, groupId, months } = input;

      /*
       * Los límites de cada mes (y el corrimiento horario para saber el día de cada gasto) salen
       * de la zona horaria del teléfono, igual que en `monthlySummary`; la base solo compara.
       */
      const first = addMonths({ year, month }, -(months - 1));
      const buckets = Array.from({ length: months }, (_, index) => {
        const current = addMonths(first, index);
        const range = getMonthRange(current.year, current.month, timeZone);
        return {
          key: `${current.year}-${String(current.month).padStart(2, '0')}`,
          from: toUtcTimestampLiteral(range.from),
          to: toUtcTimestampLiteral(range.to),
          offset: Math.round(getTimeZoneOffsetMs(range.from, timeZone) / 60_000),
        };
      });
      const monthKeys = buckets.map(({ key }) => key);

      await prepareValuation(input.valuation);
      const valued = valuationSql(input.valuation, expenseLocalDateSql(Prisma.sql`m.offset_min`));

      const rows = await db.$queryRaw<TrendAggregateRow[]>`
        WITH months AS (
          SELECT *
          FROM unnest(
            ${monthKeys}::text[],
            ${buckets.map(({ from }) => from)}::timestamp[],
            ${buckets.map(({ to }) => to)}::timestamp[],
            ${buckets.map(({ offset }) => offset)}::int[]
          ) AS m(ym, from_ts, to_ts, offset_min)
        ),
        scoped AS (
          SELECT
            m.ym AS ym,
            ${valued.currency} AS currency,
            e.category AS category,
            ${valued.amount(Prisma.sql`e.amount`)} AS ours,
            ${valued.amount(memberShareSql(Prisma.sql`${userId}`))} AS mine
          FROM "Expense" e
          JOIN months m ON e."expenseDate" >= m.from_ts AND e."expenseDate" < m.to_ts
          LEFT JOIN "ExpenseParticipant" p
            ON p."expenseId" = e.id AND p."userId" = ${userId}
          WHERE ${COUNTS_AS_SPENDING_SQL}
            AND e."expenseDate" >= ${buckets[0]!.from}::timestamp
            AND e."expenseDate" < ${buckets.at(-1)!.to}::timestamp
            ${scopeFilterSql(userId, groupId)}
            ${valued.filter}
        )
        SELECT ym, currency, category, SUM(ours)::bigint AS ours, SUM(mine)::bigint AS mine
        FROM scoped
        GROUP BY ym, currency, category
      `;

      const zeros = () => monthKeys.map(() => 0n);
      const series = new Map<string, TrendSeries>();

      for (const row of rows) {
        const index = monthKeys.indexOf(row.ym);
        if (-1 === index) {
          continue;
        }

        const entry = series.get(row.currency) ?? {
          currency: row.currency,
          ours: zeros(),
          mine: zeros(),
          categories: [],
        };
        let category = entry.categories.find((item) => item.category === row.category);
        if (!category) {
          category = { category: row.category, ours: zeros(), mine: zeros() };
          entry.categories.push(category);
        }

        entry.ours[index]! += row.ours;
        entry.mine[index]! += row.mine;
        category.ours[index]! += row.ours;
        category.mine[index]! += row.mine;
        series.set(row.currency, entry);
      }

      return [...series.values()];
    }),

  /** Expenses behind one category of one month, for the drill-down. */
  categoryExpenses: protectedProcedure
    .input(monthInput.extend({ currency: z.string().min(1).max(8), category: z.string().max(64) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { from, to } = getMonthRange(input.year, input.month, input.timeZone);
      const myGroupIds = await getMyGroupIds(userId);
      const inDollars = 'blue' === input.valuation;
      await prepareValuation(input.valuation);

      const expenses = await db.expense.findMany({
        where: {
          deletedAt: null,
          splitType: { notIn: NON_EXPENSE_SPLIT_TYPES },
          currency: inDollars
            ? { in: [BLUE_SOURCE_CURRENCY, BLUE_TARGET_CURRENCY] }
            : input.currency,
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

      const withShares = expenses.map((expense) => withMyShare(expense, userId));
      if (!inDollars) {
        return withShares;
      }

      // Los pesos se pasan a dólares con el blue del día del gasto, igual que en los totales.
      const localDay = (date: Date) => {
        const { year, month, day } = getZonedCalendarDay(input.timeZone, date);
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };
      const rates = await blueRateForDates(
        withShares
          .filter(({ currency }) => BLUE_SOURCE_CURRENCY === currency)
          .map(({ expenseDate }) => localDay(expenseDate)),
      );
      const toDollars = (amount: bigint, rate: number | undefined) =>
        rate ? BigInt(Math.round(Number(amount) / rate)) : 0n;

      return withShares.map((expense) => {
        if (BLUE_SOURCE_CURRENCY !== expense.currency) {
          return expense;
        }
        const rate = rates.get(localDay(expense.expenseDate));
        return {
          ...expense,
          currency: BLUE_TARGET_CURRENCY,
          amount: toDollars(expense.amount, rate),
          mine: toDollars(expense.mine, rate),
        };
      });
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
