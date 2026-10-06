import { ExternalApiError } from '~/lib/externalExpense';
import {
  addMissingText,
  parseExternalAddMissing,
  parseExternalRecipeCreate,
  parseExternalRecipePatch,
  parseExternalRecipeQuery,
  recipeSavedText,
  recipeText,
  recipeTitleMatches,
  recipesListText,
} from '~/lib/externalRecipes';

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

describe('recipe bodies', () => {
  it('cleans the title and takes the kind in any case', () => {
    expect(
      parseExternalRecipeCreate({
        title: '  Pollo   al horno ',
        kind: 'Main',
        ingredients: ['pollo', 'papa'],
        yield: 'Para 4',
        createdBy: 'patodorf@gmail.com',
      }),
    ).toEqual({
      title: 'Pollo al horno',
      kind: 'MAIN',
      ingredients: ['pollo', 'papa'],
      yield: 'Para 4',
      createdBy: 'patodorf@gmail.com',
    });
  });

  it('rejects a missing kind, more than twelve ingredients and unknown fields', async () => {
    expect(
      (await catchError(() => parseExternalRecipeCreate({ title: 'X', ingredients: ['a'] }))).field,
    ).toBe('kind');
    const many = Array.from({ length: 13 }, (_, i) => `ingrediente ${i}`);
    expect(
      (
        await catchError(() =>
          parseExternalRecipeCreate({ title: 'X', kind: 'side', ingredients: many }),
        )
      ).field,
    ).toBe('ingredients');
    expect(
      (
        await catchError(() =>
          parseExternalRecipeCreate({ title: 'X', kind: 'side', ingredients: ['a'], tipo: 'x' }),
        )
      ).code,
    ).toBe('validation_error');
  });

  it('takes a title of 80 characters and rejects a longer one instead of cutting it', async () => {
    const base = { kind: 'side', ingredients: ['a'] };

    expect(parseExternalRecipeCreate({ ...base, title: 'a'.repeat(80) }).title).toHaveLength(80);

    const error = await catchError(() =>
      parseExternalRecipeCreate({ ...base, title: 'a'.repeat(81) }),
    );

    expect(error.field).toBe('title');
    expect(error.code).toBe('validation_error');
    expect(
      (await catchError(() => parseExternalRecipePatch({ title: 'a'.repeat(81) }))).field,
    ).toBe('title');
  });

  it('patches only what comes and rejects an empty patch', async () => {
    expect(parseExternalRecipePatch({ kind: 'side' })).toEqual({ kind: 'SIDE' });
    expect((await catchError(() => parseExternalRecipePatch({}))).code).toBe('validation_error');
  });

  it('takes an empty body to add the missing ones', () => {
    expect(parseExternalAddMissing(undefined)).toEqual({});
    expect(parseExternalAddMissing('')).toEqual({});
    expect(parseExternalAddMissing({ addedBy: 2 })).toEqual({ addedBy: 2 });
  });

  it('reads kind and q from the query', async () => {
    expect(parseExternalRecipeQuery({ kind: 'Salad', q: ' milanesas ' })).toEqual({
      kind: 'SALAD',
      q: 'milanesas',
    });
    expect(parseExternalRecipeQuery({})).toEqual({ kind: undefined, q: null });
    expect((await catchError(() => parseExternalRecipeQuery({ kind: 'postre' }))).field).toBe(
      'kind',
    );
  });

  it('finds titles by whole words, plural or not', () => {
    expect(recipeTitleMatches('Milanesas de pollo', 'milanesa')).toBe(true);
    expect(recipeTitleMatches('Milanesas de pollo', 'mila')).toBe(false);
  });
});

describe('recipe texts', () => {
  it('answers what can be cooked', () => {
    expect(
      recipesListText({
        ready: [{ title: 'Solomillo', missing: [] }],
        oneMissing: [
          { title: 'Milanesas de carne', missing: [{ name: 'carne', inShopping: false }] },
          { title: 'Ensalada de palta', missing: [{ name: 'palta', inShopping: true }] },
        ],
        moreMissing: [{ title: 'Guiso', missing: [] }],
      }),
    ).toBe(
      'Podés hacer: Solomillo.\nTe falta una cosa: Milanesas de carne (carne); Ensalada de palta (palta, ya en Compras).\nA 1 más les faltan dos cosas o más.',
    );
    expect(recipesListText({ ready: [], oneMissing: [], moreMissing: [] })).toBe(
      'No hay recetas que coincidan.',
    );
  });

  it('sends the whole recipe', () => {
    expect(
      recipeText({
        title: 'Milanesas de pollo',
        yieldText: 'Para 1,8 kg',
        ingredients: [{ name: 'pollo' }, { name: 'huevo' }],
        missing: [],
        body: '1. Rebozar\n',
      }),
    ).toBe(
      'Milanesas de pollo\nPara 1,8 kg\nPrincipales: pollo, huevo.\nTenés todo para hacerla.\n\n1. Rebozar',
    );
  });

  it('says what it saved and what went to Compras', () => {
    expect(
      recipeSavedText({ title: 'Pollo al horno', kind: 'MAIN', ingredients: [{ name: 'pollo' }] }),
    ).toBe('Guardé "Pollo al horno" como Platos, con: pollo.');
    expect(addMissingText({ added: ['Carne'], alreadyPending: ['Huevo', 'Pan'] })).toBe(
      'Sumé a Compras: Carne. Ya estaban en Compras: Huevo, Pan.',
    );
    expect(addMissingText({ added: [], alreadyPending: [] })).toBe(
      'No falta nada: tenés todo para hacerla.',
    );
  });
});
