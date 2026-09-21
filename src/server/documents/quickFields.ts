import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { type QuickFields, parseStoredQuickFields } from '~/lib/documentQuickFields';
import { type db as dbClient } from '~/server/db';
import { findAccessibleFolder } from '~/server/documents/access';

type Db = typeof dbClient;

/**
 * Reemplaza los datos rápidos de una sección "persona". Mismo filtro de membresía que el resto de
 * Documentos (si no sos miembro, NOT_FOUND); en una sección que no es persona no se guarda nada.
 * `fields` ya viene validado y compactado (ver `quickFieldsInputSchema`).
 */
export const updateFolderQuickFields = async (
  db: Db,
  userId: number,
  folderId: number,
  fields: QuickFields,
) => {
  const folder = await findAccessibleFolder(db, folderId, userId);

  if (!folder) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
  }

  if (!folder.isPerson) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'folder_not_person' });
  }

  const empty = 0 === Object.keys(fields).length;
  const updated = await db.documentFolder.update({
    where: { id: folder.id },
    data: { quickFields: empty ? Prisma.DbNull : fields },
    select: { id: true, quickFields: true },
  });

  return { folderId: updated.id, quickFields: parseStoredQuickFields(updated.quickFields) };
};
