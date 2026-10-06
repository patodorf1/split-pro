import {
  DEFAULT_STOCK_SECTION,
  STOCK_SECTIONS,
  containsWords,
  guessStockSection,
  isStockSection,
  stockKey,
} from '~/lib/stock';

describe('stockKey', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(stockKey('  Leche  ')).toBe('leche');
    expect(stockKey('ATÚN')).toBe('atun');
  });

  it('treats simple plurals as the same product', () => {
    expect(stockKey('Tomates')).toBe(stockKey('tomate'));
    expect(stockKey('Huevos')).toBe(stockKey('huevo'));
    expect(stockKey('Limones')).toBe(stockKey('limón'));
    expect(stockKey('Panes')).toBe(stockKey('pan'));
    expect(stockKey('Nueces')).toBe(stockKey('nuez'));
    expect(stockKey('Papas fritas')).toBe(stockKey('papa frita'));
  });

  it('gives singular and plural words ending in -e the same key', () => {
    expect(stockKey('Carnes')).toBe(stockKey('carne'));
    expect(stockKey('Postres')).toBe(stockKey('postre'));
    expect(stockKey('Dulces')).toBe(stockKey('dulce'));
    expect(stockKey('Dulces de leche')).toBe(stockKey('dulce de leche'));
    expect(stockKey('Panes')).toBe(stockKey('pan'));
    expect(stockKey('Limones')).toBe(stockKey('limón'));
    expect(stockKey('Nueces')).toBe(stockKey('nuez'));
    expect(stockKey('Flores')).toBe(stockKey('flor'));
  });

  it('keeps short words and different products apart', () => {
    expect(stockKey('gas')).toBe('gas');
    expect(stockKey('leche descremada')).not.toBe(stockKey('leche'));
  });
});

describe('containsWords', () => {
  it('matches whole words only', () => {
    expect(containsWords(stockKey('Pechugas de pollo'), stockKey('pollo'))).toBe(true);
    expect(containsWords(stockKey('Pan lactal'), stockKey('pan rallado'))).toBe(false);
    expect(containsWords(stockKey('Panceta'), stockKey('pan'))).toBe(false);
  });
});

describe('guessStockSection', () => {
  it('uses the built-in list', () => {
    expect(guessStockSection('Leche')).toBe('FRIDGE');
    expect(guessStockSection('Pechugas de pollo')).toBe('FREEZER');
    expect(guessStockSection('Arroz')).toBe('PANTRY');
    expect(guessStockSection('Tomates')).toBe('PRODUCE');
    expect(guessStockSection('Lavandina')).toBe('CLEANING');
    expect(guessStockSection('Carnes')).toBe('FREEZER');
    expect(guessStockSection('Postres')).toBe('FRIDGE');
    expect(guessStockSection('Dulces de leche')).toBe('FRIDGE');
  });

  it('breaks ties by the earliest match, since the main noun comes first', () => {
    expect(guessStockSection('Caldo de pollo')).toBe('PANTRY');
    expect(guessStockSection('Puré de papas')).toBe('PANTRY');
    expect(guessStockSection('Pollo con caldo')).toBe('FREEZER');
  });

  it('prefers the longest match', () => {
    expect(guessStockSection('Leche de coco')).toBe('PANTRY');
    expect(guessStockSection('Tomate triturado')).toBe('PANTRY');
    expect(guessStockSection('Papas fritas congeladas')).toBe('FREEZER');
  });

  it('prefers what the group taught it', () => {
    const learned = new Map([[stockKey('pollo'), 'FRIDGE' as const]]);
    expect(guessStockSection('Pollo', learned)).toBe('FRIDGE');
  });

  it('falls back to the pantry', () => {
    expect(guessStockSection('Cosa rarísima')).toBe(DEFAULT_STOCK_SECTION);
  });
});

describe('sections', () => {
  it('keeps cleaning last', () => {
    expect(STOCK_SECTIONS.at(-1)).toBe('CLEANING');
    expect(isStockSection('FRIDGE')).toBe(true);
    expect(isStockSection('BATHROOM')).toBe(false);
  });
});
