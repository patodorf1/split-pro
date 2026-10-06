import addMissingHandler from '~/pages/api/external/groups/[groupId]/recipes/[recipeId]/add-missing';
import recipeHandler from '~/pages/api/external/groups/[groupId]/recipes/[recipeId]/index';
import recipesHandler from '~/pages/api/external/groups/[groupId]/recipes/index';
import { ExternalApiError } from '~/lib/externalExpense';
import {
  addExternalMissingToShopping,
  createExternalRecipe,
  getExternalRecipe,
  listExternalRecipes,
  updateExternalRecipe,
} from '~/server/externalRecipes';
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
// Las rutas solo cablean: la lógica con base se prueba en externalRecipesService.test.ts.
jest.mock('~/server/externalRecipes', () => ({
  ...jest.requireActual('~/server/externalRecipes'),
  addExternalMissingToShopping: jest.fn(),
  createExternalRecipe: jest.fn(),
  getExternalRecipe: jest.fn(),
  listExternalRecipes: jest.fn(),
  updateExternalRecipe: jest.fn(),
}));

const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const pato = { id: 1, name: 'Pato', email: 'patodorf@gmail.com' };

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.group.findUnique.mockResolvedValue({
    id: 1,
    archivedAt: null,
    groupUsers: [{ user: pato }],
  });
});

describe('recipe routes', () => {
  it('lists with kind and q', async () => {
    jest.mocked(listExternalRecipes).mockResolvedValue({ groupId: 1 } as never);

    expect((await call(recipesHandler, 'GET', { groupId: '1', kind: 'salad' })).status).toBe(200);
    expect(jest.mocked(listExternalRecipes).mock.calls[0]?.[1]).toEqual({
      kind: 'SALAD',
      q: null,
    });
    expect((await call(recipesHandler, 'GET', { groupId: '1', kind: 'postre' })).status).toBe(400);
  });

  it('creates with 201, and passes the 409 of a taken title through', async () => {
    jest.mocked(createExternalRecipe).mockResolvedValueOnce({ recipe: { id: RECIPE_ID } } as never);
    const body = { title: 'Pollo al horno', kind: 'main', ingredients: ['pollo'] };

    expect(await call(recipesHandler, 'POST', { groupId: '1' }, body)).toMatchObject({
      status: 201,
      body: { groupId: 1, created: true, recipe: { id: RECIPE_ID } },
    });

    jest
      .mocked(createExternalRecipe)
      .mockRejectedValueOnce(
        new ExternalApiError(409, 'recipe_title_taken', 'Ya hay una', 'Taken', 'title'),
      );
    expect(await call(recipesHandler, 'POST', { groupId: '1' }, body)).toMatchObject({
      status: 409,
      body: { code: 'recipe_title_taken', field: 'title' },
    });
  });

  it('reads and patches one recipe by id', async () => {
    jest.mocked(getExternalRecipe).mockResolvedValue({ id: RECIPE_ID } as never);
    jest.mocked(updateExternalRecipe).mockResolvedValue({ recipe: { id: RECIPE_ID } } as never);

    expect(await call(recipeHandler, 'GET', { groupId: '1', recipeId: RECIPE_ID })).toMatchObject({
      status: 200,
      body: { groupId: 1, recipe: { id: RECIPE_ID } },
    });
    expect(
      (await call(recipeHandler, 'PATCH', { groupId: '1', recipeId: RECIPE_ID }, { kind: 'side' }))
        .status,
    ).toBe(200);
    expect(jest.mocked(updateExternalRecipe).mock.calls[0]?.slice(1)).toEqual([
      RECIPE_ID,
      { kind: 'SIDE' },
    ]);
    expect(
      (await call(recipeHandler, 'GET', { groupId: '1', recipeId: 'milanesas' })).body.code,
    ).toBe('recipe_not_found');
    expect(
      (await call(recipeHandler, 'DELETE', { groupId: '1', recipeId: RECIPE_ID })).status,
    ).toBe(405);
  });

  it('adds the missing ones with an empty body', async () => {
    jest.mocked(addExternalMissingToShopping).mockResolvedValue({ added: [] } as never);

    expect(
      (await call(addMissingHandler, 'POST', { groupId: '1', recipeId: RECIPE_ID })).status,
    ).toBe(200);
    expect(jest.mocked(addExternalMissingToShopping).mock.calls[0]?.slice(1)).toEqual([
      RECIPE_ID,
      {},
    ]);
  });
});
