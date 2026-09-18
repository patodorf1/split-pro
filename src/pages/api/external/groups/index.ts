import type { NextApiRequest, NextApiResponse } from 'next';

import { guardExternalRequest, handleExternalError, listGroups } from '~/server/externalExpenses';

/**
 * GET /api/external/groups — grupos con su moneda y sus miembros, para que el asistente sepa a
 * quién puede asignar un gasto. La clave es global de la instalación (una sola familia), así que
 * lista todos los grupos. Ver docs/EXTERNAL_API.md.
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
    return res.status(200).json({ groups: await listGroups() });
  } catch (error) {
    return handleExternalError(res, error, 'groups');
  }
}
