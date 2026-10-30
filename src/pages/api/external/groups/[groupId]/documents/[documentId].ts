import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalDocumentPatch } from '~/lib/externalDocuments';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { parseDocumentId, updateExternalDocument } from '~/server/externalDocuments';

/**
 * PATCH /api/external/groups/{groupId}/documents/{documentId} — cambia nombre, nota, vencimiento
 * o sección. Borrar no se puede desde acá: se hace en la app.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('PATCH' !== req.method) {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));
    const documentId = parseDocumentId(readSingleQueryParam(req.query.documentId));

    return res
      .status(200)
      .json(await updateExternalDocument(group, documentId, parseExternalDocumentPatch(req.body)));
  } catch (error) {
    return handleExternalError(res, error, `document ${req.method}`);
  }
}
