import documentHandler from '~/pages/api/external/groups/[groupId]/documents/[documentId]';
import documentsHandler from '~/pages/api/external/groups/[groupId]/documents/index';
import { parseExpiryDay } from '~/lib/documentReminders';
import {
  listExternalDocuments,
  readDocumentBody,
  updateExternalDocument,
  uploadExternalDocument,
} from '~/server/externalDocuments';
import { callHandler as call } from '~/tests/helpers/callHandler';

const mockDb = { group: { findUnique: jest.fn() } };

jest.mock('~/server/db', () => ({
  get db() {
    return mockDb;
  },
}));
jest.mock('~/server/api/services/splitService', () => ({
  createExpense: jest.fn(),
  deleteExpense: jest.fn(),
}));
jest.mock('~/server/externalApi', () => ({
  getBearerToken: () => 'key',
  isExternalApiEnabled: () => true,
  isValidExternalApiKey: () => true,
}));
// Las rutas solo cablean: la lógica con base se prueba en externalDocuments.test.ts.
jest.mock('~/server/externalDocuments', () => ({
  ...jest.requireActual('~/server/externalDocuments'),
  listExternalDocuments: jest.fn(),
  readDocumentBody: jest.fn(),
  updateExternalDocument: jest.fn(),
  uploadExternalDocument: jest.fn(),
}));

const DOC_ID = '33333333-3333-4333-8333-333333333333';
const pato = { id: 1, name: 'Pato', email: 'patodorf@gmail.com' };

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.group.findUnique.mockResolvedValue({
    id: 1,
    archivedAt: null,
    groupUsers: [{ user: pato }],
  });
});

describe('documents routes', () => {
  it('lists with the search', async () => {
    jest.mocked(listExternalDocuments).mockResolvedValue({ groupId: 1 } as never);

    expect((await call(documentsHandler, 'GET', { groupId: '1', q: 'seguro' })).status).toBe(200);
    expect(jest.mocked(listExternalDocuments).mock.calls[0]?.[1]).toEqual({ search: 'seguro' });
  });

  it('uploads the raw body with the query: 201 new, 200 already there', async () => {
    jest.mocked(readDocumentBody).mockResolvedValue(Buffer.from('jpeg'));
    jest.mocked(uploadExternalDocument).mockResolvedValueOnce({ status: 'added' } as never);

    const query = { groupId: '1', folderId: '5', fileName: 'a.jpg', expiresAt: '2027-02-02' };
    expect((await call(documentsHandler, 'POST', query)).status).toBe(201);
    expect(jest.mocked(uploadExternalDocument).mock.calls[0]?.slice(1)).toEqual([
      { folderId: 5, fileName: 'a.jpg', expiresAt: parseExpiryDay('2027-02-02') },
      Buffer.from('jpeg'),
    ]);

    jest.mocked(uploadExternalDocument).mockResolvedValueOnce({ status: 'already' } as never);
    expect((await call(documentsHandler, 'POST', query)).status).toBe(200);
  });

  it('checks the query before reading the file', async () => {
    const response = await call(documentsHandler, 'POST', { groupId: '1' });

    expect(response.status).toBe(400);
    expect(readDocumentBody).not.toHaveBeenCalled();
  });

  it('patches a document and refuses other methods', async () => {
    jest.mocked(updateExternalDocument).mockResolvedValue({ groupId: 1 } as never);

    const patched = await call(
      documentHandler,
      'PATCH',
      { groupId: '1', documentId: DOC_ID },
      { expiresAt: null },
    );
    expect(patched.status).toBe(200);
    expect(jest.mocked(updateExternalDocument).mock.calls[0]?.slice(1)).toEqual([
      DOC_ID,
      { expiresAt: null },
    ]);

    expect(
      (await call(documentHandler, 'DELETE', { groupId: '1', documentId: DOC_ID })).status,
    ).toBe(405);
    expect((await call(documentsHandler, 'PUT', { groupId: '1' })).status).toBe(405);
  });
});
