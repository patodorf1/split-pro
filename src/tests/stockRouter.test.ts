import { stockRouter } from '~/server/api/routers/stock';

// El router importa el contexto de tRPC, que trae la sesión y el cliente de la base: acá se usa
// Una base falsa por test. superjson es ESM puro y la llamada directa no serializa nada.
jest.mock('~/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('~/server/db', () => ({ db: {} }));
jest.mock('superjson', () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => ({ json: value }),
    deserialize: (value: unknown) => value,
  },
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'stock-1',
  name: 'Leche',
  key: 'leche',
  note: null,
  section: 'FRIDGE',
  source: 'APP',
  createdAt: new Date('2026-10-06T12:00:00Z'),
  updatedAt: new Date('2026-10-06T12:00:00Z'),
  addedByUser: null,
  ...overrides,
});

const makeDb = (member = true) => {
  // `inserted` es lo que dejó createMany; findMany lo devuelve en la segunda lectura.
  const inserted: Record<string, unknown>[] = [];

  const db = {
    groupUser: { findFirst: jest.fn().mockResolvedValue(member ? { groupId: 1 } : null) },
    stockItem: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve([...inserted])),
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockImplementation(({ data }: { data: { key: string }[] }) => {
        inserted.push(...data.map((entry) => row({ id: `new-${entry.key}`, ...entry })));

        return Promise.resolve({ count: data.length });
      }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
      delete: jest.fn().mockResolvedValue(row()),
    },
    stockPlacement: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    shoppingItem: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'shop-1' }),
    },
    $transaction: jest.fn(),
  };

  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));

  return db;
};

const callerFor = (db: ReturnType<typeof makeDb>) =>
  stockRouter.createCaller({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sesión mínima de prueba
    session: { user: { id: 7 }, expires: '' } as never,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- base falsa de prueba
    db: db as never,
  });

const ITEM_ID = '00000000-0000-4000-8000-000000000000';

describe('stock router', () => {
  it('adds several items from one text', async () => {
    const db = makeDb();
    const result = await callerFor(db).addItems({ groupId: 1, text: 'leche, arroz\ntomates' });

    expect(result.created).toHaveLength(3);
  });

  it('rejects people outside the group', async () => {
    await expect(callerFor(makeDb(false)).getList({ groupId: 1 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('answers not found for items of another group', async () => {
    await expect(callerFor(makeDb()).finish({ groupId: 1, id: ITEM_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('finishes inside one transaction so the item never gets lost halfway', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(row());

    const result = await callerFor(db).finish({ groupId: 1, id: ITEM_ID });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(result.addedToShopping).toBe(true);
    expect(result.item.name).toBe('Leche');
    expect(db.shoppingItem.create).toHaveBeenCalledTimes(1);
  });

  it('answers not found when the item vanished between the check and the delete (double tap)', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(row());
    db.stockItem.delete.mockRejectedValue({ code: 'P2025' });

    await expect(callerFor(db).finish({ groupId: 1, id: ITEM_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a blank name when renaming', async () => {
    const db = makeDb();

    await expect(
      callerFor(db).updateItem({ groupId: 1, id: ITEM_ID, name: '   ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.stockItem.update).not.toHaveBeenCalled();
  });

  it('answers conflict when a rename loses the race on the unique key', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(row());
    db.stockItem.update.mockRejectedValue({ code: 'P2002' });

    await expect(
      callerFor(db).updateItem({ groupId: 1, id: ITEM_ID, name: 'Huevos' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'already_in_stock' });
  });
});
