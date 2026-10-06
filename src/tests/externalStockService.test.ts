import { ExternalApiError } from '~/lib/externalExpense';
import { parseExternalStockAdd, parseExternalStockFinish } from '~/lib/externalStock';
import { stockKey } from '~/lib/stock';
import type { LoadedGroup } from '~/server/externalExpenses';
import {
  addExternalStock,
  finishExternalStock,
  listExternalStock,
  parseStockItemId,
  removeExternalStockItem,
  updateExternalStockItem,
} from '~/server/externalStock';

const mockDb = {
  stockItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  stockPlacement: { findMany: jest.fn(), upsert: jest.fn() },
  shoppingItem: {
    findMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
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

const NOW = new Date('2026-10-06T12:00:00Z');
const ITEM_ID = '22222222-2222-4222-8222-222222222222';

interface Row {
  id: string;
  name: string;
  key: string;
  note: string | null;
  section: string;
  source: string;
  fromShoppingItemId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  addedByUser: null;
}

const row = (name: string, overrides: Partial<Row> = {}): Row => ({
  id: `stock-${stockKey(name)}`,
  name,
  key: stockKey(name),
  note: null,
  section: 'PANTRY',
  source: 'APP',
  createdAt: NOW,
  updatedAt: NOW,
  addedByUser: null,
  ...overrides,
});

/** Stock y Compras de mentira, en memoria, para que el servicio real del Stock trabaje encima. */
let stock: Row[] = [];
let pending: { id: string; name: string }[] = [];

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
  throw new Error('No lanzó error');
};

beforeEach(() => {
  jest.resetAllMocks();
  stock = [];
  pending = [];
  mockDb.stockItem.findMany.mockImplementation(({ where }: { where: { key?: { in: string[] } } }) =>
    Promise.resolve(stock.filter((item) => !where.key || where.key.in.includes(item.key))),
  );
  mockDb.stockItem.findFirst.mockImplementation(
    ({ where }: { where: { id?: string; key?: string } }) =>
      Promise.resolve(
        stock.find(
          (item) =>
            (undefined === where.id || item.id === where.id) &&
            (undefined === where.key || item.key === where.key),
        ) ?? null,
      ),
  );
  mockDb.stockItem.createMany.mockImplementation(
    ({ data }: { data: (Partial<Row> & { name: string })[] }) => {
      for (const entry of data) {
        stock.push(row(entry.name, { ...entry, id: `new-${entry.key}` }));
      }
      return Promise.resolve({ count: data.length });
    },
  );
  mockDb.stockItem.update.mockImplementation(
    ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const item = stock.find((entry) => entry.id === where.id)!;
      Object.assign(
        item,
        Object.fromEntries(Object.entries(data).filter(([, value]) => undefined !== value)),
      );
      return Promise.resolve(item);
    },
  );
  mockDb.stockItem.delete.mockImplementation(({ where }: { where: { id: string } }) => {
    stock = stock.filter((item) => item.id !== where.id);
    return Promise.resolve({});
  });
  mockDb.stockPlacement.findMany.mockResolvedValue([]);
  mockDb.stockPlacement.upsert.mockResolvedValue({});
  mockDb.shoppingItem.findMany.mockImplementation(() => Promise.resolve(pending));
  mockDb.shoppingItem.findUniqueOrThrow.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(pending.find((entry) => entry.id === where.id)),
  );
  mockDb.shoppingItem.updateMany.mockResolvedValue({ count: 1 });
  mockDb.shoppingItem.create.mockResolvedValue({});
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe('listExternalStock', () => {
  it('reads only the group of the URL and filters by whole words', async () => {
    stock = [row('Arroz yamaní'), row('Leche', { section: 'FRIDGE' }), row('Arrollado')];

    const result = await listExternalStock(casa, { q: 'arroz' });

    expect(mockDb.stockItem.findMany.mock.calls[0][0].where).toEqual({ groupId: 1 });
    expect(result).toMatchObject({
      groupId: 1,
      q: 'arroz',
      total: 1,
      text: 'Hay: Arroz yamaní (Alacena).',
    });
    expect(result.sections).toEqual([
      {
        section: 'pantry',
        label: 'Alacena',
        items: [
          {
            id: 'stock-arroz yamani',
            name: 'Arroz yamaní',
            note: null,
            section: 'pantry',
            sectionLabel: 'Alacena',
            source: 'app',
            addedBy: null,
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
          },
        ],
      },
    ]);
  });
});

describe('addExternalStock', () => {
  it('ticks what was pending in Compras and adds the rest, without duplicating', async () => {
    stock = [row('Leche', { section: 'FRIDGE' })];
    pending = [{ id: 'shop-1', name: 'Tomates' }];

    const result = await addExternalStock(
      casa,
      parseExternalStockAdd({
        items: [{ name: 'tomate' }, { name: 'Pollo' }, { name: 'leche' }],
        addedBy: 'patodorf@gmail.com',
      }),
    );

    expect(mockDb.shoppingItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'shop-1', groupId: 1, checked: false },
      data: { checked: true, checkedAt: expect.any(Date), checkedBy: 1 },
    });
    // El puente lo pasa al Stock con el nombre de Compras y anotando de qué compra vino.
    expect(stock.find((item) => 'tomate' === item.key)).toMatchObject({
      name: 'Tomates',
      section: 'PRODUCE',
      fromShoppingItemId: 'shop-1',
      source: 'API',
    });
    expect(stock.find((item) => 'pollo' === item.key)).toMatchObject({
      section: 'FREEZER',
      source: 'API',
      fromShoppingItemId: null,
    });
    expect(stock.filter((item) => 'leche' === item.key)).toHaveLength(1);
    expect(result.items.map((item) => [item.name, item.status, item.fromShopping])).toEqual([
      ['Tomates', 'added', true],
      ['Pollo', 'added', false],
      ['Leche', 'already', false],
    ]);
    expect(result.text).toBe(
      'Sumé al Stock: Tomates (Frutas y verduras), Pollo (Freezer). Ya estaba: Leche (Heladera). Tildé en Compras: Tomates.',
    );
  });

  it('adds it anyway when someone else ticked it in the middle', async () => {
    pending = [{ id: 'shop-1', name: 'Tomates' }];
    mockDb.shoppingItem.updateMany.mockResolvedValue({ count: 0 });

    const result = await addExternalStock(
      casa,
      parseExternalStockAdd({ items: [{ name: 'Tomates' }] }),
    );

    expect(result.items[0]).toMatchObject({
      name: 'Tomates',
      status: 'added',
      fromShopping: false,
    });
    expect(stock).toHaveLength(1);
  });

  it('puts it in the section asked for, and remembers it', async () => {
    stock = [row('Pollo', { section: 'FREEZER' })];

    const result = await addExternalStock(
      casa,
      parseExternalStockAdd({ items: [{ name: 'Pollo', section: 'fridge', note: 'para hoy' }] }),
    );

    expect(mockDb.stockPlacement.upsert).toHaveBeenCalledWith({
      where: { groupId_key: { groupId: 1, key: 'pollo' } },
      create: { groupId: 1, key: 'pollo', section: 'FRIDGE' },
      update: { section: 'FRIDGE' },
    });
    expect(result.items[0]).toMatchObject({
      section: 'fridge',
      note: 'para hoy',
      status: 'already',
    });
  });

  it('rejects people outside the group and archived groups before writing', async () => {
    const input = parseExternalStockAdd({ items: [{ name: 'Pan' }], addedBy: 'otro@x.com' });

    expect((await catchError(() => addExternalStock(casa, input))).code).toBe('not_a_member');
    expect((await catchError(() => addExternalStock(archivado, input))).code).toBe(
      'group_archived',
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});

describe('finishExternalStock', () => {
  it('takes it out of the stock and sends it to Compras once', async () => {
    stock = [row('Leche', { section: 'FRIDGE' }), row('Detergente', { section: 'CLEANING' })];
    pending = [{ id: 'shop-1', name: 'Detergente' }];

    const result = await finishExternalStock(
      casa,
      parseExternalStockFinish({ items: ['leche', 'Detergente'], addedBy: 2 }),
    );

    expect(stock).toEqual([]);
    expect(mockDb.shoppingItem.create).toHaveBeenCalledTimes(1);
    expect(mockDb.shoppingItem.create).toHaveBeenCalledWith({
      data: { groupId: 1, name: 'Leche', addedBy: 2, source: 'API' },
    });
    expect(result.items).toMatchObject([
      { name: 'Leche', status: 'finished', addedToShopping: true },
      { name: 'Detergente', status: 'finished', addedToShopping: false },
    ]);
  });

  it('sends to Compras what was not in the stock', async () => {
    const result = await finishExternalStock(casa, parseExternalStockFinish({ items: ['Yerba'] }));

    expect(mockDb.shoppingItem.create).toHaveBeenCalledWith({
      data: { groupId: 1, name: 'Yerba', addedBy: null, source: 'API' },
    });
    expect(result.text).toBe('Yerba no estaba en el Stock; fue a Compras.');
  });

  it('touches nothing on a partial match', async () => {
    stock = [row('Pechugas de pollo', { section: 'FREEZER' })];

    const result = await finishExternalStock(casa, parseExternalStockFinish({ items: ['pollo'] }));

    expect(stock).toHaveLength(1);
    expect(mockDb.shoppingItem.create).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      { name: 'pollo', status: 'candidates', candidates: ['Pechugas de pollo'] },
    ]);
  });
});

