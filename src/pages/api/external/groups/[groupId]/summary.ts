import type { NextApiRequest, NextApiResponse } from 'next';

import { SUMMARY_TIME_ZONE, parseSummaryQuery } from '~/lib/externalSummary';
import { getZonedCalendarDay } from '~/lib/stats';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { getGroupSummary } from '~/server/externalSummary';

/**
 * GET /api/external/groups/{groupId}/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=month,category
 *
 * Cuánto se gastó en un período (por defecto el mes en curso), por moneda, con lo que puso y lo que
 * le tocó a cada uno, un desglose opcional y una frase lista para leer. Solo lectura. Mismo
 * criterio y mismo SQL que /stats ("Nosotros"). Ver docs/EXTERNAL_API.md, "Consultas / Summary".
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('GET' !== req.method) {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));
    const query = parseSummaryQuery(req.query, getZonedCalendarDay(SUMMARY_TIME_ZONE));

    return res.status(200).json(await getGroupSummary(group, query));
  } catch (error) {
    return handleExternalError(res, error, 'summary GET');
  }
}
