/**
 * Cuentas de los gráficos de /stats: barras mes a mes y qué categoría sube o baja. Sin efectos
 * secundarios, para poder testearlas.
 */

import { type YearMonth, addMonths, compareYearMonth } from '~/lib/stats';

/** Meses que se muestran en las barras. */
export const TREND_VISIBLE_MONTHS = 12;
/** Meses anteriores contra los que se compara el mes elegido en "qué está subiendo". */
export const TREND_BASELINE_MONTHS = 3;
/** Lo que se le pide al servidor: lo visible más la base de comparación del primer mes visible. */
export const TREND_FETCH_MONTHS = TREND_VISIBLE_MONTHS + TREND_BASELINE_MONTHS;

/**
 * Último mes de las barras. Normalmente el mes actual, para que tocar una barra no corra el
 * gráfico; si el mes elegido quedó más atrás que lo visible, el gráfico termina en ese mes.
 */
export const trendWindowEnd = (selected: YearMonth, current: YearMonth): YearMonth =>
  compareYearMonth(selected, addMonths(current, -(TREND_VISIBLE_MONTHS - 1))) < 0
    ? selected
    : current;

/** Los `count` meses que terminan en `end`, del más viejo al más nuevo. */
export const monthsEndingAt = (end: YearMonth, count: number): YearMonth[] =>
  Array.from({ length: count }, (_, index) => addMonths(end, index - (count - 1)));

export const indexOfMonth = (months: YearMonth[], month: YearMonth): number =>
  months.findIndex((candidate) => 0 === compareYearMonth(candidate, month));

/** Promedio (redondeado) de una lista de montos; 0 si está vacía. */
export const averageOf = (values: bigint[]): bigint =>
  0 === values.length ? 0n : values.reduce((sum, value) => sum + value, 0n) / BigInt(values.length);

/** Promedio de los meses con gastos (los meses vacíos no bajan el promedio). */
export const averageOfNonZero = (values: bigint[]): bigint =>
  averageOf(values.filter((value) => 0n !== value));

export interface CategoryTrend {
  category: string;
  current: bigint;
  baseline: bigint;
  /** Diferencia en %, `null` si antes no había gastos en la categoría (es nueva). */
  change: number | null;
}

/**
 * Cada categoría en el mes `index` contra el promedio de los `TREND_BASELINE_MONTHS` meses
 * anteriores. Ordenadas por cuánta plata subieron (lo que más creció en pesos, primero): así una
 * categoría chica que pasa de 100 a 300 no tapa a una grande que sube un 20%.
 */
export const categoryTrends = (
  categories: { category: string; values: bigint[] }[],
  index: number,
): CategoryTrend[] =>
  categories
    .map(({ category, values }) => {
      const current = values[index] ?? 0n;
      const baseline = averageOf(values.slice(Math.max(0, index - TREND_BASELINE_MONTHS), index));
      const change =
        0n === baseline
          ? null
          : ((Number(current) - Number(baseline)) / Math.abs(Number(baseline))) * 100;

      return { category, current, baseline, change };
    })
    .filter(({ current, baseline }) => 0n !== current || 0n !== baseline)
    .sort((a, b) => {
      const diff = b.current - b.baseline - (a.current - a.baseline);
      return 0n < diff ? 1 : 0n > diff ? -1 : a.category.localeCompare(b.category);
    });
