import {
  MAX_SHOPPING_ITEMS_PER_BATCH,
  MAX_SHOPPING_ITEM_NAME_LENGTH,
  cleanOptionalText,
  cleanShoppingItemName,
  findShoppingItemByName,
  normalizeShoppingItemName,
  parseShoppingItems,
  resolveShoppingUpsertFields,
} from '~/lib/shopping';

describe('cleanShoppingItemName', () => {
  it.each([
    ['  leche  ', 'leche'],
    ['- leche', 'leche'],
    ['* leche', 'leche'],
    ['• leche', 'leche'],
    ['1. leche', 'leche'],
    ['2) leche', 'leche'],
    ['leche   descremada', 'leche descremada'],
    ['leche.', 'leche'],
    ['¿leche?', 'leche'],
    ['Leche La Serenísima', 'Leche La Serenísima'],
  ])('should clean %p into %p', (input, expected) => {
    expect(cleanShoppingItemName(input)).toBe(expected);
  });

  it('should cap the name length', () => {
    expect(cleanShoppingItemName('a'.repeat(200))).toHaveLength(MAX_SHOPPING_ITEM_NAME_LENGTH);
  });
});

describe('normalizeShoppingItemName', () => {
  it.each([
    ['Leche', 'leche'],
    ['LECHE', 'leche'],
    ['  leche ', 'leche'],
    ['Café', 'cafe'],
    ['CAFÉ', 'cafe'],
    ['Ñoquis', 'noquis'],
    ['Jamón crudo', 'jamon crudo'],
    ['Açaí', 'acai'],
  ])('should normalize %p into %p', (input, expected) => {
    expect(normalizeShoppingItemName(input)).toBe(expected);
  });

  it('should treat accent and case variants as the same key', () => {
    expect(normalizeShoppingItemName('Café')).toBe(normalizeShoppingItemName('cafe'));
    expect(normalizeShoppingItemName('  PAPAS  ')).toBe(normalizeShoppingItemName('papas'));
  });

  it('should keep genuinely different names apart', () => {
    expect(normalizeShoppingItemName('leche')).not.toBe(
      normalizeShoppingItemName('leche descremada'),
    );
  });
});

describe('parseShoppingItems', () => {
  it('should return a single item for plain text', () => {
    expect(parseShoppingItems('leche')).toEqual([{ name: 'leche', key: 'leche' }]);
  });

  it('should split on commas', () => {
    expect(parseShoppingItems('leche, pan, huevos').map((i) => i.name)).toEqual([
      'leche',
      'pan',
      'huevos',
    ]);
  });

  it('should split on new lines', () => {
    expect(parseShoppingItems('leche\npan\r\nhuevos').map((i) => i.name)).toEqual([
      'leche',
      'pan',
      'huevos',
    ]);
  });

  it('should split on a mix of commas and new lines', () => {
    expect(parseShoppingItems('leche, pan\nhuevos,queso').map((i) => i.name)).toEqual([
      'leche',
      'pan',
      'huevos',
      'queso',
    ]);
  });

  it('should drop empty chunks and stray separators', () => {
    expect(parseShoppingItems('leche,,  ,\n\n  pan  ,').map((i) => i.name)).toEqual([
      'leche',
      'pan',
    ]);
  });

  it('should strip bullets from a pasted list', () => {
    expect(parseShoppingItems('- leche\n- pan\n1. huevos').map((i) => i.name)).toEqual([
      'leche',
      'pan',
      'huevos',
    ]);
  });

  it('should deduplicate within the same text ignoring case and accents', () => {
    expect(parseShoppingItems('Leche, leche, LECHE, café, CAFE').map((i) => i.name)).toEqual([
      'Leche',
      'café',
    ]);
  });

  it('should return an empty array for whitespace only input', () => {
    expect(parseShoppingItems('   \n , , ')).toEqual([]);
  });

  it('should cap the batch size', () => {
    const text = Array.from(
      { length: MAX_SHOPPING_ITEMS_PER_BATCH + 10 },
      (_, i) => `item ${i}`,
    ).join(',');

    expect(parseShoppingItems(text)).toHaveLength(MAX_SHOPPING_ITEMS_PER_BATCH);
  });
});

