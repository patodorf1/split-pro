/**
 * "Categorías rápidas": el renglón de botones que aparece arriba de descripción y monto en
 * Agregar gasto, con las categorías que más se usan en el grupo elegido.
 *
 * Acá vive solo la parte pura (ordenar y completar el ranking) para poder testearla sin base.
 * Las cuentas por categoría las hace el router `stats` con un groupBy.
 */

import { DEFAULT_CATEGORY, isKnownCategory } from '~/lib/category';

/** Cuántos botones entran en un renglón de celular. */
export const TOP_CATEGORIES_LIMIT = 6;

/** Ventana "reciente": lo de los últimos 12 meses pesa más que el histórico. */
export const TOP_CATEGORIES_RECENT_MONTHS = 12;

export interface CategoryUsage {
  category: string;
  count: number;
}

/**
 * Deja solo categorías mostrables (conocidas, distintas de `general` y con uso) y las ordena por
 * cantidad de gastos. Ante empate manda el orden alfabético, así el renglón no baila entre
 * recargas.
 */
const rankUsages = (usages: CategoryUsage[]): string[] =>
  usages
    .filter(
      ({ category, count }) =>
        0 < count && DEFAULT_CATEGORY !== category && isKnownCategory(category),
    )
    .toSorted((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .map(({ category }) => category);

/**
 * Ranking final: primero lo usado en la ventana reciente y, si no llega a `limit`, se completa con
 * el histórico completo (sin repetir) para que un grupo nuevo o poco usado igual muestre botones.
 */
export const rankTopCategories = (
  recent: CategoryUsage[],
  allTime: CategoryUsage[] = [],
  limit: number = TOP_CATEGORIES_LIMIT,
): string[] => {
  const top = rankUsages(recent).slice(0, limit);

  if (top.length >= limit) {
    return top;
  }

  for (const category of rankUsages(allTime)) {
    if (top.length >= limit) {
      break;
    }
    if (!top.includes(category)) {
      top.push(category);
    }
  }

  return top;
};

/** Instante a partir del cual un gasto cuenta como "reciente". */
export const monthsAgo = (months: number, now: Date = new Date()): Date => {
  const from = new Date(now.getTime());
  from.setUTCMonth(from.getUTCMonth() - months);

  return from;
};
