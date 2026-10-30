import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import sharp from 'sharp';

import {
  type DocumentRejectReason,
  buildStorageKey,
  defaultDocumentName,
  detectDocumentType,
  sanitizeFileName,
} from '~/lib/documents';
import { db } from '~/server/db';
import {
  DOCUMENTS_INCOMING_DIR,
  resolveDocumentPath,
  resolveThumbnailPath,
} from '~/server/documents/storage';

const THUMBNAIL_SIZE = 240;

export interface StoreDocumentInput {
  folder: { id: number; groupId: number };
  buffer: Buffer;
  /** El nombre del archivo como llegó (se limpia acá); sirve para el tipo y el nombre por defecto. */
  originalName: string;
  uploadedById: number | null;
  /** Nombre a mostrar; si no viene, sale del nombre del archivo. */
  name?: string;
  notes?: string | null;
  expiresAt?: Date | null;
}

export type StoreDocumentResult<T> =
  | { ok: true; document: T }
  | { ok: false; reason: DocumentRejectReason | 'server_error' };

/**
 * Guarda UN documento ya leído en memoria: tipo real por contenido → archivo en `.incoming/` → se
 * mueve con `rename` al destino final (`<groupId>/<uuid>.<ext>`, así nunca queda uno a medias con
 * nombre final) → miniatura si es foto → fila en la base. Si algo falla después de mover el
 * archivo, se borra: no quedan huérfanos. Lo usan la subida de la app y la API externa.
 */
export const storeDocument = async <S extends Prisma.DocumentSelect>(
  input: StoreDocumentInput,
  select: S,
): Promise<StoreDocumentResult<Prisma.DocumentGetPayload<{ select: S }>>> => {
  const originalName = sanitizeFileName(input.originalName) || 'documento';
  const detection = detectDocumentType(input.buffer, originalName);

  if (!detection.ok) {
    return { ok: false, reason: detection.reason };
  }

  const { type } = detection;
  const id = randomUUID();
  const storageKey = buildStorageKey(input.folder.groupId, id, type.ext);
  const finalPath = resolveDocumentPath(storageKey);

  if (!finalPath) {
    return { ok: false, reason: 'server_error' };
  }

  const prefix = `${randomUUID()}-`;
  const tempPath = path.join(DOCUMENTS_INCOMING_DIR, `${prefix}file.part`);
  let moved = false;

  try {
    await fs.mkdir(DOCUMENTS_INCOMING_DIR, { recursive: true });
    await fs.writeFile(tempPath, input.buffer);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.rename(tempPath, finalPath);
    moved = true;

    if (type.isImage) {
      await writeThumbnail(input.buffer, storageKey, prefix);
    }

    const document = await db.document.create({
      data: {
        id,
        folderId: input.folder.id,
        groupId: input.folder.groupId,
        name: input.name ?? defaultDocumentName(originalName),
        originalName,
        mimeType: type.mimeType,
        size: input.buffer.length,
        storageKey,
        uploadedById: input.uploadedById,
        notes: input.notes ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      select,
    });

    moved = false;

    return { ok: true, document };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);

    if (moved) {
      await fs.rm(finalPath, { force: true }).catch(() => undefined);
      const thumbPath = resolveThumbnailPath(storageKey);
      if (thumbPath) {
        await fs.rm(thumbPath, { force: true }).catch(() => undefined);
      }
    }
  }
};

/** Miniatura cuadrada en WebP para la lista. Si el formato no se puede leer (HEIC), no hay. */
const writeThumbnail = async (buffer: Buffer, storageKey: string, prefix: string) => {
  const thumbPath = resolveThumbnailPath(storageKey);

  if (!thumbPath) {
    return;
  }

  const tempPath = path.join(DOCUMENTS_INCOMING_DIR, `${prefix}thumb.part`);

  try {
    await sharp(buffer)
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
      .webp({ quality: 60 })
      .toFile(tempPath);
    await fs.rename(tempPath, thumbPath);
  } catch {
    // Sin miniatura: la lista muestra el ícono del tipo.
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
};
