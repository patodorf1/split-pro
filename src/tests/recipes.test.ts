import {
  MAX_RECIPE_INGREDIENTS,
  RECIPE_KINDS,
  cleanRecipeIngredients,
  cookingStockKeys,
  groupRecipesByStatus,
  isRecipeKind,
  missingIngredients,
  recipeTitleKey,
  splitIngredientText,
} from '~/lib/recipes';
import { stockKey } from '~/lib/stock';

describe('recipe kinds', () => {
  it('has the four kinds of the filters, in order', () => {
    expect(RECIPE_KINDS).toEqual(['PROTEIN', 'MAIN', 'SALAD', 'SIDE']);
    expect(isRecipeKind('SALAD')).toBe(true);
    expect(isRecipeKind('DESSERT')).toBe(false);
  });
});

describe('recipeTitleKey', () => {
  it('compares titles like products', () => {
    expect(recipeTitleKey('Milanesas de Pollo')).toBe(recipeTitleKey('milanesa de pollo'));
    expect(recipeTitleKey('Tarta de atún')).not.toBe(recipeTitleKey('Tarta de espinaca'));
  });
});

describe('cleanRecipeIngredients', () => {
  it('cleans, drops repeated ones and keeps the order', () => {
    expect(
      cleanRecipeIngredients([' Pollo ', 'pan rallado', 'Huevos', 'huevo', '', '...']),
    ).toEqual([
      { name: 'Pollo', key: 'pollo', position: 0 },
      { name: 'pan rallado', key: 'pan rallado', position: 1 },
      { name: 'Huevos', key: 'huevo', position: 2 },
    ]);
  });

  it('keeps at most twelve', () => {
    const many = Array.from({ length: 15 }, (_, index) => `ingrediente ${index}`);

    expect(cleanRecipeIngredients(many)).toHaveLength(MAX_RECIPE_INGREDIENTS);
  });
});

describe('splitIngredientText', () => {
  it('splits by commas and lines', () => {
    expect(splitIngredientText('pollo, pan rallado\nhuevo, ')).toEqual([
      'pollo',
      'pan rallado',
      'huevo',
    ]);
  });
});

describe('missingIngredients', () => {
  const stock = cookingStockKeys([
    { key: stockKey('Pechugas de pollo'), section: 'FREEZER' },
    { key: stockKey('Pan lactal'), section: 'PANTRY' },
    { key: stockKey('Huevos'), section: 'FRIDGE' },
    { key: stockKey('Detergente limón'), section: 'CLEANING' },
  ]);

  it('counts whole words and never what is in cleaning', () => {
    const ingredients = cleanRecipeIngredients(['pollo', 'pan rallado', 'huevo', 'limón']);

    expect(missingIngredients(ingredients, stock).map((ingredient) => ingredient.name)).toEqual([
      'pan rallado',
      'limón',
    ]);
  });

  it('misses nothing when everything is there', () => {
    expect(missingIngredients(cleanRecipeIngredients(['Huevos', 'pollo']), stock)).toEqual([]);
  });
});

describe('groupRecipesByStatus', () => {
  it('splits in three parts, each one alphabetical', () => {
    const recipe = (title: string, missing: number) => ({
      title,
      missing: Array.from({ length: missing }, () => 'x'),
    });
    const parts = groupRecipesByStatus([
      recipe('Solomillo', 0),
      recipe('Arroz blanco', 0),
      recipe('Ensalada', 1),
      recipe('Guiso', 3),
      recipe('Ñoquis', 2),
      recipe('Boniato', 2),
    ]);

    expect(parts.ready.map((entry) => entry.title)).toEqual(['Arroz blanco', 'Solomillo']);
    expect(parts.oneMissing.map((entry) => entry.title)).toEqual(['Ensalada']);
    expect(parts.moreMissing.map((entry) => entry.title)).toEqual(['Boniato', 'Guiso', 'Ñoquis']);
  });
});
