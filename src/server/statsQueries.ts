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
