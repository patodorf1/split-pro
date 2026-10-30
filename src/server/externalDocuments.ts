import fs from 'node:fs/promises';
import type { Readable } from 'node:stream';

import { expiryDayKey } from '~/lib/documentReminders';
import { DOCUMENT_MAX_SIZE_BYTES, matchesDocumentSearch, rejectionStatus } from '~/lib/documents';
import { ExternalApiError, isUuid, resolveOptionalMemberId } from '~/lib/externalExpense';
import {
  type ExternalDocumentPatch,
  type ExternalDocumentUpload,
  documentSavedText,
  documentsListText,
} from '~/lib/externalDocuments';
import { db } from '~/server/db';
import { resolveDocumentPath } from '~/server/documents/storage';
import { storeDocument } from '~/server/documents/store';
import { type LoadedGroup, assertGroupWritable } from '~/server/externalExpenses';

/**
 * Lógica con base de la API externa de Documentos (Charly). Mismo supuesto que el resto de la API:
 * la clave es de la familia, pero todo queda dentro del grupo de la URL (secciones y documentos de
 * otro grupo "no existen") y `uploadedBy` tiene que ser miembro. No se borra nada desde acá: eso
 * se hace en la app.
 */

const PERSON = { select: { id: true, name: true, email: true } } as const;

const DOCUMENT_VIEW = {
  id: true,
  folderId: true,
  name: true,
  mimeType: true,
  size: true,
  notes: true,
  expiresAt: true,
  createdAt: true,
  uploadedBy: PERSON,
} as const;

interface DocumentView {
  id: string;
  folderId: number;
  name: string;
  mimeType: string;
  size: number;
  notes: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  uploadedBy: { id: number; name: string | null; email: string | null } | null;
}

/** El vencimiento sale como día de Argentina ("aaaa-mm-dd"), igual que como se manda. */
export const serializeExternalDocument = (document: DocumentView) => ({
  id: document.id,
  folderId: document.folderId,
  name: document.name,
  mimeType: document.mimeType,
  size: document.size,
  notes: document.notes,
  expiresAt: document.expiresAt ? expiryDayKey(document.expiresAt) : null,
  uploadedBy: document.uploadedBy,
  createdAt: document.createdAt.toISOString(),
});

const documentNotFound = () =>
  new ExternalApiError(
    404,
    'document_not_found',
    'Ese documento no está en este grupo',
    'Document not found in this group',
  );

const folderNotFound = () =>
  new ExternalApiError(
    404,
    'folder_not_found',
    'Esa sección no está en este grupo',
    'Folder not found in this group',
    'folderId',
  );

const tooLarge = () =>
  new ExternalApiError(
    413,
    'too_large',
    `El archivo pesa más de ${DOCUMENT_MAX_SIZE_BYTES / 1024 / 1024} MB`,
    `The file is larger than ${DOCUMENT_MAX_SIZE_BYTES / 1024 / 1024} MB`,
  );

const REJECTION_TEXT = {
  empty: ['El archivo está vacío', 'The file is empty'],
  too_large: ['El archivo es demasiado grande', 'The file is too large'],
  type_not_allowed: [
    'Tipo no permitido: PDF, fotos, Word, Excel o texto',
    'Type not allowed: PDF, images, Word, Excel or text',
  ],
  type_mismatch: [
    'El contenido no coincide con la extensión del nombre',
    'The content does not match the file name extension',
  ],
  server_error: ['No se pudo guardar el archivo', 'Could not store the file'],
} as const;

/** Id de la URL; si no es un uuid, es como si no existiera. */
export const parseDocumentId = (raw: string | undefined): string => {
  if (!isUuid(raw)) {
    throw documentNotFound();
  }

  return raw;
};

/**
 * El cuerpo crudo de la subida (el archivo tal cual, sin multipart), con tope: si pasa el máximo
 * corta ahí sin leer el resto.
 */
