import { Prisma } from '@prisma/client';

import { toUtcTimestampLiteral } from '~/lib/stats';

/**
 * Pedazos de SQL compartidos entre las estadísticas de la app (router tRPC `stats`) y las consultas
 * de la API externa (`/api/external/groups/{id}/summary`). Si cambia el criterio de qué cuenta como
 * gasto, cambia en los dos lados a la vez: así el total que contesta el asistente coincide siempre
 * con el que se ve en /stats y en Inicio.
 *
 * Todos asumen el alias `e` para "Expense" y `p` para "ExpenseParticipant".
 */

/**
 * Un gasto cuenta como gasto del hogar si no está borrado y no es un movimiento de saldo
 * (transferencia o conversión de moneda).
 */
export const COUNTS_AS_SPENDING_SQL = Prisma.sql`e."deletedAt" IS NULL
  AND e."splitType" NOT IN ('SETTLEMENT', 'CURRENCY_CONVERSION')`;

/**
 * `expenseDate` es `timestamp without time zone` con la hora UTC, así que se compara contra un
 * literal UTC y no contra la zona horaria de la sesión de la base. Intervalo semiabierto [from, to).
 */
export const expenseDateRangeSql = (from: Date, to: Date) =>
  Prisma.sql`e."expenseDate" >= ${toUtcTimestampLiteral(from)}::timestamp
    AND e."expenseDate" < ${toUtcTimestampLiteral(to)}::timestamp`;

/**
 * Parte de un gasto que le toca a una persona. La fila del participante guarda "lo que pagó menos
 * su parte", así que quien pagó queda en positivo y el resto en negativo; esto lo da vuelta.
 * `userIdSql` es la persona: un parámetro (`${userId}`) o una columna (`p."userId"`).
 */
export const memberShareSql = (userIdSql: Prisma.Sql) =>
  Prisma.sql`COALESCE(
    CASE WHEN e."paidBy" = ${userIdSql} THEN e.amount - p.amount ELSE -p.amount END,
    0
  )`;

/** Cómo se muestran los montos: cada gasto en su moneda, o todo pasado a dólares al blue. */
export type Valuation = 'native' | 'blue';

/** Moneda en la que se expresan las estadísticas "todo en dólares". */
export const BLUE_TARGET_CURRENCY = 'USD';
/** Monedas que entran en el modo "todo en dólares": los pesos se convierten, los dólares quedan. */
export const BLUE_SOURCE_CURRENCY = 'ARS';

/**
 * Fecha local (tipo `date`) de un gasto, corriendo la hora UTC `offsetMinutesSql` minutos. El
 * corrimiento lo calcula la app con la zona horaria del teléfono: así Postgres no necesita
 * reconocer el nombre de la zona (los navegadores mandan a veces alias viejos, como
 * "America/Buenos_Aires", que la base rechaza).
 */
export const expenseLocalDateSql = (offsetMinutesSql: Prisma.Sql) =>
  Prisma.sql`(e."expenseDate" + make_interval(mins => ${offsetMinutesSql}))::date`;

/**
 * Venta del blue vigente en la fecha `dateSql` (una expresión `date`): la del mismo día o la del
 * último día anterior con cotización. Antes de todo el histórico, la primera que haya.
 */
export const blueSellSql = (dateSql: Prisma.Sql) => Prisma.sql`COALESCE(
    (SELECT r.sell FROM "DolarBlueRate" r WHERE r.date <= ${dateSql} ORDER BY r.date DESC LIMIT 1),
    (SELECT r.sell FROM "DolarBlueRate" r ORDER BY r.date ASC LIMIT 1)
  )`;

/**
 * Piezas de SQL según la valuación elegida. En "native" no cambia nada. En "blue" solo entran
 * pesos y dólares, los pesos se dividen por la venta del blue del día del gasto y todo sale como
 * dólares. `localDateSql` es la fecha local del gasto (ver `expenseLocalDateSql`). Los montos son enteros en centavos en las dos monedas, así que la división da centavos
 * de dólar directamente.
 */
export const valuationSql = (valuation: Valuation, localDateSql: Prisma.Sql) => {
  if ('native' === valuation) {
    return {
      currency: Prisma.sql`e.currency`,
      amount: (amountSql: Prisma.Sql) => amountSql,
      filter: Prisma.empty,
    };
  }

  const sell = blueSellSql(localDateSql);

  return {
    currency: Prisma.sql`${BLUE_TARGET_CURRENCY}`,
    amount: (amountSql: Prisma.Sql) => Prisma.sql`CASE
        WHEN e.currency = ${BLUE_SOURCE_CURRENCY} THEN ROUND((${amountSql}) / ${sell})::bigint
        ELSE (${amountSql})::bigint
      END`,
    filter: Prisma.sql`AND e.currency IN (${BLUE_SOURCE_CURRENCY}, ${BLUE_TARGET_CURRENCY})`,
  };
};
