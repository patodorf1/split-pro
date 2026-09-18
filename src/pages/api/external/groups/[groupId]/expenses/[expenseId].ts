import type { NextApiRequest, NextApiResponse } from 'next';

import { ExternalApiError, isUuid, parsePersonRef, resolveMember } from '~/lib/externalExpense';
import {
  deleteExternalEntry,
  getGroupBalances,
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';

/**
 * DELETE /api/external/groups/{groupId}/expenses/{expenseId}?deletedBy=<email|id>
 *
 * Borrado lógico (como la app) de un gasto cargado por la API, para que el asistente pueda
 * deshacer un error. No borra gastos cargados desde la app.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('DELETE' !== req.method) {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));
    const expenseId = readSingleQueryParam(req.query.expenseId);

    if (!isUuid(expenseId)) {
      throw new ExternalApiError(
        404,
        'expense_not_found',
        'Gasto no encontrado en este grupo',
        'Expense not found in this group',
      );
    }

    const body: unknown = req.body;
    const fromBody =
      body && 'object' === typeof body && 'deletedBy' in body ? body.deletedBy : undefined;
    const deletedByRef = parsePersonRef(readSingleQueryParam(req.query.deletedBy) ?? fromBody);

    if (undefined === deletedByRef) {
      throw new ExternalApiError(
        400,
        'validation_error',
        'deletedBy: es obligatorio (email o id de un miembro)',
        'deletedBy: is required (member email or id)',
        'deletedBy',
      );
    }

    const deletedBy = resolveMember(deletedByRef, group.members, 'deletedBy');
    const expense = await deleteExternalEntry(group, expenseId, deletedBy);
    const balances = await getGroupBalances(group);

    return res.status(200).json({ groupId: group.id, deleted: true, expense, balances });
  } catch (error) {
    return handleExternalError(res, error, 'expense DELETE');
  }
}
