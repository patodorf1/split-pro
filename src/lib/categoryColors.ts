import { CATEGORIES, type CategorySection, DEFAULT_CATEGORY } from '~/lib/category';

/**
 * Color fijo de cada sección de categorías (el puntito del desglose de Estadísticas). Los ítems
 * usan el color de su sección, así todo lo de "Transporte" o "Comida" se reconoce de un vistazo.
 * Son tonos medios: se leen igual sobre los temas claros y sobre los oscuros.
 */
export const CATEGORY_SECTION_COLORS: Record<CategorySection, string> = {
  entertainment: '#A78BDA',
  food: '#E0A458',
  home: '#D98BB3',
  life: '#6FBF8E',
  travel: '#E5857A',
  utilities: '#5FA8D3',
  general: '#9C9A92',
};

const SECTIONS = Object.keys(CATEGORY_SECTION_COLORS).filter(
  (key): key is CategorySection => key in CATEGORIES,
);

const isSection = (value: string): value is CategorySection =>
  (SECTIONS as string[]).includes(value);

const SECTION_BY_ITEM: Record<string, CategorySection> = {};
for (const section of SECTIONS) {
  const items: readonly string[] = CATEGORIES[section];
  for (const item of items) {
    if ('other' !== item) {
      SECTION_BY_ITEM[item] = section;
    }
  }
}

/** Sección a la que pertenece una categoría guardada (o ella misma si ya es una sección). */
export const getCategorySection = (category: string): CategorySection => {
  if (isSection(category)) {
    return category;
  }

  return SECTION_BY_ITEM[category] ?? DEFAULT_CATEGORY;
};

/** Color estable de una categoría guardada. */
export const getCategoryColor = (category: string): string =>
  CATEGORY_SECTION_COLORS[getCategorySection(category)];
