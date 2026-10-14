import itemHandler from '~/pages/api/external/groups/[groupId]/todo/[itemId]';
import todoHandler from '~/pages/api/external/groups/[groupId]/todo/index';
import {
  addExternalTodo,
  deleteExternalTodo,
  listExternalTodo,
  updateExternalTodo,
} from '~/server/externalTodo';
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
// Las rutas solo cablean: la lógica con base se prueba en externalTodo.test.ts.
jest.mock('~/server/externalTodo', () => ({
  ...jest.requireActual('~/server/externalTodo'),
  addExternalTodo: jest.fn(),
  deleteExternalTodo: jest.fn(),
  listExternalTodo: jest.fn(),
  updateExternalTodo: jest.fn(),
}));

const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const pato = { id: 1, name: 'Pato', email: 'patodorf@gmail.com' };

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.group.findUnique.mockResolvedValue({
    id: 1,
    archivedAt: null,
    groupUsers: [{ user: pato }],
  });
});

describe('todo routes', () => {
  it('reads with done and adds with a parsed body', async () => {
    jest.mocked(listExternalTodo).mockResolvedValue({ groupId: 1 } as never);
    jest.mocked(addExternalTodo).mockResolvedValue({ groupId: 1, items: [] } as never);

    expect((await call(todoHandler, 'GET', { groupId: '1', done: '5' })).status).toBe(200);
    expect(jest.mocked(listExternalTodo).mock.calls[0]?.[1]).toEqual({ doneLimit: 5 });

    const added = await call(todoHandler, 'POST', { groupId: '1' }, { items: ['- Regar'] });
    expect(added.status).toBe(200);
    expect(jest.mocked(addExternalTodo).mock.calls[0]?.[1]).toEqual({
      items: ['Regar'],
      addedBy: undefined,
    });
  });

  it('answers 400 for a bad body, 404 for a missing group and 405 for other methods', async () => {
    const bad = await call(todoHandler, 'POST', { groupId: '1' }, { items: [] });
    expect(bad).toMatchObject({ status: 400, body: { code: 'validation_error', field: 'items' } });
    expect(addExternalTodo).not.toHaveBeenCalled();

    mockDb.group.findUnique.mockResolvedValue(null);
    expect((await call(todoHandler, 'GET', { groupId: '9' })).body.code).toBe('group_not_found');

    const wrong = await call(todoHandler, 'PUT', { groupId: '1' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers).toContainEqual(['Allow', 'GET, POST']);
  });

  it('patches and deletes one task by id', async () => {
    jest.mocked(updateExternalTodo).mockResolvedValue({ id: ITEM_ID } as never);
    jest.mocked(deleteExternalTodo).mockResolvedValue({ id: ITEM_ID } as never);

    const patched = await call(
      itemHandler,
      'PATCH',
      { groupId: '1', itemId: ITEM_ID },
      { done: true },
    );
    expect(patched).toMatchObject({ status: 200, body: { groupId: 1, item: { id: ITEM_ID } } });
    expect(jest.mocked(updateExternalTodo).mock.calls[0]?.slice(1)).toEqual([
      ITEM_ID,
      { done: true },
    ]);

    const deleted = await call(itemHandler, 'DELETE', { groupId: '1', itemId: ITEM_ID });
    expect(deleted).toMatchObject({ status: 200, body: { groupId: 1, deleted: true } });

    const notFound = await call(itemHandler, 'DELETE', { groupId: '1', itemId: 'regar' });
    expect(notFound).toMatchObject({ status: 404, body: { code: 'todo_item_not_found' } });
  });
});
