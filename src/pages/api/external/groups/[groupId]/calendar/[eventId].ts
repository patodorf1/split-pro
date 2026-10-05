import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalEventPatch } from '~/lib/externalCalendar';
import { deleteExternalEvent, parseEventId, updateExternalEvent } from '~/server/externalCalendar';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';

/**
 * PATCH  /api/external/groups/{groupId}/calendar/{eventId} — cambia solo los campos que vienen.
 * DELETE /api/external/groups/{groupId}/calendar/{eventId} — borra el evento (como la app).
 *
 * Solo eventos propios de la Agenda; vencimientos y gastos recurrentes se cambian en la app.
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
    const eventId = parseEventId(readSingleQueryParam(req.query.eventId));

    if ('PATCH' === req.method) {
      const event = await updateExternalEvent(group, eventId, parseExternalEventPatch(req.body));

      return res.status(200).json({ groupId: group.id, event });
    }

    const event = await deleteExternalEvent(group, eventId);

    return res.status(200).json({ groupId: group.id, deleted: true, event });
  } catch (error) {
    return handleExternalError(res, error, `calendar event ${req.method}`);
  }
}
