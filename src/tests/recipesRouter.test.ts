import { stockKey } from '~/lib/stock';
import { recipesRouter } from '~/server/api/routers/recipes';

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

const RECIPE_ID = '11111111-1111-4111-8111-111111111111';

const ing = (name: string, position = 0) => ({ name, key: stockKey(name), position });

const makeDb = (member = true) => {
  const db = {
    groupUser: { findFirst: jest.fn().mockResolvedValue(member ? { groupId: 1 } : null) },
    recipe: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    recipeIngredient: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    stockItem: { findMany: jest.fn().mockResolvedValue([]) },
    shoppingItem: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  };

  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));

  return db;
};

const callerFor = (db: ReturnType<typeof makeDb>) =>
  recipesRouter.createCaller({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sesión mínima de prueba
    session: { user: { id: 7 }, expires: '' } as never,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- base falsa de prueba
    db: db as never,
  });

describe('recipes router', () => {
  it('lists the recipes in the three parts', async () => {
    const db = makeDb();
    db.recipe.findMany.mockResolvedValue([
      { id: 'r1', title: 'Arroz blanco', kind: 'SIDE', ingredients: [ing('arroz')] },
      {
        id: 'r2',
        title: 'Milanesas de carne',
        kind: 'PROTEIN',
        ingredients: [ing('carne'), ing('pan rallado', 1), ing('huevo', 2)],
      },
    ]);
    db.stockItem.findMany.mockResolvedValue([
      { key: stockKey('Arroz'), section: 'PANTRY' },
      { key: stockKey('Pan rallado'), section: 'PANTRY' },
      { key: stockKey('Huevos'), section: 'FRIDGE' },
    ]);

    const result = await callerFor(db).list({ groupId: 1 });

    expect(result.ready.map((recipe) => recipe.id)).toEqual(['r1']);
    expect(result.oneMissing[0]).toMatchObject({
      id: 'r2',
      missing: [{ name: 'carne', inShopping: false }],
    });
    expect(result.moreMissing).toEqual([]);
  });

  it('rejects people outside the group', async () => {
    await expect(callerFor(makeDb(false)).list({ groupId: 1 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('gets one recipe with what is missing today', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValue({
      id: RECIPE_ID,
      title: 'Solomillo',
      kind: 'PROTEIN',
      yieldText: null,
      body: 'Sellar.',
      ingredients: [ing('solomillo')],
    });

    const recipe = await callerFor(db).get({ groupId: 1, id: RECIPE_ID });

    expect(recipe).toMatchObject({
      id: RECIPE_ID,
      body: 'Sellar.',
      missing: [{ name: 'solomillo', inShopping: false }],
    });
  });

  it('creates recipes as the person, from the app', async () => {
    const db = makeDb();
    const { id } = await callerFor(db).create({
      groupId: 1,
      title: 'Solomillo',
      kind: 'PROTEIN',
      ingredients: ['solomillo'],
    });

    expect(db.recipe.createMany.mock.calls[0][0].data[0]).toMatchObject({
      id,
      groupId: 1,
      createdById: 7,
      source: 'APP',
    });
  });

  it('answers bad request for a recipe without ingredients', async () => {
    const db = makeDb();

    await expect(
      callerFor(db).create({ groupId: 1, title: 'Solomillo', kind: 'PROTEIN', ingredients: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Ingredientes que quedan vacíos al limpiarlos: lo frena el servicio, no la validación.
    await expect(
      callerFor(db).create({ groupId: 1, title: 'Solomillo', kind: 'PROTEIN', ingredients: [' '] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.recipe.createMany).not.toHaveBeenCalled();
  });

  it('answers conflict for a repeated title', async () => {
    const db = makeDb();
    db.recipe.createMany.mockResolvedValue({ count: 0 });

    await expect(
      callerFor(db).create({
        groupId: 1,
        title: 'Solomillo',
        kind: 'PROTEIN',
        ingredients: ['solomillo'],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'recipe_title_taken' });
  });

  it('answers conflict when renaming to a title that already exists', async () => {
    const db = makeDb();
    db.recipe.findFirst
      .mockResolvedValueOnce({ id: RECIPE_ID, titleKey: 'solomillo' })
      .mockResolvedValueOnce({ id: 'other' });

    await expect(
      callerFor(db).update({ groupId: 1, id: RECIPE_ID, title: 'Milanesas' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'recipe_title_taken' });
    expect(db.recipe.update).not.toHaveBeenCalled();
  });

  it('answers conflict when two phones rename at once (unique violation)', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValueOnce({ id: RECIPE_ID, titleKey: 'solomillo' });
    db.recipe.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(
      callerFor(db).update({ groupId: 1, id: RECIPE_ID, title: 'Milanesas' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'recipe_title_taken' });
  });

  it('answers not found when updating a recipe that is not there', async () => {
    const db = makeDb();

    await expect(
      callerFor(db).update({ groupId: 1, id: RECIPE_ID, title: 'Milanesas' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers not found when the recipe vanishes mid-update (P2025)', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValueOnce({ id: RECIPE_ID, titleKey: 'solomillo' });
    db.recipe.update.mockRejectedValue(Object.assign(new Error('gone'), { code: 'P2025' }));

    await expect(
      callerFor(db).update({ groupId: 1, id: RECIPE_ID, kind: 'SIDE' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers not found for recipes of another group', async () => {
    const db = makeDb();

    await expect(callerFor(db).get({ groupId: 1, id: RECIPE_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      callerFor(db).addMissingToShopping({ groupId: 1, id: RECIPE_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(db).remove({ groupId: 1, id: RECIPE_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.recipe.findFirst.mock.calls[0][0].where).toEqual({ id: RECIPE_ID, groupId: 1 });
  });
});
