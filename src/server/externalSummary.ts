import { Prisma } from '@prisma/client';

import { minorToUnits, resolveMember } from '~/lib/externalExpense';
import {
  type EntryKind,
  type ExpenseListQuery,
  SEARCH_ACCENTED,
  SEARCH_PLAIN,
  SUMMARY_TIME_ZONE,
  type SummaryDimension,
  type SummaryQuery,
  buildSummaryText,
  categoryDisplayName,
  formatDay,
  formatMoney,
  monthKeyLabel,
  monthKeysOf,
  periodToInstants,
} from '~/lib/externalSummary';
import { percentageOf } from '~/lib/stats';
import { db } from '~/server/db';
import type { LoadedGroup } from '~/server/externalExpenses';
import { COUNTS_AS_SPENDING_SQL, expenseDateRangeSql, memberShareSql } from '~/server/statsQueries';

/**
 * Consultas de solo lectura de la API externa (asistente por WhatsApp): el resumen
 * `GET /api/external/groups/{id}/summary` y los filtros del listado de gastos.
 *
 * Toda la agregación la hace la base (nunca se traen miles de gastos a memoria) y el criterio de
 * "qué es un gasto" y "la parte de cada uno" sale de `statsQueries`, el mismo SQL de /stats.
 */

/** Qué movimientos entran: gastos (como /stats), transferencias (saldo) o solo SETTLEMENT. */
type MovementKind = EntryKind | 'settlement';

interface MovementFilters {
  groupId: number;
  kind?: MovementKind;
  range?: { start: Date; end: Date };
  categories?: string[];
  search?: string;
  paidById?: number;
}

const movementKindSql = (kind: MovementKind | undefined) => {
  switch (kind) {
    case 'expense':
      return COUNTS_AS_SPENDING_SQL;
    case 'transfer':
      return Prisma.sql`e."deletedAt" IS NULL
        AND e."splitType" IN ('SETTLEMENT', 'CURRENCY_CONVERSION')`;
    case 'settlement':
      return Prisma.sql`e."deletedAt" IS NULL AND e."splitType" = 'SETTLEMENT'`;
    default:
      return Prisma.sql`e."deletedAt" IS NULL`;
  }
};

/**
 * WHERE de los filtros. Todo valor que viene del usuario va como parámetro. La búsqueda compara
 * la descripción sin acentos y en minúsculas con `strpos` (no `LIKE`, así un `%` o un `_` en el
 * texto buscado son caracteres comunes y no comodines).
 */
const movementWhereSql = (filters: MovementFilters): Prisma.Sql => {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`e."groupId" = ${filters.groupId}`,
    movementKindSql(filters.kind),
  ];

  if (filters.range) {
    conditions.push(expenseDateRangeSql(filters.range.start, filters.range.end));
  }
  if (filters.categories?.length) {
    conditions.push(Prisma.sql`e.category IN (${Prisma.join(filters.categories)})`);
  }
  if (filters.search) {
    conditions.push(
      Prisma.sql`strpos(lower(translate(e.name, ${SEARCH_ACCENTED}, ${SEARCH_PLAIN})), ${filters.search}) > 0`,
    );
  }
  if (undefined !== filters.paidById) {
    conditions.push(Prisma.sql`e."paidBy" = ${filters.paidById}`);
  }

  return Prisma.join(conditions, ' AND ');
};

const MEMBER_SELECT = { id: true, name: true, email: true } as const;

interface Person {
  id: number;
  name: string | null;
  email: string | null;
}

const serializePerson = (user: Person) => ({ id: user.id, name: user.name, email: user.email });

const displayName = (person: Person) => person.name ?? person.email ?? `#${person.id}`;

const money = (minor: bigint, currency: string) => ({
  total: minorToUnits(minor, currency),
  formatted: formatMoney(minor, currency),
});

// ── Listado filtrado ─────────────────────────────────────────────────────────────────────────

/**
 * Ids de los gastos que cumplen los filtros, en el mismo orden que el listado de siempre (fecha
 * del gasto y de carga, descendente). Pide uno de más para saber si hay otra página.
 */
