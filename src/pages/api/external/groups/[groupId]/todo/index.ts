import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalTodoAdd, parseExternalTodoQuery } from '~/lib/externalTodo';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { addExternalTodo, listExternalTodo } from '~/server/externalTodo';

/**
 * GET  /api/external/groups/{groupId}/todo?done=10 — lo pendiente del To Do y las últimas hechas.
 * POST /api/external/groups/{groupId}/todo         — suma tareas; lo que ya está pendiente no se
 *      repite.
 *
 * Pensado para Charly. Ver docs/EXTERNAL_API.md, sección "To Do".
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
      return res.status(200).json(await listExternalTodo(group, parseExternalTodoQuery(req.query)));
    }

    const added = await addExternalTodo(group, parseExternalTodoAdd(req.body));

    return res.status(200).json(added);
  } catch (error) {
    return handleExternalError(res, error, `todo ${req.method}`);
  }
}
