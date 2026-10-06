import type { NextApiRequest, NextApiResponse } from 'next';

import itemHandler from '~/pages/api/external/groups/[groupId]/stock/[itemId]';
import finishHandler from '~/pages/api/external/groups/[groupId]/stock/finish';
import stockHandler from '~/pages/api/external/groups/[groupId]/stock/index';
import {
  addExternalStock,
  finishExternalStock,
  listExternalStock,
  removeExternalStockItem,
  updateExternalStockItem,
} from '~/server/externalStock';

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
// Las rutas solo cablean: la lógica con base se prueba en externalStockService.test.ts.
jest.mock('~/server/externalStock', () => ({
  ...jest.requireActual('~/server/externalStock'),
  addExternalStock: jest.fn(),
  finishExternalStock: jest.fn(),
  listExternalStock: jest.fn(),
  removeExternalStockItem: jest.fn(),
  updateExternalStockItem: jest.fn(),
}));

const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const pato = { id: 1, name: 'Pato', email: 'patodorf@gmail.com' };

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

const call = async (
  handler: Handler,
  method: string,
  query: Record<string, string>,
  body?: unknown,
) => {
  const json = jest.fn();
  const res = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue({ json }),
  } as unknown as NextApiResponse;

  await handler(
    { method, headers: { authorization: 'Bearer key' }, query, body } as unknown as NextApiRequest,
    res,
  );

  return {
    status: (res.status as jest.Mock).mock.calls[0]?.[0],
    body: json.mock.calls[0]?.[0],
    headers: (res.setHeader as jest.Mock).mock.calls,
  };
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.group.findUnique.mockResolvedValue({
    id: 1,
    archivedAt: null,
    groupUsers: [{ user: pato }],
  });
});

describe('stock routes', () => {
  it('reads with q and adds with a parsed body', async () => {
    jest.mocked(listExternalStock).mockResolvedValue({ groupId: 1 } as never);
    jest.mocked(addExternalStock).mockResolvedValue({ groupId: 1, items: [] } as never);

    expect((await call(stockHandler, 'GET', { groupId: '1', q: 'arroz' })).status).toBe(200);
    expect(jest.mocked(listExternalStock).mock.calls[0]?.[1]).toEqual({ q: 'arroz' });

    const added = await call(stockHandler, 'POST', { groupId: '1' }, { items: [{ name: 'Pan' }] });
    expect(added.status).toBe(200);
    expect(jest.mocked(addExternalStock).mock.calls[0]?.[1]).toEqual({
      items: [{ name: 'Pan', key: 'pan' }],
      addedBy: undefined,
    });
  });

  it('answers 400 for a bad body, 404 for a missing group and 405 for other methods', async () => {
    const bad = await call(stockHandler, 'POST', { groupId: '1' }, { items: [] });
    expect(bad).toMatchObject({ status: 400, body: { code: 'validation_error', field: 'items' } });
    expect(addExternalStock).not.toHaveBeenCalled();

    mockDb.group.findUnique.mockResolvedValue(null);
    expect((await call(stockHandler, 'GET', { groupId: '9' })).body.code).toBe('group_not_found');

    const wrong = await call(stockHandler, 'PUT', { groupId: '1' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers).toContainEqual(['Allow', 'GET, POST']);
  });

  it('finishes by name', async () => {
    jest.mocked(finishExternalStock).mockResolvedValue({ groupId: 1, items: [] } as never);

    const done = await call(finishHandler, 'POST', { groupId: '1' }, { items: ['Leche'] });

    expect(done.status).toBe(200);
    expect(jest.mocked(finishExternalStock).mock.calls[0]?.[1]).toEqual({
      items: ['Leche'],
      addedBy: undefined,
    });
    expect((await call(finishHandler, 'GET', { groupId: '1' })).status).toBe(405);
  });

  it('patches and removes one item by id', async () => {
    jest.mocked(updateExternalStockItem).mockResolvedValue({ id: ITEM_ID } as never);
    jest.mocked(removeExternalStockItem).mockResolvedValue({ id: ITEM_ID } as never);

    const patched = await call(
      itemHandler,
      'PATCH',
      { groupId: '1', itemId: ITEM_ID },
      { section: 'fridge' },
    );
    expect(patched).toMatchObject({ status: 200, body: { groupId: 1, item: { id: ITEM_ID } } });
    expect(jest.mocked(updateExternalStockItem).mock.calls[0]?.slice(1)).toEqual([
      ITEM_ID,
      { section: 'FRIDGE' },
    ]);

    const removed = await call(itemHandler, 'DELETE', { groupId: '1', itemId: ITEM_ID });
    expect(removed).toMatchObject({ status: 200, body: { groupId: 1, removed: true } });

    const notFound = await call(itemHandler, 'DELETE', { groupId: '1', itemId: 'leche' });
    expect(notFound).toMatchObject({ status: 404, body: { code: 'stock_item_not_found' } });
  });
});