export const findFilteredExpenseIds = async (
  group: Pick<LoadedGroup, 'id' | 'members'>,
  query: ExpenseListQuery,
): Promise<{ ids: string[]; hasMore: boolean; paidBy: Person | null }> => {
  const paidBy = query.paidBy ? resolveMember(query.paidBy, group.members, 'paidBy') : null;

  const where = movementWhereSql({
    groupId: group.id,
    kind: query.type,
    range: query.period ? periodToInstants(query.period) : undefined,
    categories: query.categories,
    search: query.search?.normalized,
    paidById: paidBy?.id,
  });

  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT e.id::text AS id
    FROM "Expense" e
    WHERE ${where}
    ORDER BY e."expenseDate" DESC, e."createdAt" DESC
    LIMIT ${query.limit + 1}
    OFFSET ${query.offset}
  `;

  return {
    ids: rows.slice(0, query.limit).map((row) => row.id),
    hasMore: rows.length > query.limit,
    paidBy: paidBy ? serializePerson(paidBy) : null,
  };
};

// ── Resumen ──────────────────────────────────────────────────────────────────────────────────

interface TotalsRow {
  currency: string;
  paidBy: number;
  total: bigint;
  count: number;
}

interface SharesRow {
  currency: string;
  userId: number;
  share: bigint;
}

interface BreakdownRow {
  currency: string;
  month: string | null;
  category: string | null;
  paidBy: number | null;
  total: bigint;
  count: number;
}

interface TransfersRow {
  currency: string;
  total: bigint;
  count: number;
}

/** Columnas del desglose; el mes se calcula en la zona de Buenos Aires, como los rangos. */
const dimensionColumns = (groupBy: SummaryDimension[]) => ({
  month: groupBy.includes('month')
    ? Prisma.sql`to_char((e."expenseDate" AT TIME ZONE 'UTC') AT TIME ZONE ${SUMMARY_TIME_ZONE}, 'YYYY-MM')`
    : Prisma.sql`NULL::text`,
  category: groupBy.includes('category') ? Prisma.sql`e.category` : Prisma.sql`NULL::text`,
  paidBy: groupBy.includes('payer') ? Prisma.sql`e."paidBy"` : Prisma.sql`NULL::int`,
});

export const getGroupSummary = async (group: LoadedGroup, query: SummaryQuery) => {
  const payer = query.paidBy ? resolveMember(query.paidBy, group.members, 'paidBy') : null;
  const range = periodToInstants(query.period);

  const expenseWhere = movementWhereSql({
    groupId: group.id,
    kind: 'expense',
    range,
    categories: query.categories,
    search: query.search?.normalized,
    paidById: payer?.id,
  });

  const columns = dimensionColumns(query.groupBy);

  // Las transferencias no tienen categoría: con filtro de categoría no hay bloque de transferencias.
  const transfersQuery = query.categories?.length
    ? Promise.resolve(null)
    : db.$queryRaw<TransfersRow[]>`
        SELECT e.currency, SUM(e.amount)::bigint AS total, COUNT(*)::int AS count
        FROM "Expense" e
        WHERE ${movementWhereSql({
          groupId: group.id,
          kind: 'settlement',
          range,
          search: query.search?.normalized,
          paidById: payer?.id,
        })}
        GROUP BY e.currency
      `;

  const [totalsRows, sharesRows, breakdownRows, transfersRows] = await Promise.all([
    db.$queryRaw<TotalsRow[]>`
      SELECT e.currency, e."paidBy" AS "paidBy", SUM(e.amount)::bigint AS total, COUNT(*)::int AS count
      FROM "Expense" e
      WHERE ${expenseWhere}
      GROUP BY e.currency, e."paidBy"
    `,
    db.$queryRaw<SharesRow[]>`
      SELECT e.currency, p."userId" AS "userId", SUM(${memberShareSql(Prisma.sql`p."userId"`)})::bigint AS share
      FROM "Expense" e
      JOIN "ExpenseParticipant" p ON p."expenseId" = e.id
      WHERE ${expenseWhere}
      GROUP BY e.currency, p."userId"
    `,
    0 < query.groupBy.length
      ? db.$queryRaw<BreakdownRow[]>`
          SELECT e.currency, ${columns.month} AS month, ${columns.category} AS category,
            ${columns.paidBy} AS "paidBy", SUM(e.amount)::bigint AS total, COUNT(*)::int AS count
          FROM "Expense" e
          WHERE ${expenseWhere}
          GROUP BY 1, 2, 3, 4
        `
      : Promise.resolve([] as BreakdownRow[]),
    transfersQuery,
  ]);

  // Personas: los miembros del grupo y, si hay, gente que ya no es miembro pero figura en gastos.
  const people = new Map<number, Person>(group.members.map((m) => [m.id, serializePerson(m)]));
  const missing = [
    ...new Set([
      ...totalsRows.map((row) => row.paidBy),
      ...sharesRows.map((row) => row.userId),
      ...breakdownRows.flatMap((row) => (null === row.paidBy ? [] : [row.paidBy])),
    ]),
  ].filter((id) => !people.has(id));

  if (missing.length) {
    const users = await db.user.findMany({ where: { id: { in: missing } }, select: MEMBER_SELECT });
    users.forEach((user) => people.set(user.id, serializePerson(user)));
  }

  const personOf = (id: number): Person => people.get(id) ?? { id, name: null, email: null };
  const personIds = [...people.keys()].toSorted((a, b) => a - b);

  // Monedas con gastos; la del grupo siempre aparece (en cero si no hubo nada).
  const currencies = [
    ...new Set([
      ...(group.defaultCurrency ? [group.defaultCurrency] : []),
      ...totalsRows.map((row) => row.currency),
    ]),
  ].toSorted((a, b) =>
    a === group.defaultCurrency ? -1 : b === group.defaultCurrency ? 1 : a.localeCompare(b),
  );

  const onlyByMonth = 1 === query.groupBy.length && 'month' === query.groupBy[0];

  const perCurrency = currencies.map((currency) => {
    const rows = totalsRows.filter((row) => row.currency === currency);
    const total = rows.reduce((acc, row) => acc + row.total, 0n);
    const count = rows.reduce((acc, row) => acc + row.count, 0);
    const paidOf = (id: number) =>
      rows.filter((row) => row.paidBy === id).reduce((acc, row) => acc + row.total, 0n);
    const shareOf = (id: number) =>
      sharesRows
        .filter((row) => row.currency === currency && row.userId === id)
        .reduce((acc, row) => acc + row.share, 0n);

    const currencyRows = breakdownRows.filter((row) => row.currency === currency);

    // Solo por mes: los meses sin gastos aparecen en cero ("mes por mes" no se saltea ninguno).
    if (onlyByMonth) {
      const present = new Set(currencyRows.map((row) => row.month));
      monthKeysOf(query.period)
        .filter((key) => !present.has(key))
        .forEach((key) =>
          currencyRows.push({
            currency,
            month: key,
            category: null,
            paidBy: null,
            total: 0n,
            count: 0,
          }),
        );
    }

    const breakdown = currencyRows
      .toSorted((a, b) => {
        // Por mes: cronológico; dentro del mes (o sin mes), de mayor a menor.
        if (a.month !== b.month) {
          return (a.month ?? '').localeCompare(b.month ?? '');
        }
        return a.total === b.total ? 0 : a.total > b.total ? -1 : 1;
      })
      .map((row) => ({
        ...(null !== row.month ? { month: row.month, monthName: monthKeyLabel(row.month) } : {}),
        ...(null !== row.category
          ? { category: row.category, categoryName: categoryDisplayName(row.category) }
          : {}),
        ...(null !== row.paidBy ? { payer: personOf(row.paidBy) } : {}),
        ...money(row.total, currency),
        totalMinor: row.total,
        count: row.count,
        percentage: Math.round(percentageOf(row.total, total) * 10) / 10,
      }));

    return {
      currency,
      total,
      count,
      paid: personIds.map((id) => ({ person: personOf(id), amount: paidOf(id) })),
      shares: personIds.map((id) => ({ person: personOf(id), amount: shareOf(id) })),
      breakdown,
    };
  });

  const text = buildSummaryText({
    period: query.period,
    groupBy: query.groupBy,
    categoryNames: query.categories?.map(categoryDisplayName),
    search: query.search?.raw,
    payerName: payer ? displayName(payer) : undefined,
    currencies: perCurrency.map((entry) => ({
      currency: entry.currency,
      total: entry.total,
      count: entry.count,
      paid: entry.paid.map(({ person, amount }) => ({ name: displayName(person), amount })),
      breakdown: entry.breakdown.map((item) => ({
        month: item.month,
        categoryName: item.categoryName,
        payerName: item.payer ? displayName(item.payer) : undefined,
        total: item.totalMinor,
        percentage: item.percentage,
      })),
    })),
  });

  const withPerson = (currency: string) => (entry: { person: Person; amount: bigint }) => {
    const { total, formatted } = money(entry.amount, currency);
    return { ...entry.person, amount: total, formatted };
  };

  return {
    groupId: group.id,
    groupName: group.name,
    period: {
      from: formatDay(query.period.from),
      to: formatDay(query.period.to),
      timeZone: SUMMARY_TIME_ZONE,
    },
    filters: {
      category: query.categories?.map((key) => ({ key, name: categoryDisplayName(key) })) ?? null,
      q: query.search?.raw ?? null,
      paidBy: payer ? serializePerson(payer) : null,
    },
    groupBy: query.groupBy,
    currencies: perCurrency.map((entry) =>
      Object.assign(
        { currency: entry.currency },
        money(entry.total, entry.currency),
        {
          count: entry.count,
          paid: entry.paid.map(withPerson(entry.currency)),
          shares: entry.shares.map(withPerson(entry.currency)),
        },
        0 < query.groupBy.length
          ? { breakdown: entry.breakdown.map(({ totalMinor: _omit, ...item }) => item) }
          : {},
      ),
    ),
    transfers: transfersRows
      ? transfersRows
          .toSorted((a, b) => a.currency.localeCompare(b.currency))
          .map((row) =>
            Object.assign({ currency: row.currency }, money(row.total, row.currency), {
              count: row.count,
            }),
          )
      : null,
    text,
  };
};
