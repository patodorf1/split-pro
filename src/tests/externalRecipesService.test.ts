import { ExternalApiError } from '~/lib/externalExpense';
import { parseExternalRecipeCreate } from '~/lib/externalRecipes';
import { stockKey } from '~/lib/stock';
import type { LoadedGroup } from '~/server/externalExpenses';
import {
  addExternalMissingToShopping,
  createExternalRecipe,
  getExternalRecipe,
  listExternalRecipes,
  parseRecipeId,
  updateExternalRecipe,
} from '~/server/externalRecipes';

const mockDb = {
  recipe: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
  },
  recipeIngredient: { createMany: jest.fn(), deleteMany: jest.fn() },
  stockItem: { findMany: jest.fn() },
  shoppingItem: { findMany: jest.fn(), createMany: jest.fn() },
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

const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-06T12:00:00Z');

const ing = (name: string, position = 0) => ({ name, key: stockKey(name), position });

const recipeRow = (overrides: Record<string, unknown> = {}) => ({
  id: RECIPE_ID,
  title: 'Milanesas de pollo',
  kind: 'PROTEIN',
  yieldText: 'Para 1,8 kg',
  body: '1. Rebozar\n- 3 huevos\nTip: pan rallado fino',
  source: 'IMPORT',
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: null,
  ingredients: [ing('pollo'), ing('pan rallado', 1), ing('huevo', 2)],
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
  throw new Error('No lanzó error');
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.recipe.findMany.mockResolvedValue([]);
  mockDb.recipe.findFirst.mockResolvedValue(null);
  mockDb.recipe.createMany.mockResolvedValue({ count: 1 });
  mockDb.recipe.update.mockResolvedValue({});
  mockDb.recipeIngredient.createMany.mockResolvedValue({ count: 1 });
  mockDb.recipeIngredient.deleteMany.mockResolvedValue({ count: 1 });
  mockDb.stockItem.findMany.mockResolvedValue([
    { key: stockKey('Pechugas de pollo'), section: 'FREEZER' },
    { key: stockKey('Huevos'), section: 'FRIDGE' },
  ]);
  mockDb.shoppingItem.findMany.mockResolvedValue([]);
  mockDb.shoppingItem.createMany.mockResolvedValue({ count: 1 });
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe('listExternalRecipes', () => {
  it('lists by status, filtering by kind and by title', async () => {
    mockDb.recipe.findMany.mockResolvedValue([
      {
        id: 'r1',
        title: 'Milanesas de pollo',
        kind: 'PROTEIN',
        ingredients: [ing('pollo'), ing('huevo', 1)],
      },
      { id: 'r2', title: 'Milanesas de carne', kind: 'PROTEIN', ingredients: [ing('carne')] },
      { id: 'r3', title: 'Solomillo', kind: 'PROTEIN', ingredients: [ing('solomillo')] },
    ]);

    const result = await listExternalRecipes(casa, { kind: 'PROTEIN', q: 'milanesas' });

    expect(mockDb.recipe.findMany.mock.calls[0][0].where).toEqual({ groupId: 1, kind: 'PROTEIN' });
    expect(result).toEqual({
      groupId: 1,
      kind: 'protein',
      q: 'milanesas',
      ready: [
        {
          id: 'r1',
          title: 'Milanesas de pollo',
          kind: 'protein',
          kindLabel: 'Proteínas',
          missing: [],
        },
      ],
      oneMissing: [
        {
          id: 'r2',
          title: 'Milanesas de carne',
          kind: 'protein',
          kindLabel: 'Proteínas',
          missing: [{ name: 'carne', inShopping: false }],
        },
      ],
      moreMissing: [],
      text: 'Podés hacer: Milanesas de pollo.\nTe falta una cosa: Milanesas de carne (carne).',
    });
  });
});

describe('one recipe', () => {
  it('treats a non uuid id as not found', async () => {
    expect((await catchError(() => parseRecipeId('milanesas'))).code).toBe('recipe_not_found');
  });

  it('reads it with its steps and what is missing today', async () => {
    mockDb.recipe.findFirst.mockResolvedValue(recipeRow());

    const recipe = await getExternalRecipe(casa, RECIPE_ID);

    expect(mockDb.recipe.findFirst.mock.calls[0][0].where).toEqual({ id: RECIPE_ID, groupId: 1 });
    expect(recipe).toMatchObject({
      title: 'Milanesas de pollo',
      kind: 'protein',
      kindLabel: 'Proteínas',
      yield: 'Para 1,8 kg',
      ingredients: ['pollo', 'pan rallado', 'huevo'],
      missing: [{ name: 'pan rallado', inShopping: false }],
      source: 'import',
      steps: [
        {
          number: 1,
          title: 'Rebozar',
          blocks: [
            { type: 'list', items: ['3 huevos'] },
            { type: 'tip', text: 'pan rallado fino' },
          ],
        },
      ],
    });
    expect(recipe.text).toContain('Te falta: pan rallado.');
  });

  it('answers 404 for another group recipe', async () => {
    expect((await catchError(() => getExternalRecipe(casa, RECIPE_ID))).code).toBe(
      'recipe_not_found',
    );
  });
});

describe('createExternalRecipe', () => {
  const input = parseExternalRecipeCreate({
    title: 'Pollo al horno',
    kind: 'main',
    ingredients: ['pollo', 'papa'],
    body: '1. Hornear',
    createdBy: 'patodorf@gmail.com',
  });

  it('saves it as made by Charly and answers what it saved', async () => {
    // Primero el chequeo del título (libre) y después la lectura de la receta guardada.
    mockDb.recipe.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(
      recipeRow({
        title: 'Pollo al horno',
        kind: 'MAIN',
        yieldText: null,
        body: '1. Hornear',
        source: 'API',
        createdBy: { id: 1, name: 'Pato' },
        ingredients: [ing('pollo'), ing('papa', 1)],
      }),
    );

    const result = await createExternalRecipe(casa, input);

    expect(mockDb.recipe.createMany.mock.calls[0][0].data[0]).toMatchObject({
      groupId: 1,
      title: 'Pollo al horno',
      titleKey: 'pollo al horno',
      kind: 'MAIN',
      source: 'API',
      createdById: 1,
    });
    expect(result.recipe).toMatchObject({
      kind: 'main',
      missing: [{ name: 'papa', inShopping: false }],
    });
    expect(result.text).toBe('Guardé "Pollo al horno" como Platos, con: pollo, papa.');
  });

  it('answers 409 when the title is taken', async () => {
    mockDb.recipe.findFirst.mockResolvedValue({ id: 'other' });

    expect((await catchError(() => createExternalRecipe(casa, input))).code).toBe(
      'recipe_title_taken',
    );
    expect(mockDb.recipe.createMany).not.toHaveBeenCalled();
  });

  it('rejects an author outside the group and archived groups', async () => {
    expect(
      (await catchError(() => createExternalRecipe(casa, { ...input, createdBy: 'otro@x.com' })))
        .field,
    ).toBe('createdBy');
    expect((await catchError(() => createExternalRecipe(archivado, input))).code).toBe(
      'group_archived',
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});

describe('updateExternalRecipe', () => {
  it('changes only what comes', async () => {
    mockDb.recipe.findFirst
      .mockResolvedValueOnce({ id: RECIPE_ID, titleKey: 'milanesa de pollo' })
      .mockResolvedValueOnce(recipeRow({ kind: 'MAIN' }));

    const result = await updateExternalRecipe(casa, RECIPE_ID, { kind: 'MAIN' });

    expect(mockDb.recipe.update.mock.calls[0][0].data).toMatchObject({ kind: 'MAIN' });
    expect(mockDb.recipeIngredient.deleteMany).not.toHaveBeenCalled();
    expect(result.text).toBe(
      'Guardé "Milanesas de pollo" como Platos, con: pollo, pan rallado, huevo.',
    );
  });

  it('answers 404 when it is not in the group', async () => {
    expect(
      (await catchError(() => updateExternalRecipe(casa, RECIPE_ID, { kind: 'MAIN' }))).code,
    ).toBe('recipe_not_found');
  });
});

describe('addExternalMissingToShopping', () => {
  it('adds what is missing as made by Charly, without repeating what is pending', async () => {
    mockDb.recipe.findFirst.mockResolvedValue({
      ingredients: [ing('pollo'), ing('pan rallado', 1), ing('limón', 2)],
    });
    mockDb.shoppingItem.findMany.mockResolvedValue([{ id: 's1', name: 'Limones' }]);

    const result = await addExternalMissingToShopping(casa, RECIPE_ID, { addedBy: 2 });

    expect(mockDb.shoppingItem.createMany).toHaveBeenCalledWith({
      data: [{ groupId: 1, name: 'Pan rallado', addedBy: 2, source: 'API' }],
    });
    expect(result).toEqual({
      groupId: 1,
      recipeId: RECIPE_ID,
      added: ['Pan rallado'],
      alreadyPending: ['Limón'],
      text: 'Sumé a Compras: Pan rallado. Ya estaba en Compras: Limón.',
    });
  });

  it('answers 404 when it is not in the group', async () => {
    expect((await catchError(() => addExternalMissingToShopping(casa, RECIPE_ID, {}))).code).toBe(
      'recipe_not_found',
    );
  });
});
