import type { NextApiRequest, NextApiResponse } from 'next';

import handler from '~/pages/api/external/shopping/[groupId]';

const mockDb = {
  group: { findUnique: jest.fn() },
  shoppingItem: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  stockItem: {
    findMany: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  stockPlacement: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

// El handler importa el router de Compras (y con él el contexto de tRPC): se apagan la sesión y
// superjson, que es ESM puro, y la base es una falsa que se reconfigura en cada test.
jest.mock('~/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('superjson', () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => ({ json: value }),
    deserialize: (value: unknown) => value,
  },
}));
jest.mock('~/server/db', () => ({
  get db() {
    return mockDb;
  },
}));
jest.mock('~/server/externalApi', () => ({
  getBearerToken: () => 'key',
  isExternalApiEnabled: () => true,
  isValidExternalApiKey: () => true,
}));

const ITEM_ID = '11111111-1111-4111-8111-111111111111';

const savedRow = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  name: 'Leche',
  quantity: null,
  note: null,
  checked: true,
  checkedAt: new Date('2026-10-06T12:00:00Z'),
  source: 'ALEXA',
  externalId: null,
  sortOrder: null,
  createdAt: new Date('2026-10-06T11:00:00Z'),
  updatedAt: new Date('2026-10-06T12:00:00Z'),
  addedByUser: null,
  checkedByUser: null,
  ...overrides,
});

const patch = async (checked: boolean) => {
  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer key' },
    query: { groupId: '1' },
    body: { items: [{ id: ITEM_ID, checked }] },
  } as unknown as NextApiRequest;
  const json = jest.fn();
  const res = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue({ json }),
  } as unknown as NextApiResponse;

  await handler(req, res);

  return { status: (res.status as jest.Mock).mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.group.findUnique.mockResolvedValue({ id: 1 });
  mockDb.shoppingItem.findFirst.mockResolvedValue({ id: ITEM_ID });
  mockDb.shoppingItem.updateMany.mockResolvedValue({ count: 1 });
  mockDb.shoppingItem.findUniqueOrThrow.mockResolvedValue(savedRow());
  mockDb.shoppingItem.update.mockResolvedValue(savedRow());
  mockDb.stockItem.findMany.mockResolvedValue([]);
  mockDb.stockItem.createMany.mockResolvedValue({ count: 1 });
  mockDb.stockItem.deleteMany.mockResolvedValue({ count: 1 });
  mockDb.stockPlacement.findMany.mockResolvedValue([]);
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe('external shopping PATCH and the stock', () => {
  it('decides the real change inside the write and passes the item own source', async () => {
    const { status, body } = await patch(true);

    expect(status).toBe(200);
    expect(mockDb.shoppingItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM_ID, groupId: 1, checked: false } }),
    );
    expect(mockDb.stockItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ source: 'ALEXA', addedBy: null })],
      }),
    );
    expect(body).toMatchObject({ groupId: 1, updated: 1, notFound: [] });
    expect(body.items[0]).toMatchObject({ id: ITEM_ID, source: 'alexa', checked: true });
  });

  it('uses API as the stock source for items that did not come from Alexa', async () => {
    mockDb.shoppingItem.findUniqueOrThrow.mockResolvedValue(savedRow({ source: 'APP' }));
    await patch(true);

    expect(mockDb.stockItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ source: 'API' })] }),
    );
  });

  it('undoes the stock entry when the item is unchecked', async () => {
    mockDb.shoppingItem.findUniqueOrThrow.mockResolvedValue(savedRow({ checked: false }));
    await patch(false);

    expect(mockDb.shoppingItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM_ID, groupId: 1, checked: true } }),
    );
    expect(mockDb.stockItem.deleteMany).toHaveBeenCalledWith({
      where: { fromShoppingItemId: ITEM_ID },
    });
  });

  it('leaves the stock alone when the state does not change, and answers the same', async () => {
    mockDb.shoppingItem.updateMany.mockResolvedValue({ count: 0 });
    const { status, body } = await patch(true);

    expect(status).toBe(200);
    expect(mockDb.stockItem.createMany).not.toHaveBeenCalled();
    expect(mockDb.stockItem.deleteMany).not.toHaveBeenCalled();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: ITEM_ID, checked: true, source: 'alexa' });
  });
});
