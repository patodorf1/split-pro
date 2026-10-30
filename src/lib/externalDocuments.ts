import { z } from 'zod';

import { formatExpiryDate, parseExpiryDay } from '~/lib/documentReminders';
import { MAX_DOCUMENT_NAME_LENGTH, cleanDocumentName } from '~/lib/documents';
import {
  ExternalApiError,
  MAX_EXTERNAL_NOTE_LENGTH,
  type PersonRef,
  parseExternalBody,
  personRefSchema,
  readSingleQueryParam,
  zodErrorToExternal,
} from '~/lib/externalExpense';

/**
 * Parseo y textos puros (sin base) de la API externa de Documentos, pensada para Charly. Las
 * reglas del nombre son las de la app (`cleanDocumentName`) y el vencimiento es un día de
 * calendario "aaaa-mm-dd" (`parseExpiryDay`). Ver docs/EXTERNAL_API.md, sección "Documents".
 */

export const MAX_EXTERNAL_DOCUMENT_SEARCH_LENGTH = 100;

/** El nombre como lo guarda la app; si queda vacío, falta. */
const nameSchema = z
  .string()
  .max(MAX_DOCUMENT_NAME_LENGTH * 2)
  .transform((value) => cleanDocumentName(value).slice(0, MAX_DOCUMENT_NAME_LENGTH).trim())
  .pipe(z.string().min(1));

/** Nota libre; vacía es lo mismo que sin nota. */
const notesSchema = z
  .string()
  .max(MAX_EXTERNAL_NOTE_LENGTH)
  .transform((value) => value.trim() || null);

/** "2027-02-02" (día de Argentina) → instante guardado; null borra el vencimiento. */
const expirySchema = z.string().transform((value, ctx) => {
  const date = parseExpiryDay(value);

  if (!date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use YYYY-MM-DD (a real date)' });
    return z.NEVER;
  }

  return date;
});

const folderIdSchema = z.coerce.number().int().positive();

const patchSchema = z
  .object({
    name: nameSchema.optional(),
    notes: notesSchema.nullable().optional(),
    expiresAt: expirySchema.nullable().optional(),
    folderId: folderIdSchema.optional(),
  })
  .strict()
  .refine(
    (patch) =>
      undefined !== patch.name ||
      undefined !== patch.notes ||
      undefined !== patch.expiresAt ||
      undefined !== patch.folderId,
    'Nothing to change',
  );

/** Lo que viaja en la URL de la subida (el cuerpo es el archivo). Todo llega como texto. */
const uploadQuerySchema = z.object({
  folderId: folderIdSchema,
  fileName: z.string().trim().min(1).max(180).optional(),
  name: nameSchema.optional(),
  notes: notesSchema.optional(),
  expiresAt: expirySchema.optional(),
  uploadedBy: personRefSchema.optional(),
});

export interface ExternalDocumentUpload {
  folderId: number;
  fileName?: string;
  name?: string;
  notes?: string | null;
  expiresAt?: Date;
  uploadedBy?: PersonRef;
}

export interface ExternalDocumentPatch {
  name?: string;
  notes?: string | null;
  expiresAt?: Date | null;
  folderId?: number;
}

export const parseExternalDocumentPatch = (body: unknown): ExternalDocumentPatch =>
  parseExternalBody(patchSchema, body);

type Query = Record<string, string | string[] | undefined>;

/** `?folderId=5&fileName=seguro.jpg&name=…&expiresAt=2027-02-02&uploadedBy=1`. */
export const parseExternalDocumentUpload = (query: Query): ExternalDocumentUpload => {
  const raw = Object.fromEntries(
    ['folderId', 'fileName', 'name', 'notes', 'expiresAt', 'uploadedBy']
      .map((key) => [key, readSingleQueryParam(query[key])] as const)
      .filter(([, value]) => undefined !== value && '' !== value),
  );
  const parsed = uploadQuerySchema.safeParse(raw);

  if (!parsed.success) {
    throw zodErrorToExternal(parsed.error);
  }

  return parsed.data;
};

/** `?q=seguro`: buscar por nombre (como el buscador de la app). Vacío = todo. */
export const parseExternalDocumentsQuery = (query: Query): { search: string } => {
  const search = (readSingleQueryParam(query.q) ?? '').trim();

  if (MAX_EXTERNAL_DOCUMENT_SEARCH_LENGTH < search.length) {
    throw new ExternalApiError(
      400,
      'invalid_field',
      `q: hasta ${MAX_EXTERNAL_DOCUMENT_SEARCH_LENGTH} caracteres`,
      `q: up to ${MAX_EXTERNAL_DOCUMENT_SEARCH_LENGTH} characters`,
      'q',
    );
  }

  return { search };
};

interface DocumentForText {
  name: string;
  expiresAt: Date | null;
}

const expiryPart = (expiresAt: Date | null): string =>
  expiresAt ? `, vence el ${formatExpiryDate(expiresAt)}` : ', sin vencimiento';

/** "En Fox (2): Tarjeta de seguro Fox (La Caja), vence el 02/02/2027; Cédula verde, sin vencimiento." */
export const documentsListText = (
  folders: readonly { name: string; documents: readonly DocumentForText[] }[],
  search: string,
): string => {
  const withDocuments = folders.filter((folder) => 0 < folder.documents.length);

  if (0 === withDocuments.length) {
    return search
      ? `No encontré documentos con "${search}".`
      : 'Todavía no hay documentos cargados.';
  }

  return withDocuments
    .map(
      (folder) =>
        `En ${folder.name} (${folder.documents.length}): ${folder.documents
          .map((document) => `${document.name}${expiryPart(document.expiresAt)}`)
          .join('; ')}.`,
    )
    .join(' ');
};

/** "Guardé "Tarjeta de seguro Fox" en Fox, vence el 02/02/2027." */
export const documentSavedText = (
  document: DocumentForText,
  folderName: string,
  status: 'added' | 'already' | 'updated',
): string => {
  const what = `"${document.name}" en ${folderName}${expiryPart(document.expiresAt)}`;

  return 'added' === status
    ? `Guardé ${what}.`
    : 'already' === status
      ? `Ese archivo ya estaba: ${what}.`
      : `Quedó ${what}.`;
};
