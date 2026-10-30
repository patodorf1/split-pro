import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalDocumentUpload, parseExternalDocumentsQuery } from '~/lib/externalDocuments';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import {
  listExternalDocuments,
  readDocumentBody,
  uploadExternalDocument,
} from '~/server/externalDocuments';

/** El cuerpo de la subida es el archivo crudo: lo lee `readDocumentBody` con su tope. */
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * GET  /api/external/groups/{groupId}/documents?q=seguro — secciones con sus documentos.
 * POST /api/external/groups/{groupId}/documents?folderId=5&fileName=…&name=…&expiresAt=… — sube
 *      UN archivo (el cuerpo es el archivo tal cual). El mismo archivo en la misma sección no se
 *      repite.
 *
 * Pensado para Charly. Ver docs/EXTERNAL_API.md, sección "Documents".
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
      return res
        .status(200)
        .json(await listExternalDocuments(group, parseExternalDocumentsQuery(req.query)));
    }

    const input = parseExternalDocumentUpload(req.query);
    const uploaded = await uploadExternalDocument(group, input, await readDocumentBody(req));

    return res.status('added' === uploaded.status ? 201 : 200).json(uploaded);
  } catch (error) {
    return handleExternalError(res, error, `documents ${req.method}`);
  }
}
