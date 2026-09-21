import { isUuid } from '~/lib/documents';
import { type db as dbClient } from '~/server/db';

type Db = typeof dbClient;

/**
 * Filtro de acceso: sólo los miembros del grupo dueño. Se aplica SIEMPRE en la misma consulta que
 * busca el documento o la sección, así "no existe" y "no es tuyo" son indistinguibles (404).
 */
export const memberOf = (userId: number) => ({ groupUsers: { some: { userId } } });

/** Documento vigente (no borrado) al que el usuario tiene acceso, o null. */
export const findAccessibleDocument = async (db: Db, id: unknown, userId: number) => {
  if (!isUuid(id) || !Number.isSafeInteger(userId)) {
    return null;
  }

  return db.document.findFirst({
    where: { id, deletedAt: null, group: memberOf(userId) },
  });
};

/** Sección a la que el usuario tiene acceso, o null. */
export const findAccessibleFolder = async (db: Db, folderId: unknown, userId: number) => {
  if (
    'number' !== typeof folderId ||
    !Number.isSafeInteger(folderId) ||
    folderId <= 0 ||
    !Number.isSafeInteger(userId)
  ) {
    return null;
  }

  return db.documentFolder.findFirst({
    where: { id: folderId, group: memberOf(userId) },
  });
};
