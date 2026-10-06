import {
  StockConflictError,
  addBoughtToStock,
  addToStock,
  finishStockItem,
  removeStockItem,
  setShoppingItemChecked,
  undoBoughtFromStock,
  updateStockItem,
} from '~/server/stock/service';

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

const makeDb = () => {
  // `seed` es lo que ya estaba en el Stock; `inserted` es lo que dejó createMany.
  const seed: Record<string, unknown>[] = [];
  const inserted: Record<string, unknown>[] = [];

  return {
    seed,
    ...makeClient(seed, inserted),
  };
};

const makeClient = (seed: Record<string, unknown>[], inserted: Record<string, unknown>[]) => ({
  stockItem: {
    findMany: jest.fn().mockImplementation(() => Promise.resolve([...seed, ...inserted])),
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
});

describe('addToStock', () => {
  it('creates each product in its guessed section', async () => {
    const db = makeDb();
    const { created, duplicates } = await addToStock(db as never, {
      groupId: 1,
      items: [{ name: 'Leche' }, { name: 'Lavandina', note: 'la grande' }],
      source: 'APP',
      addedBy: 7,
    });

    expect(created).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
    const { data, skipDuplicates } = db.stockItem.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data[0]).toMatchObject({
      groupId: 1,
      name: 'Leche',
      key: 'leche',
      section: 'FRIDGE',
      addedBy: 7,
    });
    expect(data[1]).toMatchObject({
      section: 'CLEANING',
      note: 'la grande',
    });
  });

  it('never duplicates, inside the batch or against what is there', async () => {
    const db = makeDb();
    db.seed.push(row({ name: 'Tomates', key: 'tomate' }));

    const { created, duplicates } = await addToStock(db as never, {
      groupId: 1,
      items: [{ name: 'tomate' }, { name: 'Huevos' }, { name: 'huevo' }],
      source: 'APP',
      addedBy: 7,
    });

    expect(duplicates.map((item) => item.name)).toEqual(['Tomates']);
    expect(created.map((item) => item.name)).toEqual(['Huevos']);
    expect(db.stockItem.createMany).toHaveBeenCalledTimes(1);
    expect(db.stockItem.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('survives another request inserting the same product first (no throw, no abort)', async () => {
    const db = makeDb();
    // Antes del insert no estaba; después sí (otro teléfono lo agregó en el medio).
    db.stockItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ name: 'Leche', key: 'leche' })]);

    const { created, duplicates } = await addToStock(db as never, {
      groupId: 1,
      items: [{ name: 'Leche' }],
      source: 'APP',
      addedBy: 7,
    });

    expect(db.stockItem.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(created.map((item) => item.name)).toEqual(['Leche']);
    expect(duplicates).toHaveLength(0);
  });

  it('uses the section the group taught it', async () => {
    const db = makeDb();
    db.stockPlacement.findMany.mockResolvedValue([{ key: 'pollo', section: 'FRIDGE' }]);

    await addToStock(db as never, {
      groupId: 1,
      items: [{ name: 'Pollo' }],
      source: 'API',
      addedBy: null,
    });

    expect(db.stockItem.createMany.mock.calls[0][0].data[0].section).toBe('FRIDGE');
  });
});

describe('bridge with Compras', () => {
  it('adds what was bought, remembering which purchase brought it', async () => {
    const db = makeDb();
    const result = await addBoughtToStock(
      db as never,
      { id: 'shop-1', groupId: 1, name: 'Leche' },
      'ALEXA',
      null,
    );

    expect(result?.created).toBe(true);
    expect(db.stockItem.createMany.mock.calls[0][0].data[0]).toMatchObject({
      fromShoppingItemId: 'shop-1',
      source: 'ALEXA',
    });
  });

  it('does nothing new when it was already there', async () => {
    const db = makeDb();
    db.seed.push(row());

    const result = await addBoughtToStock(
      db as never,
      { id: 'shop-1', groupId: 1, name: 'leche' },
      'APP',
      7,
    );

    expect(result?.created).toBe(false);
    expect(db.stockItem.createMany).not.toHaveBeenCalled();
  });

  it('undoes only what that purchase brought', async () => {
    const db = makeDb();
    await undoBoughtFromStock(db as never, 'shop-1');

    expect(db.stockItem.deleteMany).toHaveBeenCalledWith({
      where: { fromShoppingItemId: 'shop-1' },
    });
  });
});

