import {
  DEFAULT_SHOPPING_STORE,
  SHOPPING_STORES,
  groupByShoppingStore,
  guessShoppingStore,
  isShoppingStore,
  learnedShoppingStores,
} from '~/lib/shoppingStores';

describe('guessShoppingStore', () => {
  it('sends fruit and vegetables to the greengrocer', () => {
    expect(guessShoppingStore('Tomates')).toBe('VERDULERIA');
    expect(guessShoppingStore('Palta')).toBe('VERDULERIA');
    expect(guessShoppingStore('bananas')).toBe('VERDULERIA');
  });

  it('sends meat, chicken and fish to the butcher', () => {
    expect(guessShoppingStore('Carne picada')).toBe('CARNICERIA');
    expect(guessShoppingStore('Milanesas')).toBe('CARNICERIA');
    expect(guessShoppingStore('pechuga de pollo')).toBe('CARNICERIA');
    expect(guessShoppingStore('Merluza')).toBe('CARNICERIA');
  });

  it('keeps pantry products with a meat or vegetable word in the grocery store', () => {
    expect(guessShoppingStore('Caldo de pollo')).toBe('ALMACEN');
    expect(guessShoppingStore('Puré de tomate')).toBe('ALMACEN');
    expect(guessShoppingStore('Papas fritas')).toBe('ALMACEN');
    expect(guessShoppingStore('Ajo en polvo')).toBe('ALMACEN');
  });

  it('falls back to the grocery store for anything unknown', () => {
    expect(guessShoppingStore('Leche')).toBe('ALMACEN');
    expect(guessShoppingStore('Pilas AA')).toBe(DEFAULT_SHOPPING_STORE);
  });

  it('prefers what someone chose by hand for the same name', () => {
    const learned = learnedShoppingStores([{ name: 'Huevos', store: 'VERDULERIA' }]);

    expect(guessShoppingStore('huevo', learned)).toBe('VERDULERIA');
  });
});

describe('groupByShoppingStore', () => {
  it('groups in screen order, skips empty stores and sorts each store by name', () => {
    const items = [
      { name: 'Asado', store: null },
      { name: 'Pan', store: null },
      { name: 'Yerba', store: 'VERDULERIA' as const },
      { name: 'Lechuga', store: null },
      { name: 'leche', store: null },
      { name: 'Ácido cítrico', store: null },
    ];

    expect(
      groupByShoppingStore(items).map(({ store, items: group }) => [
        store,
        group.map((item) => item.name),
      ]),
    ).toEqual([
      ['VERDULERIA', ['Lechuga', 'Yerba']],
      ['ALMACEN', ['Ácido cítrico', 'leche', 'Pan']],
      ['CARNICERIA', ['Asado']],
    ]);
  });
});

describe('isShoppingStore', () => {
  it('accepts only known stores', () => {
    expect(SHOPPING_STORES.every(isShoppingStore)).toBe(true);
    expect(isShoppingStore('FARMACIA')).toBe(false);
  });
});
