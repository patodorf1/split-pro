import type { NextApiRequest, NextApiResponse } from 'next';

import { parseListLimit } from '~/lib/externalExpense';
import {
  createExternalEntry,
  getGroupBalances,
  guardExternalRequest,
  handleExternalError,
  listGroupExpenses,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';

/**
 * GET  /api/external/groups/{groupId}/expenses?limit=10 — últimos gastos + saldo del grupo.
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
      const limit = parseListLimit(readSingleQueryParam(req.query.limit));
      const [expenses, balances] = await Promise.all([
        listGroupExpenses(group.id, limit),
        getGroupBalances(group),
      ]);

      return res.status(200).json({ groupId: group.id, expenses, balances });
    }

    const { created, expense } = await createExternalEntry(group, req.body);
    const balances = await getGroupBalances(group);

    // 201 si se creó; 200 si la idempotencyKey ya existía y devolvemos el original.
    return res.status(created ? 201 : 200).json({ groupId: group.id, created, expense, balances });
  } catch (error) {
    return handleExternalError(res, error, `expenses ${req.method}`);
  }
}