describe('one stock item', () => {
  it('treats a non uuid id as not found', async () => {
    expect((await catchError(() => parseStockItemId('leche'))).code).toBe('stock_item_not_found');
    expect(parseStockItemId(ITEM_ID)).toBe(ITEM_ID);
  });

  it('changes the section and remembers it', async () => {
    stock = [row('Pollo', { id: ITEM_ID, section: 'FREEZER' })];

    const item = await updateExternalStockItem(casa, ITEM_ID, { section: 'FRIDGE' });

    expect(item).toMatchObject({ name: 'Pollo', section: 'fridge', sectionLabel: 'Heladera' });
    expect(mockDb.stockPlacement.upsert).toHaveBeenCalled();
  });

  it('answers 404 for another group item and 409 for a taken name', async () => {
    expect(
      (await catchError(() => updateExternalStockItem(casa, ITEM_ID, { section: 'FRIDGE' }))).code,
    ).toBe('stock_item_not_found');

    stock = [row('Pollo', { id: ITEM_ID }), row('Leche')];
    expect(
      (await catchError(() => updateExternalStockItem(casa, ITEM_ID, { name: 'leche' }))).code,
    ).toBe('already_in_stock');
  });

  it('removes without sending to Compras', async () => {
    stock = [row('Pollo', { id: ITEM_ID })];

    const item = await removeExternalStockItem(casa, ITEM_ID);

    expect(item.name).toBe('Pollo');
    expect(stock).toEqual([]);
    expect(mockDb.shoppingItem.create).not.toHaveBeenCalled();
    expect((await catchError(() => removeExternalStockItem(casa, ITEM_ID))).code).toBe(
      'stock_item_not_found',
    );
  });
});
