import { ExternalApiError } from '~/lib/externalExpense';
import {
  MAX_EXTERNAL_STOCK_BATCH,
  groupStockBySection,
  parseExternalStockAdd,
  parseExternalStockFinish,
  parseExternalStockPatch,
  parseExternalStockQuery,
  stockAddText,
  stockFinishText,
  stockListText,
} from '~/lib/externalStock';
import { matchStockName, stockItemsMatching, stockKey } from '~/lib/stock';

const product = (name: string) => ({ name, key: stockKey(name) });

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

describe('matching names against the stock', () => {
  const items = ['Pechugas de pollo', 'Caldo de pollo', 'Tomate', 'Arroz'].map(product);

  it('prefers the same name, plural or not', () => {
    expect(matchStockName(items, 'tomates')).toEqual({ exact: items[2], candidates: [] });
  });

  it('never picks a partial match: it returns the candidates', () => {
    expect(matchStockName(items, 'pollo')).toEqual({
      exact: undefined,
      candidates: [items[0], items[1]],
    });
    expect(matchStockName(items, 'leche')).toEqual({ exact: undefined, candidates: [] });
  });

  it('searches by whole words', () => {
    expect(stockItemsMatching(items, 'arroz').map((item) => item.name)).toEqual(['Arroz']);
    expect(stockItemsMatching(items, 'arr')).toEqual([]);
  });
});

describe('stock bodies', () => {
  it('cleans names, takes sections in any case and drops repeated names', () => {
    expect(
      parseExternalStockAdd({
        items: [
          { name: ' - Tomates ' },
          { name: 'tomate' },
          { name: 'Pollo', section: 'Fridge', note: 'dos pechugas' },
        ],
        addedBy: 'patodorf@gmail.com',
      }),
    ).toEqual({
      items: [
        { name: 'Tomates', key: 'tomate' },
        { name: 'Pollo', key: 'pollo', section: 'FRIDGE', note: 'dos pechugas' },
      ],
      addedBy: 'patodorf@gmail.com',
    });
  });

  it('rejects empty names, unknown sections, unknown fields and big batches', async () => {
    expect(
      (await catchError(() => parseExternalStockAdd({ items: [{ name: '...' }] }))).field,
    ).toBe('items.0.name');
    expect(
      (
        await catchError(() =>
          parseExternalStockAdd({ items: [{ name: 'Pan', section: 'sotano' }] }),
        )
      ).field,
    ).toBe('items.0.section');
    expect(
      (await catchError(() => parseExternalStockAdd({ items: [{ name: 'Pan' }], quien: 'Pato' })))
        .code,
    ).toBe('validation_error');
    const many = Array.from({ length: MAX_EXTERNAL_STOCK_BATCH + 1 }, (_, i) => ({
      name: `x${i}`,
    }));
    expect((await catchError(() => parseExternalStockAdd({ items: many }))).field).toBe('items');
  });

  it('finishes names without repeating them', () => {
    expect(parseExternalStockFinish({ items: ['Leche', 'leches', 'Detergente'] })).toEqual({
      items: ['Leche', 'Detergente'],
      addedBy: undefined,
    });
  });

  it('patches only what comes and rejects an empty patch', async () => {
    expect(parseExternalStockPatch({ section: 'freezer' })).toEqual({ section: 'FREEZER' });
    expect(parseExternalStockPatch({ note: null })).toEqual({ note: null });
    expect((await catchError(() => parseExternalStockPatch({}))).code).toBe('validation_error');
  });

  it('reads q from the query', () => {
    expect(parseExternalStockQuery({ q: ' arroz ' })).toEqual({ q: 'arroz' });
    expect(parseExternalStockQuery({ q: '  ' })).toEqual({ q: null });
    expect(parseExternalStockQuery({})).toEqual({ q: null });
  });
});

describe('stock texts', () => {
  const sections = groupStockBySection([
    { name: 'Leche', note: null, section: 'FRIDGE' as const },
    { name: 'Arroz', note: 'medio paquete', section: 'PANTRY' as const },
    { name: 'Huevos', note: null, section: 'FRIDGE' as const },
    { name: 'Detergente', note: null, section: 'CLEANING' as const },
  ]);

  it('groups in the app order, alphabetical inside each section, without empty ones', () => {
    expect(sections.map((section) => section.label)).toEqual(['Heladera', 'Alacena', 'Limpieza']);
    expect(sections[0]?.items.map((item) => item.name)).toEqual(['Huevos', 'Leche']);
  });

  it('answers what there is, one line per section', () => {
    expect(stockListText(sections, null)).toBe(
      'Heladera: Huevos, Leche.\nAlacena: Arroz (medio paquete).\nLimpieza: Detergente.',
    );
    expect(stockListText([], null)).toBe('El Stock está vacío.');
    expect(stockListText(sections.slice(1, 2), 'arroz')).toBe('Hay: Arroz (Alacena).');
    expect(stockListText([], 'arroz')).toBe('No hay "arroz" en el Stock.');
  });

  it('answers an add in one line', () => {
    expect(
      stockAddText([
        { name: 'Pollo', section: 'FREEZER', status: 'added', fromShopping: false },
        { name: 'Tomates', section: 'PRODUCE', status: 'added', fromShopping: true },
        { name: 'Leche', section: 'FRIDGE', status: 'already', fromShopping: false },
      ]),
    ).toBe(
      'Sumé al Stock: Pollo (Freezer), Tomates (Frutas y verduras). Ya estaba: Leche (Heladera). Tildé en Compras: Tomates.',
    );
  });

  it('answers a finish, including the doubtful ones', () => {
    expect(
      stockFinishText([
        { name: 'Leche', status: 'finished', addedToShopping: true },
        { name: 'Yerba', status: 'not_in_stock', addedToShopping: false },
        {
          name: 'pollo',
          status: 'candidates',
          candidates: ['Pechugas de pollo', 'Caldo de pollo'],
        },
      ]),
    ).toBe(
      'Leche salió del Stock y fue a Compras. Yerba no estaba en el Stock y ya estaba en Compras. "pollo": en el Stock hay Pechugas de pollo, Caldo de pollo. No saqué nada.',
    );
  });
});