describe('findShoppingItemByName', () => {
  const items = [
    { id: '1', name: 'Leche' },
    { id: '2', name: 'Café molido' },
    { id: '3', name: 'Pan' },
  ];

  it.each([
    ['leche', '1'],
    ['LECHE', '1'],
    ['  Leche  ', '1'],
    ['cafe molido', '2'],
    ['CAFÉ MOLIDO', '2'],
  ])('should match %p with item %p', (name, expectedId) => {
    expect(findShoppingItemByName(items, name)?.id).toBe(expectedId);
  });

  it('should not match a different item', () => {
    expect(findShoppingItemByName(items, 'leche descremada')).toBeUndefined();
  });

  it('should not match on empty input', () => {
    expect(findShoppingItemByName(items, '   ')).toBeUndefined();
  });
});

describe('resolveShoppingUpsertFields', () => {
  const loadedByPerson = { name: 'leche', externalId: null, addedBy: 1 };
  const loadedBySync = { name: 'Leche', externalId: 'alexa-1', addedBy: null };

  describe('match by name', () => {
    it('should never rename what a person typed', () => {
      expect(
        resolveShoppingUpsertFields('name', loadedByPerson, { name: 'LECHE' }).name,
      ).toBeUndefined();
    });

    it.each([['LECHE'], ['Leche'], ['  leche  '], ['Leche descremada']])(
      'should leave the name alone when the incoming name is %p',
      (incomingName) => {
        expect(
          resolveShoppingUpsertFields('name', loadedByPerson, { name: incomingName }),
        ).not.toHaveProperty('name');
      },
    );

    it('should not rename even when the existing item came from a sync', () => {
      expect(
        resolveShoppingUpsertFields(
          'name',
          { ...loadedBySync, externalId: null },
          { name: 'LECHE' },
        ).name,
      ).toBeUndefined();
    });

    it('should adopt the incoming externalId when the item has none', () => {
      expect(
        resolveShoppingUpsertFields('name', loadedByPerson, {
          name: 'LECHE',
          externalId: 'alexa-9',
        }),
      ).toEqual({ externalId: 'alexa-9' });
    });

    it('should not overwrite an externalId the item already had', () => {
      expect(
        resolveShoppingUpsertFields(
          'name',
          { ...loadedByPerson, externalId: 'alexa-1' },
          { name: 'LECHE', externalId: 'alexa-9' },
        ),
      ).toEqual({});
    });

    it('should leave everything alone when nothing new comes in', () => {
      expect(resolveShoppingUpsertFields('name', loadedByPerson, { name: 'leche' })).toEqual({});
    });
  });

  describe('match by externalId', () => {
    it('should rename an item the external source owns', () => {
      expect(
        resolveShoppingUpsertFields('externalId', loadedBySync, {
          name: 'Leche descremada',
          externalId: 'alexa-1',
        }),
      ).toEqual({ name: 'Leche descremada' });
    });

    it('should clean the incoming name before renaming', () => {
      expect(
        resolveShoppingUpsertFields('externalId', loadedBySync, {
          name: '-   Leche   entera  ',
          externalId: 'alexa-1',
        }),
      ).toEqual({ name: 'Leche entera' });
    });

    it('should not rename when a person created the item', () => {
      expect(
        resolveShoppingUpsertFields(
          'externalId',
          { name: 'leche', externalId: 'alexa-1', addedBy: 2 },
          { name: 'LECHE', externalId: 'alexa-1' },
        ),
      ).toEqual({});
    });

    it('should not report a rename when the name did not change', () => {
      expect(
        resolveShoppingUpsertFields('externalId', loadedBySync, {
          name: 'Leche',
          externalId: 'alexa-1',
        }),
      ).toEqual({});
    });

    it('should ignore an empty incoming name', () => {
      expect(
        resolveShoppingUpsertFields('externalId', loadedBySync, {
          name: '   ',
          externalId: 'alexa-1',
        }),
      ).toEqual({});
    });
  });
});

describe('cleanOptionalText', () => {
  it.each([
    ['2 kg', '2 kg'],
    ['  2   kg  ', '2 kg'],
    ['', undefined],
    ['   ', undefined],
    [null, undefined],
    [undefined, undefined],
  ])('should clean %p into %p', (input, expected) => {
    expect(cleanOptionalText(input, 40)).toBe(expected);
  });

  it('should truncate to the max length', () => {
    expect(cleanOptionalText('a'.repeat(100), 10)).toHaveLength(10);
  });
});
