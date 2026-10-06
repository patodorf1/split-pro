import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalStockPatch } from '~/lib/externalStock';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import {
  parseStockItemId,
  removeExternalStockItem,
  updateExternalStockItem,
} from '~/server/externalStock';

/**
 * PATCH  /api/external/groups/{groupId}/stock/{itemId} — cambia nombre, nota o sección (la
 *        sección queda aprendida para ese producto).
 * DELETE /api/external/groups/{groupId}/stock/{itemId} — sacar sin comprar (no va a Compras).
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
    const itemId = parseStockItemId(readSingleQueryParam(req.query.itemId));

    if ('PATCH' === req.method) {
      const item = await updateExternalStockItem(group, itemId, parseExternalStockPatch(req.body));

      return res.status(200).json({ groupId: group.id, item });
    }

    const item = await removeExternalStockItem(group, itemId);

    return res.status(200).json({ groupId: group.id, removed: true, item });
  } catch (error) {
    return handleExternalError(res, error, `stock item ${req.method}`);
  }
}
