import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { expiryDayKey, parseExpiryDay } from '~/lib/documentReminders';
import { DOCUMENT_MAX_SIZE_BYTES } from '~/lib/documents';
import {
  documentSavedText,
  documentsListText,
  parseExternalDocumentPatch,
  parseExternalDocumentUpload,
  parseExternalDocumentsQuery,
} from '~/lib/externalDocuments';
import { ExternalApiError } from '~/lib/externalExpense';
import { storeDocument } from '~/server/documents/store';
import {
  listExternalDocuments,
  parseDocumentId,
  readDocumentBody,
  updateExternalDocument,
  uploadExternalDocument,
} from '~/server/externalDocuments';
import type { LoadedGroup } from '~/server/externalExpenses';

const mockDb = {
  documentFolder: { findFirst: jest.fn(), findMany: jest.fn() },
  document: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
};

jest.mock('~/server/db', () => ({
  get db() {
    return mockDb;
  },
}));
jest.mock('~/server/api/services/splitService', () => ({
  createExpense: jest.fn(),
  deleteExpense: jest.fn(),
}));
jest.mock('~/server/documents/store', () => ({ storeDocument: jest.fn() }));

// Los archivos "guardados" de la prueba viven en una carpeta temporal.
const mockTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-api-'));
jest.mock('~/server/documents/storage', () => ({
  resolveDocumentPath: (key: string) => `${mockTmp}/${key.replaceAll('/', '_')}`,
}));

const pato = { id: 1, name: 'Pato', email: 'patodorf@gmail.com' };
const belen = { id: 2, name: 'Belén', email: 'mbelenbilbao@gmail.com' };

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- grupo mínimo de prueba
const casa = { id: 1, archivedAt: null, members: [pato, belen] } as unknown as LoadedGroup;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- grupo mínimo de prueba
const archivado = { ...casa, archivedAt: new Date() } as unknown as LoadedGroup;

const DOC_ID = '33333333-3333-4333-8333-333333333333';
const fox = { id: 5, groupId: 1, name: 'Fox' };
const CREATED = new Date('2026-10-30T14:00:00Z');

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: DOC_ID,
  folderId: 5,
  name: 'Tarjeta de seguro Fox',
  mimeType: 'image/jpeg',
  size: 4,
  notes: null,
  expiresAt: parseExpiryDay('2027-02-02'),
  createdAt: CREATED,
  uploadedBy: pato,
  ...overrides,
});

/** Ejecuta y devuelve el ExternalApiError lanzado. */
const catchError = async (fn: () => unknown): Promise<ExternalApiError> => {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ExternalApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an ExternalApiError');
};

const bodyOf = (chunks: Buffer[], headers: Record<string, string> = {}) =>
  Object.assign(Readable.from(chunks), { headers });

beforeEach(() => {
  jest.resetAllMocks();
});

afterAll(() => {
  fs.rmSync(mockTmp, { recursive: true, force: true });
});

describe('parseExpiryDay / expiryDayKey', () => {
  it('stores the day at noon UTC and reads back the same Argentine day', () => {
    const date = parseExpiryDay('2027-02-02');

    expect(date?.toISOString()).toBe('2027-02-02T12:00:00.000Z');
    expect(expiryDayKey(date!)).toBe('2027-02-02');
    // Lo que ya estaba cargado (mediodía UTC) da el mismo día.
    expect(expiryDayKey(new Date('2026-11-02T12:00:00Z'))).toBe('2026-11-02');
  });

  it('rejects dates that do not exist and other formats', () => {
    expect(parseExpiryDay('2027-02-30')).toBeNull();
    expect(parseExpiryDay('02/02/2027')).toBeNull();
    expect(parseExpiryDay('2027-2-2')).toBeNull();
    expect(parseExpiryDay('0099-01-01')).toBeNull();
  });
});

describe('parseExternalDocumentUpload', () => {
  it('reads the query, cleaning the name and parsing the expiry', () => {
    expect(
      parseExternalDocumentUpload({
        groupId: '1',
        folderId: '5',
        fileName: 'tarjeta.jpg',
        name: '  Tarjeta   de seguro Fox ',
        expiresAt: '2027-02-02',
        uploadedBy: '1',
        notes: '',
      }),
    ).toEqual({
      folderId: 5,
      fileName: 'tarjeta.jpg',
      name: 'Tarjeta de seguro Fox',
      expiresAt: parseExpiryDay('2027-02-02'),
      uploadedBy: '1',
    });
  });

  it('needs a folder and a real date', async () => {
    expect((await catchError(() => parseExternalDocumentUpload({}))).status).toBe(400);
    expect((await catchError(() => parseExternalDocumentUpload({ folderId: 'fox' }))).field).toBe(
      'folderId',
    );
    expect(
      (
        await catchError(() =>
          parseExternalDocumentUpload({ folderId: '5', expiresAt: '02/02/2027' }),
        )
      ).field,
    ).toBe('expiresAt');
  });
});

