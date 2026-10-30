import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';

import { type File, formidable, errors as formidableErrors } from 'formidable';

import { DOCUMENT_MAX_SIZE_BYTES, rejectionStatus } from '~/lib/documents';
import { authOptions } from '~/server/auth';
import { db } from '~/server/db';
import { findAccessibleFolder } from '~/server/documents/access';
import { DOCUMENTS_INCOMING_DIR } from '~/server/documents/storage';
import { storeDocument } from '~/server/documents/store';

export const config = {
  api: {
    bodyParser: false,
  },
};

/** Margen para los encabezados del multipart por encima del tope del archivo. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

type UploadError =
  | 'method_not_allowed'
  | 'unauthorized'
  | 'not_found'
  | 'bad_request'
  | 'no_file'
  | 'too_large'
  | 'empty'
  | 'type_not_allowed'
  | 'type_mismatch'
  | 'server_error';

const fail = (res: NextApiResponse, status: number, error: UploadError) =>
  res.status(status).json({ error });

/** Borra los temporales de este pedido (formidable no limpia si corta a mitad de camino). */
const cleanupIncoming = async (prefix: string) => {
  try {
    const entries = await fs.readdir(DOCUMENTS_INCOMING_DIR);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => fs.rm(path.join(DOCUMENTS_INCOMING_DIR, entry), { force: true })),
    );
  } catch {
    // Nada que limpiar.
  }
};

/**
 * Subida de UN documento a una sección: `POST /api/documents/upload?folderId=N` (multipart, campo
 * `file`). La UI sube varios archivos uno detrás de otro para poder mostrar el progreso.
 *
 * Orden de los chequeos: sesión → membresía de la sección (antes de leer el cuerpo) → tamaño →
 * tipo real por contenido. Guardar el archivo y la fila es `storeDocument`, igual que la API
 * externa.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');

  if ('POST' !== req.method) {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'method_not_allowed');
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session?.user) {
    return fail(res, 401, 'unauthorized');
  }

  const folderId = Number(req.query.folderId);
  const folder = await findAccessibleFolder(db, folderId, session.user.id);

  if (!folder) {
    return fail(res, 404, 'not_found');
  }

  const declaredLength = Number(req.headers['content-length']);

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > DOCUMENT_MAX_SIZE_BYTES + MULTIPART_OVERHEAD_BYTES
  ) {
    return fail(res, 413, 'too_large');
  }

  await fs.mkdir(DOCUMENTS_INCOMING_DIR, { recursive: true });

  const requestPrefix = `${randomUUID()}-`;
  let uploaded: File | undefined;

  try {
    const form = formidable({
      uploadDir: DOCUMENTS_INCOMING_DIR,
      filename: () => `${requestPrefix}${randomUUID()}.part`,
      maxFiles: 1,
      maxFileSize: DOCUMENT_MAX_SIZE_BYTES,
      maxTotalFileSize: DOCUMENT_MAX_SIZE_BYTES,
      maxFields: 5,
      maxFieldsSize: 16 * 1024,
      allowEmptyFiles: false,
      minFileSize: 1,
    });

    try {
      const [, files] = await form.parse(req);
      uploaded = files.file?.[0];
    } catch (error) {
      const { code, httpCode } = error as { code?: number; httpCode?: number };

      // 1009 = biggerThanTotalMaxFileSize (existe en formidable pero no en sus tipos).
      if (code === formidableErrors.biggerThanMaxFileSize || 1009 === code || 413 === httpCode) {
        return fail(res, 413, 'too_large');
      }
      if (code === formidableErrors.smallerThanMinFileSize) {
        return fail(res, 400, 'empty');
      }

      console.warn('Document upload rejected by the multipart parser', code, httpCode);
      return fail(res, 400, 'bad_request');
    }

    if (!uploaded) {
      return fail(res, 400, 'no_file');
    }

    const buffer = await fs.readFile(uploaded.filepath);
    const stored = await storeDocument(
      {
        folder,
        buffer,
        originalName: uploaded.originalFilename ?? '',
        uploadedById: session.user.id,
      },
      { id: true, name: true, mimeType: true, size: true, createdAt: true },
    );

    if (!stored.ok) {
      return fail(res, rejectionStatus(stored.reason), stored.reason);
    }

    return res.status(201).json({ document: stored.document });
  } catch (error) {
    console.error('Document upload error', error);
    return fail(res, 500, 'server_error');
  } finally {
    await cleanupIncoming(requestPrefix);
  }
}
