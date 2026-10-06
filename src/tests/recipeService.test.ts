import { stockKey } from '~/lib/stock';
import {
  RecipeConflictError,
  RecipeInputError,
  addMissingToShopping,
  createRecipe,
  deleteRecipe,
  listRecipes,
  updateRecipe,
} from '~/server/recipes/service';

const ing = (name: string, position = 0) => ({ name, key: stockKey(name), position });

const makeDb = () => ({
  recipe: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  recipeIngredient: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  stockItem: { findMany: jest.fn().mockResolvedValue([]) },
  shoppingItem: {
    findMany: jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

describe('listRecipes', () => {
  it('splits recipes by what is in stock, never counting cleaning', async () => {
    const db = makeDb();
    db.stockItem.findMany.mockResolvedValue([
      { key: stockKey('Pechugas de pollo'), section: 'FREEZER' },
      { key: stockKey('Huevos'), section: 'FRIDGE' },
      { key: stockKey('Pan rallado'), section: 'PANTRY' },
      { key: stockKey('Detergente limón'), section: 'CLEANING' },
    ]);
    db.shoppingItem.findMany.mockResolvedValue([{ id: 's1', name: 'Paltas' }]);
    db.recipe.findMany.mockResolvedValue([
      {
        id: 'r1',
        title: 'Milanesas de pollo',
        kind: 'PROTEIN',
        ingredients: [ing('pollo'), ing('pan rallado', 1), ing('huevo', 2)],
      },
      {
        id: 'r2',
        title: 'Ensalada de palta',
        kind: 'SALAD',
        ingredients: [ing('palta'), ing('tomate', 1)],
      },
      { id: 'r3', title: 'Agua de limón', kind: 'MAIN', ingredients: [ing('limón')] },
    ]);

    const parts = await listRecipes(db as never, { groupId: 1 });

    expect(parts.ready.map((recipe) => recipe.id)).toEqual(['r1']);
    expect(parts.oneMissing).toEqual([
      {
        id: 'r3',
        title: 'Agua de limón',
        kind: 'MAIN',
        missing: [{ name: 'limón', inShopping: false }],
      },
    ]);
    expect(parts.moreMissing[0]?.missing).toEqual([
      { name: 'palta', inShopping: true },
      { name: 'tomate', inShopping: false },
    ]);
  });

  it('filters by kind inside the group', async () => {
    const db = makeDb();
    await listRecipes(db as never, { groupId: 1, kind: 'SALAD' });

    expect(db.recipe.findMany.mock.calls[0][0].where).toEqual({ groupId: 1, kind: 'SALAD' });
  });
});

describe('createRecipe', () => {
  it('inserts without failing on repeated titles and saves the ingredients', async () => {
    const db = makeDb();
    const { id } = await createRecipe(db as never, {
      groupId: 1,
      title: ' Milanesas de pollo ',
      kind: 'PROTEIN',
      yieldText: 'Para 1,8 kg',
      body: '1. Empanar\r\n- 6 huevos',
      ingredients: ['pollo', 'Huevos', 'huevo'],
      createdById: 7,
      source: 'APP',
    });

    const { data, skipDuplicates } = db.recipe.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data[0]).toMatchObject({
      id,
      groupId: 1,
      title: 'Milanesas de pollo',
      titleKey: 'milanesa de pollo',
      kind: 'PROTEIN',
      yieldText: 'Para 1,8 kg',
      body: '1. Empanar\n- 6 huevos',
      source: 'APP',
      createdById: 7,
    });
    expect(db.recipeIngredient.createMany.mock.calls[0][0].data).toEqual([
      { recipeId: id, name: 'pollo', key: 'pollo', position: 0 },
      { recipeId: id, name: 'Huevos', key: 'huevo', position: 1 },
    ]);
  });

  it('says so, before writing, when the title is already in the group', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValue({ id: 'r1' });

    await expect(
      createRecipe(db as never, {
        groupId: 1,
        title: 'Milanesas de pollo',
        kind: 'PROTEIN',
        ingredients: ['pollo'],
        createdById: 7,
        source: 'APP',
      }),
    ).rejects.toBeInstanceOf(RecipeConflictError);
    expect(db.recipe.findFirst.mock.calls[0][0].where).toEqual({
      groupId: 1,
      titleKey: 'milanesa de pollo',
    });
    expect(db.recipe.createMany).not.toHaveBeenCalled();
    expect(db.recipeIngredient.createMany).not.toHaveBeenCalled();
  });

  it('says so when someone else took the title in between', async () => {
    const db = makeDb();
    db.recipe.createMany.mockResolvedValue({ count: 0 });

    await expect(
      createRecipe(db as never, {
        groupId: 1,
        title: 'Solomillo',
        kind: 'PROTEIN',
        ingredients: ['solomillo'],
        createdById: 7,
        source: 'APP',
      }),
    ).rejects.toBeInstanceOf(RecipeConflictError);
    expect(db.recipeIngredient.createMany).not.toHaveBeenCalled();
  });

  it('needs at least one main ingredient and writes nothing without it', async () => {
    const db = makeDb();

    await expect(
      createRecipe(db as never, {
        groupId: 1,
        title: 'Nada',
        kind: 'MAIN',
        ingredients: ['  ', '...'],
        createdById: 7,
        source: 'APP',
      }),
    ).rejects.toBeInstanceOf(RecipeInputError);
    expect(db.recipe.createMany).not.toHaveBeenCalled();
  });

  it('needs a title', async () => {
    await expect(
      createRecipe(makeDb() as never, {
        groupId: 1,
        title: ' - ',
        kind: 'MAIN',
        ingredients: ['pollo'],
        createdById: 7,
        source: 'APP',
      }),
    ).rejects.toBeInstanceOf(RecipeInputError);
  });
});

describe('updateRecipe', () => {
  it('refuses to rename into another recipe of the group', async () => {
    const db = makeDb();
    db.recipe.findFirst
      .mockResolvedValueOnce({ id: 'r1', titleKey: 'solomillo' })
      .mockResolvedValueOnce({ id: 'r2' });

    await expect(
      updateRecipe(db as never, { groupId: 1, id: 'r1', title: 'Milanesas de pollo' }),
    ).rejects.toBeInstanceOf(RecipeConflictError);
    expect(db.recipe.update).not.toHaveBeenCalled();
    expect(db.recipeIngredient.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces the ingredients when they come, writing the title last', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValueOnce({ id: 'r1', titleKey: 'solomillo' });

    expect(
      await updateRecipe(db as never, {
        groupId: 1,
        id: 'r1',
        ingredients: ['solomillo de cerdo'],
      }),
    ).toEqual({ id: 'r1' });
    expect(db.recipe.update.mock.calls[0][0].data.titleKey).toBe('solomillo');
    expect(db.recipeIngredient.deleteMany).toHaveBeenCalledWith({ where: { recipeId: 'r1' } });
    expect(db.recipeIngredient.createMany.mock.calls[0][0].data).toEqual([
      { recipeId: 'r1', name: 'solomillo de cerdo', key: 'solomillo de cerdo', position: 0 },
    ]);
    expect(db.recipeIngredient.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.recipe.update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('leaves the ingredients alone when they do not come', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValueOnce({ id: 'r1', titleKey: 'solomillo' });

    await updateRecipe(db as never, { groupId: 1, id: 'r1', body: 'Cocinar' });

    expect(db.recipeIngredient.deleteMany).not.toHaveBeenCalled();
    expect(db.recipeIngredient.createMany).not.toHaveBeenCalled();
  });

  it('refuses ingredients that end up empty, before writing anything', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValueOnce({ id: 'r1', titleKey: 'solomillo' });

    await expect(
      updateRecipe(db as never, { groupId: 1, id: 'r1', ingredients: ['  ', '...'] }),
    ).rejects.toBeInstanceOf(RecipeInputError);
    expect(db.recipeIngredient.deleteMany).not.toHaveBeenCalled();
    expect(db.recipe.update).not.toHaveBeenCalled();
  });

  it('refuses a title that ends up empty', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValueOnce({ id: 'r1', titleKey: 'solomillo' });

    await expect(
      updateRecipe(db as never, { groupId: 1, id: 'r1', title: ' - ' }),
    ).rejects.toBeInstanceOf(RecipeInputError);
    expect(db.recipe.update).not.toHaveBeenCalled();
  });

  it('only touches recipes of the group', async () => {
    const db = makeDb();

    expect(await updateRecipe(db as never, { groupId: 1, id: 'x', title: 'Otra' })).toBeNull();
    expect(db.recipe.findFirst.mock.calls[0][0].where).toEqual({ id: 'x', groupId: 1 });
  });
});

describe('addMissingToShopping', () => {
  it('adds what is missing and not already pending', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValue({
      ingredients: [ing('pollo'), ing('pan rallado', 1), ing('palta', 2)],
    });
    db.shoppingItem.findMany.mockResolvedValue([{ id: 's1', name: 'Pan rallado' }]);

    const result = await addMissingToShopping(db as never, {
      groupId: 1,
      id: 'r1',
      userId: 7,
      source: 'APP',
    });

    expect(result).toEqual({ added: ['Pollo', 'Palta'], alreadyPending: ['Pan rallado'] });
    expect(db.shoppingItem.createMany.mock.calls[0][0].data).toEqual([
      { groupId: 1, name: 'Pollo', addedBy: 7, source: 'APP' },
      { groupId: 1, name: 'Palta', addedBy: 7, source: 'APP' },
    ]);
  });

  it('writes nothing when everything is already in Compras', async () => {
    const db = makeDb();
    db.recipe.findFirst.mockResolvedValue({ ingredients: [ing('palta')] });
    db.shoppingItem.findMany.mockResolvedValue([{ id: 's1', name: 'Paltas' }]);

    expect(
      await addMissingToShopping(db as never, { groupId: 1, id: 'r1', userId: 7, source: 'APP' }),
    ).toEqual({ added: [], alreadyPending: ['Palta'] });
    expect(db.shoppingItem.createMany).not.toHaveBeenCalled();
  });

  it('answers null for recipes of another group', async () => {
    expect(
      await addMissingToShopping(makeDb() as never, {
        groupId: 1,
        id: 'x',
        userId: 7,
        source: 'APP',
      }),
    ).toBeNull();
  });
});

describe('deleteRecipe', () => {
  it('deletes only inside the group', async () => {
    const db = makeDb();
    db.recipe.deleteMany.mockResolvedValue({ count: 0 });

    expect(await deleteRecipe(db as never, { groupId: 1, id: 'r9' })).toBe(false);
    expect(db.recipe.deleteMany).toHaveBeenCalledWith({ where: { id: 'r9', groupId: 1 } });
  });
});
