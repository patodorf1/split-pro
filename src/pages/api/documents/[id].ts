import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';

import {
  buildContentDisposition,
  downloadFileName,
  getDocumentTypeByMime,
  parseRangeHeader,
} from '~/lib/documents';
import { authOptions } from '~/server/auth';
import { db } from '~/server/db';
import { findAccessibleDocument } from '~/server/documents/access';
import { resolveDocumentPath, resolveThumbnailPath } from '~/server/documents/storage';

export const config = {
  api: {
    // Los PDFs escaneados superan fácil los 4 MB: no es un error, es el archivo.
    responseLimit: false,
  },
};

const notFound = (res: NextApiResponse) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(404).json({ error: 'not_found' });
};

/**
 * Descarga / visualización de un documento.
 *
 * - Sin sesión: 401. Sin acceso (no es miembro del grupo), borrado o inexistente: 404 siempre,
 *   para no revelar qué ids existen.
 * - `?download=1` fuerza la descarga; `?thumb=1` devuelve la miniatura de una imagen.
 * - Nunca se cachea (`no-store`) y nunca se "adivina" el tipo (`nosniff`). Sólo PDF, imágenes y
 *   texto plano se muestran inline; Office siempre se descarga.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if ('GET' !== req.method && 'HEAD' !== req.method) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session?.user) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const document = await findAccessibleDocument(db, req.query.id, session.user.id);
  const type = document ? getDocumentTypeByMime(document.mimeType) : null;

  if (!document || !type) {
    return notFound(res);
  }

  const wantsThumbnail = '1' === req.query.thumb;

  if (wantsThumbnail && !type.isImage) {
    return notFound(res);
  }

  const filePath = wantsThumbnail
    ? resolveThumbnailPath(document.storageKey)
    : resolveDocumentPath(document.storageKey);

  if (!filePath) {
    return notFound(res);
  }

  let size: number;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return notFound(res);
    }
    size = stat.size;
  } catch {
    if (!wantsThumbnail) {
      console.error('Document file missing on disk', document.id);
    }
    return notFound(res);
  }

  const contentType = wantsThumbnail
    ? 'image/webp'
    : 'txt' === type.kind
      ? 'text/plain; charset=utf-8'
      : type.mimeType;
  const disposition = '1' === req.query.download || !type.inline ? 'attachment' : 'inline';

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    buildContentDisposition(disposition, downloadFileName(document.name, document.mimeType)),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Nada de scripts ni conexiones desde lo que se muestre (el visor de PDF del navegador sigue andando).
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'",
  );
  res.setHeader('Accept-Ranges', 'bytes');

  const range = wantsThumbnail ? null : parseRangeHeader(req.headers.range, size);

  if ('unsatisfiable' === range) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }

  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else {
    res.status(200);
    res.setHeader('Content-Length', String(size));
  }

  if ('HEAD' === req.method) {
    return res.end();
  }

  try {
    await pipeline(
      createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined),
      res,
    );
  } catch (error) {
    // El cliente cortó la descarga (típico al scrollear un PDF con rangos): no es un error nuestro.
    if (!res.writableEnded && !res.headersSent) {
      console.error('Document stream error', error);
      res.status(500).end();
    } else {
      res.destroy();
    }
  }
}
