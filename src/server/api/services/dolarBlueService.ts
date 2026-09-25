import { Prisma } from '@prisma/client';

import { db } from '~/server/db';
import { blueSellSql } from '~/server/statsQueries';

/**
 * Cotización del dólar blue para las estadísticas "todo en dólares".
 *
 * bluelytics publica el histórico completo (desde 2011, un día hábil por fila) en un solo JSON
 * gratis y sin clave. La primera vez que alguien pide las estadísticas en dólares se baja todo y
 * se guarda en `DolarBlueRate`; después solo se vuelve a pedir cuando falta el día de hoy, y como
 * mucho una vez cada unas horas (fines de semana y feriados no hay cotización nueva).
 */

const EVOLUTION_URL = 'https://api.bluelytics.com.ar/v2/evolution.json';
const REFRESH_EVERY_MS = 3 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
/** Los últimos días se reescriben: la cotización de hoy cambia durante el día. */
const OVERWRITE_LAST_DAYS = 7;
const AR_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export class DolarBlueUnavailableError extends Error {}

interface EvolutionRow {
  date: string;
  source: string;
  value_sell: number;
  value_buy: number;
}

export interface BlueRate {
  date: string; // YYYY-MM-DD
  buy: number;
  sell: number;
}

/** Filas "Blue" válidas del JSON de bluelytics, una por día. */
export const parseEvolution = (payload: unknown): BlueRate[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  const byDate = new Map<string, BlueRate>();
  for (const row of payload as EvolutionRow[]) {
    if (
      'Blue' === row?.source &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      0 < Number(row.value_sell) &&
      0 < Number(row.value_buy)
    ) {
      byDate.set(row.date, {
        date: row.date,
        buy: Number(row.value_buy),
        sell: Number(row.value_sell),
      });
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

const todayInArgentina = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: AR_TIME_ZONE }).format(now);

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);

const fetchEvolution = async (): Promise<BlueRate[]> => {
  const response = await fetch(EVOLUTION_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`bluelytics respondió ${response.status}`);
  }

  return parseEvolution(await response.json());
};

const saveRates = async (rates: BlueRate[]) => {
  if (0 === rates.length) {
    return;
  }

  const now = new Date();
  const recentFrom = rates[Math.max(0, rates.length - OVERWRITE_LAST_DAYS)]!.date;
  const recent = rates.filter(({ date }) => date >= recentFrom);

  await db.$transaction([
    db.dolarBlueRate.createMany({
      data: rates.map(({ date, buy, sell }) => ({
        date: toDateOnly(date),
        buy,
        sell,
        updatedAt: now,
      })),
      skipDuplicates: true,
    }),
    ...recent.map(({ date, buy, sell }) =>
      db.dolarBlueRate.update({ where: { date: toDateOnly(date) }, data: { buy, sell } }),
    ),
  ]);
};

let lastAttempt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Deja la tabla al día antes de una consulta en dólares. Si bluelytics no contesta pero ya hay
 * cotizaciones guardadas, sigue con lo que hay (a lo sumo faltan los últimos días). Solo falla si
 * la tabla está vacía y no se pudo llenar.
 */
export const ensureDolarBlueRates = async (): Promise<void> => {
  const latest = await db.dolarBlueRate.findFirst({
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  const upToDate = latest && latest.date.toISOString().slice(0, 10) >= todayInArgentina();

  if (upToDate || (latest && Date.now() - lastAttempt < REFRESH_EVERY_MS)) {
    return;
  }

  inFlight ??= (async () => {
    lastAttempt = Date.now();
    try {
      await saveRates(await fetchEvolution());
    } catch (error) {
      console.error('No se pudo actualizar el dólar blue', error);
    } finally {
      inFlight = null;
    }
  })();
  await inFlight;

  if (!latest && 0 === (await db.dolarBlueRate.count())) {
    throw new DolarBlueUnavailableError('Sin cotizaciones del dólar blue');
  }
};

/**
 * Venta del blue vigente en cada fecha (YYYY-MM-DD): la del mismo día o la del último día anterior
 * con cotización (fines de semana, feriados). Si la fecha es anterior a todo el histórico usa la
 * primera. Es el mismo criterio que `blueSellSql`.
 */
export const blueSellForDates = async (dates: string[]): Promise<Map<string, number>> => {
  const unique = [...new Set(dates)];
  if (0 === unique.length) {
    return new Map();
  }

  const rows = await db.$queryRaw<{ day: string; sell: number | null }[]>`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, ${blueSellSql(Prisma.sql`d.day`)} AS sell
    FROM unnest(${unique}::date[]) AS d(day)
  `;

  return new Map(
    rows.flatMap(({ day, sell }) => (null === sell ? [] : [[day, Number(sell)] as const])),
  );
};
