export const CATEGORIES = {
  entertainment: ['games', 'movies', 'music', 'sports', 'other'],
  food: ['diningOut', 'groceries', 'liquor', 'other'],
  home: [
    'electronics',
    'furniture',
    'supplies',
    'maintenance',
    'mortgage',
    'pets',
    'rent',
    'services',
    'other',
  ],
  life: ['childcare', 'clothing', 'education', 'gifts', 'insurance', 'medical', 'taxes', 'other'],
  travel: ['bicycle', 'bus', 'train', 'car', 'fuel', 'hotel', 'parking', 'plane', 'taxi', 'other'],
  utilities: ['cleaning', 'electricity', 'gas', 'internet', 'trash', 'phone', 'water', 'other'],
  general: ['other'],
} as const satisfies Record<string, string[]>;

export const DEFAULT_CATEGORY = 'general';

/**
 * Solo aceptamos categorías que existan de verdad: una URL rara o un valor viejo guardado en la
 * base no tienen que romper el selector ni los botones de categorías rápidas.
 */
export const isKnownCategory = (value: string): boolean =>
  value in CATEGORIES ||
  Object.values(CATEGORIES).some((items) => (items as readonly string[]).includes(value));

export type CategorySection = keyof typeof CATEGORIES;

type CategoryValues = (typeof CATEGORIES)[CategorySection][number];
type CategoryWithoutOther = Exclude<CategoryValues, 'other'>;

export type CategoryItem = CategoryWithoutOther | CategorySection;
