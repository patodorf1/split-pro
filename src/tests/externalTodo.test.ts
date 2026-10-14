import { ExternalApiError } from '~/lib/externalExpense';
import {
  DEFAULT_EXTERNAL_TODO_DONE,
  MAX_EXTERNAL_TODO_DONE,
  parseExternalTodoAdd,
  parseExternalTodoPatch,
  parseExternalTodoQuery,
  todoAddText,
  todoListText,
} from '~/lib/externalTodo';
import type { LoadedGroup } from '~/server/externalExpenses';
import {
  addExternalTodo,
  deleteExternalTodo,
  listExternalTodo,
  parseTodoItemId,
  updateExternalTodo,
} from '~/server/externalTodo';

const mockDb = {
  todoItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
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

const pato = { id: 1, name: 'Pato', email: 'patodorf@gmail.com' };
const belen = { id: 2, name: 'Belén', email: 'mbelenbilbao@gmail.com' };

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- grupo mínimo de prueba
const casa = { id: 1, archivedAt: null, members: [pato, belen] } as unknown as LoadedGroup;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- grupo mínimo de prueba
const archivado = { ...casa, archivedAt: new Date() } as unknown as LoadedGroup;

const NOW = new Date('2026-10-14T12:00:00Z');
const ITEM_ID = '22222222-2222-4222-8222-222222222222';

const row = (title: string, overrides: Record<string, unknown> = {}) => ({
  id: `todo-${title}`,
  title,
  done: false,
  doneAt: null,
  createdAt: NOW,
  addedByUser: null,
  doneByUser: null,
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

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  mockDb.todoItem.create.mockImplementation(({ data }: { data: { title: string } }) =>
    Promise.resolve(row(data.title, { id: `new-${data.title}` })),
  );
});

describe('parseExternalTodoAdd', () => {
  it('cleans titles and counts repeated ones once, ignoring case and accents', () => {
    expect(
      parseExternalTodoAdd({
        items: ['- Arreglar   la canilla', 'arreglar la cánilla', '¿Llamar al plomero?'],
        addedBy: 'patodorf@gmail.com',
      }),
    ).toEqual({
      items: ['Arreglar la canilla', '¿Llamar al plomero?'],
      addedBy: 'patodorf@gmail.com',
    });
  });

  it('rejects empty lists, blank titles and unknown fields', () => {
    expect(() => parseExternalTodoAdd({ items: [] })).toThrow(ExternalApiError);
    expect(() => parseExternalTodoAdd({ items: ['  - '] })).toThrow(ExternalApiError);
    expect(() => parseExternalTodoAdd({ items: ['Regar'], note: 'x' })).toThrow(ExternalApiError);
  });
});

describe('parseExternalTodoPatch', () => {
  it('needs a title or done', () => {
    expect(parseExternalTodoPatch({ done: true, doneBy: 2 })).toEqual({ done: true, doneBy: 2 });
    expect(() => parseExternalTodoPatch({})).toThrow(ExternalApiError);
    expect(() => parseExternalTodoPatch({ doneBy: 2 })).toThrow(ExternalApiError);
  });
});

describe('parseExternalTodoQuery', () => {
  it('caps done and falls back to the default', () => {
    expect(parseExternalTodoQuery({})).toEqual({ doneLimit: DEFAULT_EXTERNAL_TODO_DONE });
    expect(parseExternalTodoQuery({ done: '0' })).toEqual({ doneLimit: 0 });
    expect(parseExternalTodoQuery({ done: '999' })).toEqual({ doneLimit: MAX_EXTERNAL_TODO_DONE });
    expect(parseExternalTodoQuery({ done: 'muchas' })).toEqual({
      doneLimit: DEFAULT_EXTERNAL_TODO_DONE,
    });
  });
});

describe('texts', () => {
  it('lists what is pending', () => {
    expect(todoListText([])).toBe('No hay nada pendiente en el To Do de la casa.');
    expect(todoListText([{ title: 'Pintar la reja' }, { title: 'Cambiar el foco' }])).toBe(
      'Para hacer en la casa (2): Pintar la reja, Cambiar el foco.',
    );
  });

  it('says what was added and what was already there', () => {
    expect(
      todoAddText([
        { title: 'Cambiar el foco', status: 'added' },
        { title: 'Pintar la reja', status: 'already' },
      ]),
    ).toBe('Sumé al To Do: Cambiar el foco. Ya estaba: Pintar la reja.');
  });
});

describe('listExternalTodo', () => {
  it('returns pending oldest first, the last done ones and a text', async () => {
    mockDb.todoItem.findMany
      .mockResolvedValueOnce([row('Pintar la reja')])
      .mockResolvedValueOnce([row('Regar', { done: true, doneAt: NOW })]);
    mockDb.todoItem.count.mockResolvedValue(4);

    const list = await listExternalTodo(casa, { doneLimit: 10 });

    expect(mockDb.todoItem.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { groupId: 1, done: false },
      orderBy: { createdAt: 'asc' },
    });
    expect(mockDb.todoItem.findMany.mock.calls[1]?.[0]).toMatchObject({ take: 10 });
    expect(list).toMatchObject({
      groupId: 1,
      pending: [{ title: 'Pintar la reja', done: false }],
      done: [{ title: 'Regar', doneAt: NOW.toISOString() }],
      doneTotal: 4,
      text: 'Para hacer en la casa (1): Pintar la reja.',
    });
  });

  it('skips the done query when none are asked for', async () => {
    mockDb.todoItem.findMany.mockResolvedValue([]);
    mockDb.todoItem.count.mockResolvedValue(0);

    expect((await listExternalTodo(casa, { doneLimit: 0 })).done).toEqual([]);
    expect(mockDb.todoItem.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('addExternalTodo', () => {
  it('creates the new ones and does not repeat what is already pending', async () => {
    mockDb.todoItem.findMany.mockResolvedValue([row('Pintar la reja')]);

    const added = await addExternalTodo(casa, {
      items: ['Cambiar el foco', 'pintar la REJA'],
      addedBy: 'mbelenbilbao@gmail.com',
    });

    expect(mockDb.todoItem.create).toHaveBeenCalledTimes(1);
    expect(mockDb.todoItem.create.mock.calls[0]?.[0]).toMatchObject({
      data: { groupId: 1, title: 'Cambiar el foco', addedBy: 2 },
    });
    expect(added.items).toMatchObject([
      { id: 'new-Cambiar el foco', title: 'Cambiar el foco', status: 'added' },
      { id: 'todo-Pintar la reja', title: 'Pintar la reja', status: 'already' },
    ]);
    expect(added.text).toBe('Sumé al To Do: Cambiar el foco. Ya estaba: Pintar la reja.');
  });

  it('rejects a non member and an archived group before writing', async () => {
    const notMember = await catchError(() =>
      addExternalTodo(casa, { items: ['Regar'], addedBy: 'otro@example.com' }),
    );
    expect(notMember).toMatchObject({ status: 400, code: 'not_a_member', field: 'addedBy' });

    const archived = await catchError(() => addExternalTodo(archivado, { items: ['Regar'] }));
    expect(archived).toMatchObject({ status: 409, code: 'group_archived' });
    expect(mockDb.todoItem.create).not.toHaveBeenCalled();
  });
});

describe('updateExternalTodo', () => {
  it('marks done with who and when', async () => {
    mockDb.todoItem.findFirst.mockResolvedValue(row('Regar', { id: ITEM_ID }));
    mockDb.todoItem.update.mockResolvedValue(
      row('Regar', { id: ITEM_ID, done: true, doneAt: NOW }),
    );

    await updateExternalTodo(casa, ITEM_ID, { done: true, doneBy: 'patodorf@gmail.com' });

    expect(mockDb.todoItem.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ITEM_ID },
      data: { done: true, doneAt: expect.any(Date), doneBy: 1 },
    });
  });

  it('keeps the date of one already done and clears it when undone', async () => {
    mockDb.todoItem.findFirst.mockResolvedValue(row('Regar', { id: ITEM_ID, done: true }));
    mockDb.todoItem.update.mockResolvedValue(row('Regar', { id: ITEM_ID }));

    await updateExternalTodo(casa, ITEM_ID, { done: true, title: 'Regar las plantas' });
    expect(mockDb.todoItem.update.mock.calls[0]?.[0].data).toEqual({ title: 'Regar las plantas' });

    await updateExternalTodo(casa, ITEM_ID, { done: false });
    expect(mockDb.todoItem.update.mock.calls[1]?.[0].data).toEqual({
      done: false,
      doneAt: null,
      doneBy: null,
    });
  });

  it('answers 404 for another group or a bad id', async () => {
    mockDb.todoItem.findFirst.mockResolvedValue(null);

    const missing = await catchError(() => updateExternalTodo(casa, ITEM_ID, { done: true }));
    expect(missing).toMatchObject({ status: 404, code: 'todo_item_not_found' });
    expect(mockDb.todoItem.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ITEM_ID, groupId: 1 },
    });
    expect(() => parseTodoItemId('regar')).toThrow(ExternalApiError);
  });
});

describe('deleteExternalTodo', () => {
  it('deletes and returns what was deleted', async () => {
    mockDb.todoItem.findFirst.mockResolvedValue(row('Regar', { id: ITEM_ID }));

    expect(await deleteExternalTodo(casa, ITEM_ID)).toMatchObject({ id: ITEM_ID, title: 'Regar' });
    expect(mockDb.todoItem.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
  });
});