describe('parseExternalDocumentPatch', () => {
  it('accepts a new expiry, removing it with null and blank notes as no note', () => {
    expect(parseExternalDocumentPatch({ expiresAt: '2027-02-02' })).toEqual({
      expiresAt: parseExpiryDay('2027-02-02'),
    });
    expect(parseExternalDocumentPatch({ expiresAt: null, notes: '   ' })).toEqual({
      expiresAt: null,
      notes: null,
    });
    expect(parseExternalDocumentPatch({ folderId: '4' })).toEqual({ folderId: 4 });
  });

  it('needs something to change and rejects unknown fields', () => {
    expect(() => parseExternalDocumentPatch({})).toThrow(ExternalApiError);
    expect(() => parseExternalDocumentPatch({ deleted: true })).toThrow(ExternalApiError);
    expect(() => parseExternalDocumentPatch({ name: '   ' })).toThrow(ExternalApiError);
  });
});

describe('parseExternalDocumentsQuery', () => {
  it('trims the search and caps its length', async () => {
    expect(parseExternalDocumentsQuery({ q: ' seguro ' })).toEqual({ search: 'seguro' });
    expect(parseExternalDocumentsQuery({})).toEqual({ search: '' });
    expect(
      (await catchError(() => parseExternalDocumentsQuery({ q: 'x'.repeat(101) }))).field,
    ).toBe('q');
  });
});

describe('texts', () => {
  it('lists only folders with documents, with their expiry', () => {
    expect(
      documentsListText(
        [
          { name: 'Fox', documents: [doc(), doc({ name: 'Cédula', expiresAt: null })] },
          { name: 'Casa', documents: [] },
        ],
        '',
      ),
    ).toBe('En Fox (2): Tarjeta de seguro Fox, vence el 02/02/2027; Cédula, sin vencimiento.');
    expect(documentsListText([{ name: 'Fox', documents: [] }], 'póliza')).toBe(
      'No encontré documentos con "póliza".',
    );
  });

  it('says what happened to the document', () => {
    expect(documentSavedText(doc(), 'Fox', 'added')).toBe(
      'Guardé "Tarjeta de seguro Fox" en Fox, vence el 02/02/2027.',
    );
    expect(documentSavedText(doc(), 'Fox', 'already')).toMatch(/^Ese archivo ya estaba/);
    expect(documentSavedText(doc({ expiresAt: null }), 'Fox', 'updated')).toBe(
      'Quedó "Tarjeta de seguro Fox" en Fox, sin vencimiento.',
    );
  });
});

describe('parseDocumentId', () => {
  it('treats anything but a uuid as not found', async () => {
    expect(parseDocumentId(DOC_ID)).toBe(DOC_ID);
    expect((await catchError(() => parseDocumentId('fox'))).status).toBe(404);
  });
});

describe('readDocumentBody', () => {
  it('joins the chunks', async () => {
    const body = await readDocumentBody(bodyOf([Buffer.from('ab'), Buffer.from('cd')]));

    expect(body.toString()).toBe('abcd');
  });

  it('stops at the size cap, by header or while reading', async () => {
    expect(
      (
        await catchError(() =>
          readDocumentBody(bodyOf([], { 'content-length': String(DOCUMENT_MAX_SIZE_BYTES + 1) })),
        )
      ).status,
    ).toBe(413);

    const big = Buffer.alloc(DOCUMENT_MAX_SIZE_BYTES / 2 + 1);
    expect((await catchError(() => readDocumentBody(bodyOf([big, big])))).status).toBe(413);
  });
});

describe('listExternalDocuments', () => {
  it('returns the folders in order with their documents, filtered by the search', async () => {
    mockDb.documentFolder.findMany.mockResolvedValue([
      {
        id: 4,
        name: 'Kuga',
        icon: 'car',
        isPerson: false,
        documents: [doc({ name: 'Cédula Kuga', folderId: 4 })],
      },
      { id: 5, name: 'Fox', icon: 'car', isPerson: false, documents: [doc()] },
    ]);

    const result = await listExternalDocuments(casa, { search: 'seguro' });

    expect(mockDb.documentFolder.findMany.mock.calls[0]?.[0]?.where).toEqual({ groupId: 1 });
    expect(result.folders.map((folder) => folder.documents.length)).toEqual([0, 1]);
    expect(result.folders[1]?.documents[0]).toMatchObject({
      id: DOC_ID,
      expiresAt: '2027-02-02',
      createdAt: CREATED.toISOString(),
    });
    expect(result.text).toBe('En Fox (1): Tarjeta de seguro Fox, vence el 02/02/2027.');
  });
});