describe('finishStockItem', () => {
  it('removes it and puts it in Compras', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(row());

    const result = await finishStockItem(db as never, {
      groupId: 1,
      id: 'stock-1',
      userId: 7,
      source: 'APP',
    });

    expect(result?.addedToShopping).toBe(true);
    expect(db.stockItem.deleteMany).toHaveBeenCalledWith({
      where: { id: 'stock-1', groupId: 1 },
    });
    expect(db.shoppingItem.create.mock.calls[0][0].data).toMatchObject({
      groupId: 1,
      name: 'Leche',
      addedBy: 7,
      source: 'APP',
    });
  });

  it('does not duplicate in Compras (plural counts as the same)', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(row({ name: 'Tomate', key: 'tomate' }));
    db.shoppingItem.findMany.mockResolvedValue([{ id: 'shop-9', name: 'tomates' }]);

    const result = await finishStockItem(db as never, {
      groupId: 1,
      id: 'stock-1',
      userId: 7,
      source: 'APP',
    });

    expect(result?.addedToShopping).toBe(false);
    expect(db.shoppingItem.create).not.toHaveBeenCalled();
  });

  it('skips an item a concurrent finish already removed (no throw, no Compras)', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(row());
    db.stockItem.deleteMany.mockResolvedValue({ count: 0 });

    const result = await finishStockItem(db as never, {
      groupId: 1,
      id: 'stock-1',
      userId: 7,
      source: 'APP',
    });

    expect(result).toBeNull();
    expect(db.stockItem.delete).not.toHaveBeenCalled();
    expect(db.shoppingItem.create).not.toHaveBeenCalled();
  });

  it('only touches items of the group', async () => {
    const db = makeDb();

    expect(
      await finishStockItem(db as never, { groupId: 1, id: 'x', userId: 7, source: 'APP' }),
    ).toBeNull();
    expect(db.stockItem.findFirst.mock.calls[0][0].where).toEqual({ id: 'x', groupId: 1 });
  });
});

describe('removeStockItem', () => {
  it('removes without going to Compras', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(row());

    expect(await removeStockItem(db as never, { groupId: 1, id: 'stock-1' })).not.toBeNull();
    expect(db.shoppingItem.create).not.toHaveBeenCalled();
  });
});

describe('updateStockItem', () => {
  it('learns the section and forgets the purchase that brought it', async () => {
    const db = makeDb();
    db.stockItem.findFirst.mockResolvedValue(
      row({ name: 'Pollo', key: 'pollo', section: 'FREEZER' }),
    );

    await updateStockItem(db as never, { groupId: 1, id: 'stock-1', section: 'FRIDGE' });

    expect(db.stockPlacement.upsert).toHaveBeenCalledWith({
      where: { groupId_key: { groupId: 1, key: 'pollo' } },
      create: { groupId: 1, key: 'pollo', section: 'FRIDGE' },
      update: { section: 'FRIDGE' },
    });
    expect(db.stockItem.update.mock.calls[0][0].data).toMatchObject({
      section: 'FRIDGE',
      fromShoppingItemId: null,
    });
  });

  it('refuses to rename into a product that is already there', async () => {
    const db = makeDb();
    db.stockItem.findFirst
      .mockResolvedValueOnce(row({ id: 'stock-1', name: 'Leche', key: 'leche' }))
      .mockResolvedValueOnce(row({ id: 'stock-2', name: 'Huevos', key: 'huevo' }));

    await expect(
      updateStockItem(db as never, { groupId: 1, id: 'stock-1', name: 'huevo' }),
    ).rejects.toBeInstanceOf(StockConflictError);
  });
});

describe('setShoppingItemChecked', () => {
  const makeCheckDb = (count: number) => {
    const db = makeDb();

    return Object.assign(db, {
      shoppingItem: {
        ...db.shoppingItem,
        updateMany: jest.fn().mockResolvedValue({ count }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'shop-1', name: 'Leche' }),
      },
    });
  };
  const input = {
    id: 'shop-1',
    groupId: 1,
    userId: 7,
    select: { id: true, name: true },
  } as const;

  it('ticks with the person and the source, and puts the purchase in the stock', async () => {
    const db = makeCheckDb(1);
    const result = await setShoppingItemChecked(db as never, {
      ...input,
      checked: true,
      source: 'API',
    });

    expect(db.shoppingItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'shop-1', groupId: 1, checked: false },
      data: { checked: true, checkedAt: expect.any(Date), checkedBy: 7 },
    });
    expect(result).toMatchObject({ changed: true, item: { name: 'Leche' } });
    expect(result.stock?.created).toBe(true);
    expect(db.stockItem.createMany.mock.calls[0][0].data[0]).toMatchObject({
      source: 'API',
      addedBy: 7,
      fromShoppingItemId: 'shop-1',
    });
  });

  it('asks for the source once it has read the item', async () => {
    const db = makeCheckDb(1);
    const source = jest.fn().mockReturnValue('ALEXA');

    await setShoppingItemChecked(db as never, { ...input, checked: true, source });

    expect(source).toHaveBeenCalledWith({ id: 'shop-1', name: 'Leche' });
    expect(db.stockItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ source: 'ALEXA' });
  });

  it('does not touch the stock when somebody else already changed it', async () => {
    const db = makeCheckDb(0);
    const result = await setShoppingItemChecked(db as never, {
      ...input,
      checked: true,
      source: 'API',
    });

    expect(result).toMatchObject({ changed: false, stock: null });
    expect(db.stockItem.createMany).not.toHaveBeenCalled();
  });

  it('takes out of the stock what the purchase brought when unticking', async () => {
    const db = makeCheckDb(1);
    const result = await setShoppingItemChecked(db as never, {
      ...input,
      checked: false,
      source: 'API',
    });

    expect(db.shoppingItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { checked: false, checkedAt: null, checkedBy: null } }),
    );
    expect(db.stockItem.deleteMany).toHaveBeenCalledWith({
      where: { fromShoppingItemId: 'shop-1' },
    });
    expect(result).toMatchObject({ changed: true, stock: null });
  });
});
