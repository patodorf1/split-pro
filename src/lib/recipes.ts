import { cleanShoppingItemName } from '~/lib/shopping';
import { type StockSection, containsWords, stockKey } from '~/lib/stock';

/**
 * Recetario de la casa: reglas puras (sin base) para comparar recetas contra el Stock. Las usan
 * el router, la importación inicial y, en la entrega 3, la API de Charly.
 */

/** Tipos de receta, en el orden de los filtros de Comidas. */
export const RECIPE_KINDS = ['PROTEIN', 'SALAD', 'SIDE', 'MAIN'] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

export const isRecipeKind = (value: unknown): value is RecipeKind =>
  'string' === typeof value && (RECIPE_KINDS as readonly string[]).includes(value);

/** Igual que un nombre de Compras: la clave del título se calcula sobre los primeros 80. */
export const MAX_RECIPE_TITLE_LENGTH = 80;
export const MAX_RECIPE_YIELD_LENGTH = 80;
export const MAX_RECIPE_BODY_LENGTH = 20_000;
/** Lo normal son 3 a 6; la familia aprobó recetas con 7 y 8. */
export const MAX_RECIPE_INGREDIENTS = 12;

/** El título como se va a mostrar: sin viñetas, sin puntuación de borde, un espacio entre palabras. */
export const cleanRecipeTitle = (raw: string): string => cleanShoppingItemName(raw);

/**
 * Clave del título, con el mismo criterio que los productos: "Milanesas de pollo" y "milanesa de
 * pollo" son la misma receta y no pueden estar dos veces en el grupo.
 */
export const recipeTitleKey = (title: string): string => stockKey(title);

export interface RecipeIngredientInput {
  name: string;
  key: string;
  position: number;
}

/**
 * Ingredientes principales: limpios, sin repetidos (por clave, "huevos" = "huevo") y como mucho
 * doce, en el orden en que se escribieron.
 */
export const cleanRecipeIngredients = (names: readonly string[]): RecipeIngredientInput[] => {
  const seen = new Set<string>();
  const result: RecipeIngredientInput[] = [];

  for (const raw of names) {
    const name = cleanShoppingItemName(raw);
    const key = stockKey(name);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ name, key, position: result.length });

    if (result.length >= MAX_RECIPE_INGREDIENTS) {
      break;
    }
  }

  return result;
};

/** "pollo, pan rallado\nhuevo" → tres ingredientes: el editor los pide separados por coma. */
export const splitIngredientText = (text: string): string[] =>
  text
    .split(/[\n\r,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Claves del Stock que cuentan para cocinar: todo menos Limpieza. */
export const cookingStockKeys = (
  items: readonly { key: string; section: StockSection }[],
): string[] => items.filter((item) => 'CLEANING' !== item.section).map((item) => item.key);

/**
 * Lo que falta de una receta: los ingredientes que ningún producto del Stock contiene como
 * palabras completas. "pollo" lo cubre "Pechugas de pollo"; "pan rallado" no lo cubre "Pan lactal".
 */
export const missingIngredients = <T extends { key: string }>(
  ingredients: readonly T[],
  stockKeys: readonly string[],
): T[] =>
  ingredients.filter((ingredient) => !stockKeys.some((key) => containsWords(key, ingredient.key)));

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, 'es', { sensitivity: 'base' });

/** Las tres partes de Comidas (no falta nada, falta una, faltan varias), cada una alfabética. */
export const groupRecipesByStatus = <T extends { title: string; missing: readonly unknown[] }>(
  recipes: readonly T[],
) => {
  const sorted = [...recipes].sort(byTitle);

  return {
    ready: sorted.filter((recipe) => 0 === recipe.missing.length),
    oneMissing: sorted.filter((recipe) => 1 === recipe.missing.length),
    moreMissing: sorted.filter((recipe) => 1 < recipe.missing.length),
  };
};

/**
 * Carnes, pollo y pescado que se cocinan sin receta: a la parrilla, al horno o a la plancha. Se
 * buscan como palabras dentro del nombre del producto ("Tira de asado", "Muslos deshuesados").
 */
const CUT_KEYS = [
  'carne',
  'asado',
  'vacío',
  'matambre',
  'matambrito',
  'bife',
  'entraña',
  'cuadril',
  'peceto',
  'nalga',
  'lomo',
  'solomillo',
  'roast beef',
  'roastbeef',
  'osobuco',
  'falda',
  'bondiola',
  'pechito',
  'costilla',
  'carré',
  'cerdo',
  'cordero',
  'chorizo',
  'morcilla',
  'salchicha',
  'hamburguesa',
  'milanesa',
  'suprema',
  'pollo',
  'muslo',
  'pechuga',
  'pescado',
  'trucha',
  'salmón',
  'merluza',
  'lenguado',
  'abadejo',
].map(stockKey);

/** Nombran una carne pero no son un plato solo: la picada y el caldo llevan receta. */
const NOT_CUT_KEYS = ['picada', 'caldo'].map(stockKey);

export const looksLikeCut = (key: string): boolean =>
  CUT_KEYS.some((word) => containsWords(key, word)) &&
  !NOT_CUT_KEYS.some((word) => containsWords(key, word));

/**
 * Los cortes del Stock que van en Comidas aunque no tengan receta ("Tira de asado"). Se saltean
 * los que ya tienen su plato: el que se llama igual que una receta ("Milanesas de pollo") y el que
 * ya entra en una proteína que se puede hacer hoy ("Trucha" con "Trucha al horno").
 */
export const stockCuts = <T extends { key: string; name: string; section: StockSection }>(
  items: readonly T[],
  recipes: readonly {
    title: string;
    kind: RecipeKind;
    ingredientKeys: readonly string[];
    ready: boolean;
  }[],
): T[] => {
  const titleKeys = new Set(recipes.map((recipe) => recipeTitleKey(recipe.title)));
  const cookedKeys = recipes
    .filter((recipe) => recipe.ready && 'PROTEIN' === recipe.kind)
    .flatMap((recipe) => recipe.ingredientKeys);

  return items
    .filter(
      (item) =>
        'CLEANING' !== item.section &&
        looksLikeCut(item.key) &&
        !titleKeys.has(item.key) &&
        !cookedKeys.some((key) => containsWords(item.key, key)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
};
