import { BRANDS, findBrand, normalizeBrandText } from '~/lib/brands';

const brandOf = (name: string) => findBrand(name)?.id ?? null;

describe('normalizeBrandText', () => {
  it('should lowercase, drop accents and keep only words', () => {
    expect(normalizeBrandText('  Nafta YPF!  ')).toBe('nafta ypf');
    expect(normalizeBrandText('Mediodía en Día%')).toBe('mediodia en dia');
    expect(normalizeBrandText('H&M')).toBe('h m');
  });
});

describe('findBrand', () => {
  it('should find a brand mentioned anywhere in the name', () => {
    expect(brandOf('Nafta YPF')).toBe('ypf');
    expect(brandOf('Coto platos')).toBe('coto');
    expect(brandOf('Netflix')).toBe('netflix');
    expect(brandOf('Super jumbo')).toBe('jumbo');
    expect(brandOf('Shell y parking')).toBe('shell');
    expect(brandOf('Mercado Libre - pañales y super')).toBe('mercadolibre');
  });

  it('should ignore case and accents', () => {
    expect(brandOf('EDENOR junio')).toBe('edenor');
    expect(brandOf('Supermercado Día')).toBe('dia');
    expect(brandOf('Día')).toBe('dia');
  });

  it('should only match whole words', () => {
    expect(brandOf('Mediodía')).toBeNull();
    expect(brandOf('Almuerzo mediodia')).toBeNull();
    expect(brandOf('Cotolengo')).toBeNull();
    expect(brandOf('Ypfx')).toBeNull();
    expect(brandOf('Escoto')).toBeNull();
  });

  it('should not take common words as brands', () => {
    expect(brandOf('Dia 1 chicago')).toBeNull();
    expect(brandOf('Bebidas dia de la madre')).toBeNull();
    expect(brandOf('Gasto personal')).toBeNull();
    expect(brandOf('Personal')).toBe('personal');
    expect(brandOf('Supermercado meli')).toBeNull();
  });

  it('should understand how the household writes some brands', () => {
    expect(brandOf('Hym clara')).toBe('hm');
    expect(brandOf('H&M')).toBe('hm');
    expect(brandOf('Mc y desayuno')).toBe('mcdonalds');
    expect(brandOf('Nesspreso')).toBe('nespresso');
    expect(brandOf('Pedidos ya')).toBe('pedidosya');
    expect(brandOf('Osde clara julio')).toBe('osde');
    expect(brandOf('Compras clari waltmart')).toBe('walmart');
  });

  it('should pick the brand that appears first when there are several', () => {
    expect(brandOf('Havanna y mc')).toBe('havanna');
    expect(brandOf('Mc y Havanna')).toBe('mcdonalds');
  });

  it('should return null for empty or unknown names', () => {
    expect(findBrand('')).toBeNull();
    expect(findBrand(null)).toBeNull();
    expect(findBrand('Verduleria')).toBeNull();
    expect(findBrand('!!!')).toBeNull();
  });

  it('should have unique ids and a label for every brand without an icon', () => {
    const ids = BRANDS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    BRANDS.filter(({ icon }) => !icon).forEach((brand) => {
      expect(brand.label).toBeTruthy();
    });
  });
});
