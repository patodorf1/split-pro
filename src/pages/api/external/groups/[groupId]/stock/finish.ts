import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalStockFinish } from '~/lib/externalStock';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { finishExternalStock } from '~/server/externalStock';

/**
 * POST /api/external/groups/{groupId}/stock/finish — "se terminó": sale del Stock y va a Compras,
 * por nombre. Ver docs/EXTERNAL_API.md, sección "Stock".
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('POST' !== req.method) {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));

    const finished = await finishExternalStock(group, parseExternalStockFinish(req.body));

    return res.status(200).json(finished);
  } catch (error) {
    return handleExternalError(res, error, 'stock finish');
  }
}