export const readDocumentBody = async (
  req: Readable & { headers: Record<string, string | string[] | undefined> },
): Promise<Buffer> => {
  const declared = Number(req.headers['content-length']);

  if (Number.isFinite(declared) && declared > DOCUMENT_MAX_SIZE_BYTES) {
    throw tooLarge();
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.length;

    if (total > DOCUMENT_MAX_SIZE_BYTES) {
      throw tooLarge();
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
};

const findGroupFolder = async (group: LoadedGroup, folderId: number) => {
  const folder = await db.documentFolder.findFirst({
    where: { id: folderId, groupId: group.id },
    select: { id: true, groupId: true, name: true },
  });

  if (!folder) {
    throw folderNotFound();
  }

  return folder;
};

/** Las secciones del grupo en el orden de la app, cada una con sus documentos (lo último primero). */
export const listExternalDocuments = async (group: LoadedGroup, query: { search: string }) => {
  const folders = await db.documentFolder.findMany({
    where: { groupId: group.id },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      icon: true,
      isPerson: true,
      documents: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: DOCUMENT_VIEW,
      },
    },
  });
  const visible = folders.map((folder) => ({
    ...folder,
    documents: query.search
      ? folder.documents.filter((document) => matchesDocumentSearch(document.name, query.search))
      : folder.documents,
  }));

  return {
    groupId: group.id,
    folders: visible.map((folder) => ({
      id: folder.id,
      name: folder.name,
      icon: folder.icon,
      isPerson: folder.isPerson,
      documents: folder.documents.map(serializeExternalDocument),
    })),
    text: documentsListText(visible, query.search),
  };
};

/**
 * El mismo archivo (mismos bytes) ya guardado en esa sección: así un reintento del asistente no
 * lo duplica. Sólo se comparan los del mismo tamaño.
 */
const findSameFile = async (folderId: number, buffer: Buffer) => {
  const candidates = await db.document.findMany({
    where: { folderId, deletedAt: null, size: buffer.length },
    select: { ...DOCUMENT_VIEW, storageKey: true },
  });

  for (const candidate of candidates) {
    const filePath = resolveDocumentPath(candidate.storageKey);
    // oxlint-disable-next-line no-await-in-loop -- de a uno a propósito: corta en el primero igual
    const stored = filePath ? await fs.readFile(filePath).catch(() => null) : null;

    if (stored?.equals(buffer)) {
      return candidate;
    }
  }

  return null;
};

/** Sube un archivo a una sección, con nombre, nota y vencimiento opcionales. */
export const uploadExternalDocument = async (
  group: LoadedGroup,
  input: ExternalDocumentUpload,
  buffer: Buffer,
) => {
  assertGroupWritable(group);

  const uploadedById = resolveOptionalMemberId(input.uploadedBy, group.members, 'uploadedBy');
  const folder = await findGroupFolder(group, input.folderId);
  const existing = await findSameFile(folder.id, buffer);

  if (existing) {
    return {
      groupId: group.id,
      status: 'already' as const,
      document: serializeExternalDocument(existing),
      text: documentSavedText(existing, folder.name, 'already'),
    };
  }

  const stored = await storeDocument(
    {
      folder,
      buffer,
      originalName: input.fileName ?? '',
      uploadedById,
      name: input.name,
      notes: input.notes,
      expiresAt: input.expiresAt,
    },
    DOCUMENT_VIEW,
  );

  if (!stored.ok) {
    const [es, en] = REJECTION_TEXT[stored.reason];
    throw new ExternalApiError(rejectionStatus(stored.reason), stored.reason, es, en);
  }

  return {
    groupId: group.id,
    status: 'added' as const,
    document: serializeExternalDocument(stored.document),
    text: documentSavedText(stored.document, folder.name, 'added'),
  };
};

/** Cambia nombre, nota, vencimiento (null lo saca) o sección (del mismo grupo). */
export const updateExternalDocument = async (
  group: LoadedGroup,
  id: string,
  patch: ExternalDocumentPatch,
) => {
  assertGroupWritable(group);

  const current = await db.document.findFirst({
    where: { id, groupId: group.id, deletedAt: null },
    select: { id: true, folderId: true },
  });

  if (!current) {
    throw documentNotFound();
  }

  const folder = await findGroupFolder(group, patch.folderId ?? current.folderId);
  const document = await db.document.update({
    where: { id: current.id },
    data: {
      ...(undefined === patch.name ? {} : { name: patch.name }),
      ...(undefined === patch.notes ? {} : { notes: patch.notes }),
      ...(undefined === patch.expiresAt ? {} : { expiresAt: patch.expiresAt }),
      ...(undefined === patch.folderId ? {} : { folderId: folder.id }),
    },
    select: DOCUMENT_VIEW,
  });

  return {
    groupId: group.id,
    document: serializeExternalDocument(document),
    text: documentSavedText(document, folder.name, 'updated'),
  };
};
