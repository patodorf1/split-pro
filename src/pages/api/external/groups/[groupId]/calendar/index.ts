import type { NextApiRequest, NextApiResponse } from 'next';

import { REMINDER_TIME_ZONE } from '~/lib/documentReminders';
import { parseExternalAgendaQuery, parseExternalEventCreate } from '~/lib/externalCalendar';
import { getZonedCalendarDay } from '~/lib/stats';
import { createExternalEvent, listGroupAgenda } from '~/server/externalCalendar';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';

/**
 * GET  /api/external/groups/{groupId}/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&q=texto
 *      Lo que muestra la Agenda para ese grupo: eventos, vencimientos y gastos recurrentes.
 *      Sin fechas, hoy y los 13 días siguientes.
 * POST /api/external/groups/{groupId}/calendar — carga un evento.
 *
 * Pensado para el asistente por WhatsApp. Ver docs/EXTERNAL_API.md, sección "Agenda".
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
      const query = parseExternalAgendaQuery(req.query, getZonedCalendarDay(REMINDER_TIME_ZONE));

      return res.status(200).json(await listGroupAgenda(group, query));
    }

    const { created, event } = await createExternalEvent(group, parseExternalEventCreate(req.body));

    // 201 si se creó; 200 si ya había uno igual y devolvemos ese.
    return res.status(created ? 201 : 200).json({ groupId: group.id, created, event });
  } catch (error) {
    return handleExternalError(res, error, `calendar ${req.method}`);
  }
}
