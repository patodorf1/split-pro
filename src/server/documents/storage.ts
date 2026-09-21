import path from 'node:path';

import { isValidStorageKey, thumbnailKeyFor } from '~/lib/documents';

/**
 * Carpeta base de los archivos subidos: la misma que usan las fotos de gastos (`/app/uploads` en
 * producción, montada como volumen persistente).
 */
export const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

/**
 * Documentos: `uploads/documents/<groupId>/<uuid>.<ext>`. Esta carpeta NO se puede leer por
 * `/api/files/...` (ver `isInsideDocumentsRoot`); sólo por `/api/documents/[id]`.
 */
export const DOCUMENTS_ROOT = path.join(UPLOADS_ROOT, 'documents');

/** Subidas en curso: mismo volumen que el destino, así el `rename` final es atómico. */
export const DOCUMENTS_INCOMING_DIR = path.join(DOCUMENTS_ROOT, '.incoming');

/** ¿`target` queda adentro de `root` (o es `root`)? Compara sin distinguir mayúsculas. */
const isWithin = (root: string, target: string, allowRoot: boolean): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(target));

  if ('' === relative) {
    return allowRoot;
  }

  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * ¿La ruta cae dentro de la carpeta de documentos? Se compara en minúsculas porque en macOS (y en
 * algunos volúmenes) `Documents/` y `documents/` son la misma carpeta.
 */
export const isInsideDocumentsRoot = (
  absolutePath: string,
  uploadsRoot: string = UPLOADS_ROOT,
): boolean => {
  const relative = path.relative(path.resolve(uploadsRoot), path.resolve(absolutePath));
  const first = relative.split(path.sep)[0]?.toLowerCase();

  return 'documents' === first;
};

/**
 * Ruta absoluta de un documento a partir de su clave. Devuelve null si la clave no tiene la forma
 * esperada o si, resuelta, se saliera de la carpeta de documentos (defensa en profundidad).
 */
export const resolveDocumentPath = (
  storageKey: string,
  root: string = DOCUMENTS_ROOT,
): string | null => {
  if (!isValidStorageKey(storageKey)) {
    return null;
  }

  const absolute = path.resolve(root, ...storageKey.split('/'));

  return isWithin(root, absolute, false) ? absolute : null;
};

export const resolveThumbnailPath = (
  storageKey: string,
  root: string = DOCUMENTS_ROOT,
): string | null => {
  const original = resolveDocumentPath(storageKey, root);

  if (!original) {
    return null;
  }

  const absolute = path.resolve(root, ...thumbnailKeyFor(storageKey).split('/'));

  return isWithin(root, absolute, false) ? absolute : null;
};
