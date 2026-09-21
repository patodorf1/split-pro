import type { NextApiRequest, NextApiResponse } from 'next';

import { SUMMARY_TIME_ZONE, formatDay, parseExpenseListQuery } from '~/lib/externalSummary';
import { getZonedCalendarDay } from '~/lib/stats';
import {
  createExternalEntry,
  getGroupBalances,
  guardExternalRequest,
  handleExternalError,
  listExpensesByIds,
  listGroupExpenses,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { findFilteredExpenseIds } from '~/server/externalSummary';

/**
 * GET  /api/external/groups/{groupId}/expenses?limit=10 — últimos gastos + saldo del grupo.
 *      Filtros opcionales: from, to, category, q, paidBy, type y paginación con offset.
 * POST /api/external/groups/{groupId}/expenses          — carga un gasto o una transferencia.
 *
 * Pensado para el asistente por WhatsApp. Ver docs/EXTERNAL_API.md, sección "Gastos".
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('GET' !== req.method && 'POST' !== req.method) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));

    if ('GET' === req.method) {
      const query = parseExpenseListQuery(req.query, getZonedCalendarDay(SUMMARY_TIME_ZONE));

      // Sin parámetros nuevos, exactamente el listado de siempre (compatibilidad).
      if (!query.filtered) {
        const [expenses, balances] = await Promise.all([
          listGroupExpenses(group.id, query.limit),
          getGroupBalances(group),
        ]);

        return res.status(200).json({ groupId: group.id, expenses, balances });
      }

      const [found, balances] = await Promise.all([
        findFilteredExpenseIds(group, query),
        getGroupBalances(group),
      ]);
      const expenses = await listExpensesByIds(found.ids);

      return res.status(200).json({
        groupId: group.id,
        expenses,
        balances,
        filters: {
          from: query.period ? formatDay(query.period.from) : null,
          to: query.period ? formatDay(query.period.to) : null,
          category: query.categories ?? null,
          q: query.search?.raw ?? null,
          paidBy: found.paidBy,
          type: query.type ?? null,
        },
        pagination: {
          limit: query.limit,
          offset: query.offset,
          nextOffset: found.hasMore ? query.offset + query.limit : null,
        },
      });
    }

    const { created, expense } = await createExternalEntry(group, req.body);
    const balances = await getGroupBalances(group);

    // 201 si se creó; 200 si la idempotencyKey ya existía y devolvemos el original.
    return res.status(created ? 201 : 200).json({ groupId: group.id, created, expense, balances });
  } catch (error) {
    return handleExternalError(res, error, `expenses ${req.method}`);
  }
}
