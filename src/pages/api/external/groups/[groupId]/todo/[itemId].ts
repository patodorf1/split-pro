import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalTodoPatch } from '~/lib/externalTodo';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { deleteExternalTodo, parseTodoItemId, updateExternalTodo } from '~/server/externalTodo';

/**
 * PATCH  /api/external/groups/{groupId}/todo/{itemId} — cambia el título o la marca de hecha.
 * DELETE /api/external/groups/{groupId}/todo/{itemId} — borra la tarea (como la app).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('PATCH' !== req.method && 'DELETE' !== req.method) {
    res.setHeader('Allow', 'PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));
    const itemId = parseTodoItemId(readSingleQueryParam(req.query.itemId));

    if ('PATCH' === req.method) {
      const item = await updateExternalTodo(group, itemId, parseExternalTodoPatch(req.body));

      return res.status(200).json({ groupId: group.id, item });
    }

    const item = await deleteExternalTodo(group, itemId);

    return res.status(200).json({ groupId: group.id, deleted: true, item });
  } catch (error) {
    return handleExternalError(res, error, `todo item ${req.method}`);
  }
}