describe('uploadExternalDocument', () => {
  const input = { folderId: 5, fileName: 'tarjeta.jpg', name: 'Tarjeta de seguro Fox' };

  it('stores a new file in the folder of the group', async () => {
    mockDb.documentFolder.findFirst.mockResolvedValue(fox);
    mockDb.document.findMany.mockResolvedValue([]);
    jest.mocked(storeDocument).mockResolvedValue({ ok: true, document: doc() } as never);

    const result = await uploadExternalDocument(
      casa,
      { ...input, uploadedBy: 'patodorf@gmail.com', expiresAt: parseExpiryDay('2027-02-02')! },
      Buffer.from('jpeg'),
    );

    expect(mockDb.documentFolder.findFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: 5,
      groupId: 1,
    });
    expect(jest.mocked(storeDocument).mock.calls[0]?.[0]).toMatchObject({
      folder: fox,
      originalName: 'tarjeta.jpg',
      uploadedById: 1,
      name: 'Tarjeta de seguro Fox',
      expiresAt: parseExpiryDay('2027-02-02'),
    });
    expect(result).toMatchObject({ status: 'added', document: { expiresAt: '2027-02-02' } });
    expect(result.text).toBe('Guardé "Tarjeta de seguro Fox" en Fox, vence el 02/02/2027.');
  });

  it('does not repeat the same bytes in the same folder', async () => {
    fs.writeFileSync(`${mockTmp}/1_existing.jpg`, 'jpeg');
    mockDb.documentFolder.findFirst.mockResolvedValue(fox);
    mockDb.document.findMany.mockResolvedValue([
      { ...doc({ id: 'other' }), storageKey: '1/missing.jpg' },
      { ...doc(), storageKey: '1/existing.jpg' },
    ]);

    const result = await uploadExternalDocument(casa, input, Buffer.from('jpeg'));

    expect(storeDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'already', document: { id: DOC_ID } });
  });

  it('rejects other groups, outsiders, archived groups and bad files', async () => {
    mockDb.documentFolder.findFirst.mockResolvedValue(null);
    expect(
      (await catchError(() => uploadExternalDocument(casa, input, Buffer.from('x')))).code,
    ).toBe('folder_not_found');

    expect(
      (
        await catchError(() =>
          uploadExternalDocument(casa, { ...input, uploadedBy: 'otro@x.com' }, Buffer.from('x')),
        )
      ).code,
    ).toBe('not_a_member');

    expect(
      (await catchError(() => uploadExternalDocument(archivado, input, Buffer.from('x')))).status,
    ).toBe(409);

    mockDb.documentFolder.findFirst.mockResolvedValue(fox);
    mockDb.document.findMany.mockResolvedValue([]);
    jest.mocked(storeDocument).mockResolvedValue({ ok: false, reason: 'type_not_allowed' });
    const error = await catchError(() => uploadExternalDocument(casa, input, Buffer.from('x')));
    expect([error.status, error.code]).toEqual([415, 'type_not_allowed']);
  });
});

describe('updateExternalDocument', () => {
  it('changes only what came, inside the group', async () => {
    mockDb.document.findFirst.mockResolvedValue({ id: DOC_ID, folderId: 5 });
    mockDb.documentFolder.findFirst.mockResolvedValue(fox);
    mockDb.document.update.mockResolvedValue(doc({ expiresAt: null }));

    const result = await updateExternalDocument(casa, DOC_ID, { expiresAt: null });

    expect(mockDb.document.findFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: DOC_ID,
      groupId: 1,
      deletedAt: null,
    });
    expect(mockDb.document.update.mock.calls[0]?.[0]?.data).toEqual({ expiresAt: null });
    expect(result.text).toBe('Quedó "Tarjeta de seguro Fox" en Fox, sin vencimiento.');
  });

  it('moves only to a folder of the same group', async () => {
    mockDb.document.findFirst.mockResolvedValue({ id: DOC_ID, folderId: 5 });
    mockDb.documentFolder.findFirst.mockResolvedValue(null);

    expect(
      (await catchError(() => updateExternalDocument(casa, DOC_ID, { folderId: 99 }))).code,
    ).toBe('folder_not_found');
    expect(mockDb.document.update).not.toHaveBeenCalled();
  });

  it('says not found for documents of other groups or deleted ones', async () => {
    mockDb.document.findFirst.mockResolvedValue(null);

    expect((await catchError(() => updateExternalDocument(casa, DOC_ID, { name: 'X' }))).code).toBe(
      'document_not_found',
    );
  });
});
