import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalStockAdd, parseExternalStockQuery } from '~/lib/externalStock';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { addExternalStock, listExternalStock } from '~/server/externalStock';

/**
 * GET  /api/external/groups/{groupId}/stock?q=texto — qué hay, por sección (o lo que contiene q).
 * POST /api/external/groups/{groupId}/stock         — suma productos; lo pendiente en Compras se
 *      tilda como comprado y pasa al Stock por el puente.
 *
 * Pensado para Charly. Ver docs/EXTERNAL_API.md, sección "Stock".
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
      const stock = await listExternalStock(group, parseExternalStockQuery(req.query));

      return res.status(200).json(stock);
    }

    const added = await addExternalStock(group, parseExternalStockAdd(req.body));

    return res.status(200).json(added);
  } catch (error) {
    return handleExternalError(res, error, `stock ${req.method}`);
  }
}
