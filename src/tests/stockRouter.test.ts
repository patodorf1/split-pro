import { shoppingRouter } from '~/server/api/routers/shopping';
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
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
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

  it('lists items in a stable order by key (no case or accent surprises)', async () => {
    const db = makeDb();
    await callerFor(db).getList({ groupId: 1 });

    expect(db.stockItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: 1 }, orderBy: { key: 'asc' } }),
    );
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
    db.stockItem.deleteMany.mockResolvedValue({ count: 0 });

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

describe('shopping.setChecked bridge', () => {
  const makeShoppingDb = () => {
    const base = makeDb();
    const db = {
      ...base,
      shoppingItem: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
        // count 1 = el tildado cambió de verdad en esta escritura; count 0 = ya estaba así.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', name: 'Leche' }),
      },
      stockItem: { ...base.stockItem, deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(),
    };

    db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));

    return db;
  };

  const shoppingCaller = (db: ReturnType<typeof makeShoppingDb>) =>
    shoppingRouter.createCaller({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sesión mínima de prueba
      session: { user: { id: 7 }, expires: '' } as never,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- base falsa de prueba
      db: db as never,
    });

  it('puts what was bought in the stock', async () => {
    const db = makeShoppingDb();
    const result = await shoppingCaller(db).setChecked({
      groupId: 1,
      id: '11111111-1111-4111-8111-111111111111',
      checked: true,
    });

    expect(result.stock).toEqual({ name: 'Leche', section: 'FRIDGE', created: true });
    expect(db.stockItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            key: 'leche',
            source: 'APP',
            addedBy: 7,
            fromShoppingItemId: '11111111-1111-4111-8111-111111111111',
          }),
        ],
      }),
    );
  });

  it('decides the real change inside the write itself', async () => {
    const db = makeShoppingDb();
    await shoppingCaller(db).setChecked({
      groupId: 1,
      id: '11111111-1111-4111-8111-111111111111',
      checked: true,
    });

    expect(db.shoppingItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '11111111-1111-4111-8111-111111111111', groupId: 1, checked: false },
        data: expect.objectContaining({ checked: true, checkedBy: 7 }),
      }),
    );
  });

  it('undoes it when unchecked', async () => {
    const db = makeShoppingDb();
    const result = await shoppingCaller(db).setChecked({
      groupId: 1,
      id: '11111111-1111-4111-8111-111111111111',
      checked: false,
    });

    expect(result.stock).toBeNull();
    expect(db.stockItem.deleteMany).toHaveBeenCalledWith({
      where: { fromShoppingItemId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(db.stockItem.createMany).not.toHaveBeenCalled();
  });

  it('does nothing to the stock when the check does not change (stale second phone)', async () => {
    const db = makeShoppingDb();
    db.shoppingItem.updateMany.mockResolvedValue({ count: 0 });
    const result = await shoppingCaller(db).setChecked({
      groupId: 1,
      id: '11111111-1111-4111-8111-111111111111',
      checked: true,
    });

    expect(result.stock).toBeNull();
    expect(db.stockItem.createMany).not.toHaveBeenCalled();
    expect(db.stockItem.deleteMany).not.toHaveBeenCalled();
  });

  it('does nothing to the stock when unchecking an item that was not checked', async () => {
    const db = makeShoppingDb();
    db.shoppingItem.updateMany.mockResolvedValue({ count: 0 });
    const result = await shoppingCaller(db).setChecked({
      groupId: 1,
      id: '11111111-1111-4111-8111-111111111111',
      checked: false,
    });

    expect(result.stock).toBeNull();
    expect(db.stockItem.deleteMany).not.toHaveBeenCalled();
  });

  it('runs the check and the stock change in one transaction', async () => {
    const db = makeShoppingDb();
    await shoppingCaller(db).setChecked({
      groupId: 1,
      id: '11111111-1111-4111-8111-111111111111',
      checked: true,
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
