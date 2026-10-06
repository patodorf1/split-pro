import { z } from 'zod';

import {
  ExternalApiError,
  parseExternalBody,
  personRefSchema,
  readSingleQueryParam,
} from '~/lib/externalExpense';
import {
  MAX_RECIPE_BODY_LENGTH,
  MAX_RECIPE_INGREDIENTS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_YIELD_LENGTH,
  RECIPE_KINDS,
  type RecipeKind,
  cleanRecipeTitle,
  isRecipeKind,
  recipeTitleKey,
} from '~/lib/recipes';
import { MAX_SHOPPING_ITEM_NAME_LENGTH } from '~/lib/shopping';
import { containsWords } from '~/lib/stock';

/**
 * Parseo y textos puros (sin base) de la API externa del recetario, pensada para Charly. Las
 * reglas (ingredientes principales, receta contra Stock) son las de `src/lib/recipes.ts`.
 * Ver docs/EXTERNAL_API.md, sección "Recetas".
 */

/** Cómo se llama cada tipo en los filtros de Comidas (es-AR). */
export const RECIPE_KIND_LABELS: Record<RecipeKind, string> = {
  PROTEIN: 'Proteínas',
  MAIN: 'Platos',
  SALAD: 'Ensaladas',
  SIDE: 'Guarniciones',
};

/** "salad", "Salad" o "SALAD" valen lo mismo. */
const kindSchema = z.preprocess(
  (value) => ('string' === typeof value ? value.trim().toUpperCase() : value),
  z.enum(RECIPE_KINDS),
);

const recipeFieldsSchema = z.object({
  /** Más de 80 es un 400: `cleanRecipeTitle` corta en 80 y no se quiere cortar en silencio. */
  title: z
    .string()
    .trim()
    .max(MAX_RECIPE_TITLE_LENGTH)
    .transform(cleanRecipeTitle)
    .pipe(z.string().min(1)),
  kind: kindSchema,
  ingredients: z
    .array(z.string().min(1).max(MAX_SHOPPING_ITEM_NAME_LENGTH))
    .min(1)
    .max(MAX_RECIPE_INGREDIENTS),
  body: z.string().max(MAX_RECIPE_BODY_LENGTH).optional(),
  /** "Para 1,8 kg"; `null` lo borra. */
  yield: z.string().max(MAX_RECIPE_YIELD_LENGTH).nullable().optional(),
});

const createSchema = recipeFieldsSchema.extend({ createdBy: personRefSchema.optional() }).strict();

const patchSchema = recipeFieldsSchema
  .partial()
  .strict()
  .refine((patch) => 0 < Object.keys(patch).length, 'Nothing to change');

const addMissingSchema = z.object({ addedBy: personRefSchema.optional() }).strict();

export type ExternalRecipeCreate = z.infer<typeof createSchema>;
export type ExternalRecipePatch = z.infer<typeof patchSchema>;
export type ExternalAddMissing = z.infer<typeof addMissingSchema>;

export const parseExternalRecipeCreate = (body: unknown) => parseExternalBody(createSchema, body);

export const parseExternalRecipePatch = (body: unknown) => parseExternalBody(patchSchema, body);

export const parseExternalAddMissing = (body: unknown) => parseExternalBody(addMissingSchema, body);

export interface ExternalRecipeQuery {
  kind?: RecipeKind;
  /** Texto a buscar en el título, o null. */
  q: string | null;
}

/** `?kind=salad&q=milanesas`. */
export const parseExternalRecipeQuery = (
  query: Record<string, string | string[] | undefined>,
): ExternalRecipeQuery => {
  const rawKind = readSingleQueryParam(query.kind)?.trim().toUpperCase();

  if (rawKind && !isRecipeKind(rawKind)) {
    throw new ExternalApiError(
      400,
      'invalid_field',
      'kind: tiene que ser protein, main, salad o side',
      'kind: must be protein, main, salad or side',
      'kind',
    );
  }

  const kind = rawKind && isRecipeKind(rawKind) ? rawKind : undefined;
  const q = cleanRecipeTitle(readSingleQueryParam(query.q) ?? '');

  return { kind, q: recipeTitleKey(q) ? q : null };
};

/** ¿El título contiene lo buscado como palabras completas? ("milanesas" → "Milanesa de pollo"). */
export const recipeTitleMatches = (title: string, q: string): boolean =>
  containsWords(recipeTitleKey(title), recipeTitleKey(q));

interface MissingLike {
  name: string;
  inShopping: boolean;
}

interface ListedRecipe {
  title: string;
  missing: readonly MissingLike[];
}

const missingList = (missing: readonly MissingLike[]) =>
  missing
    .map((entry) => (entry.inShopping ? `${entry.name}, ya en Compras` : entry.name))
    .join(', ');

/** Lo que sale hoy y lo que está a una cosa, para contestar tal cual por WhatsApp. */
export const recipesListText = (parts: {
  ready: readonly ListedRecipe[];
  oneMissing: readonly ListedRecipe[];
  moreMissing: readonly ListedRecipe[];
}): string => {
  if (0 === parts.ready.length + parts.oneMissing.length + parts.moreMissing.length) {
    return 'No hay recetas que coincidan.';
  }

  const lines = [
    0 < parts.ready.length
      ? `Podés hacer: ${parts.ready.map((recipe) => recipe.title).join(', ')}.`
      : 'Con lo que hay no sale ninguna.',
  ];

  if (0 < parts.oneMissing.length) {
    lines.push(
      `Te falta una cosa: ${parts.oneMissing
        .map((recipe) => `${recipe.title} (${missingList(recipe.missing)})`)
        .join('; ')}.`,
    );
  }
  if (0 < parts.moreMissing.length) {
    lines.push(`A ${parts.moreMissing.length} más les faltan dos cosas o más.`);
  }

  return lines.join('\n');
};

/** La receta entera para mandar por WhatsApp: título, rinde, qué falta y el paso a paso. */
export const recipeText = (recipe: {
  title: string;
  yieldText: string | null;
  ingredients: readonly { name: string }[];
  missing: readonly MissingLike[];
  body: string;
}): string =>
  [
    recipe.title,
    ...(recipe.yieldText ? [recipe.yieldText] : []),
    `Principales: ${recipe.ingredients.map((ingredient) => ingredient.name).join(', ')}.`,
    0 < recipe.missing.length
      ? `Te falta: ${missingList(recipe.missing)}.`
      : 'Tenés todo para hacerla.',
    '',
    recipe.body.trim() || 'Todavía no tiene paso a paso.',
  ].join('\n');

/** "Guardé "Pollo al horno" como Platos, con: pollo, papa." */
export const recipeSavedText = (recipe: {
  title: string;
  kind: RecipeKind;
  ingredients: readonly { name: string }[];
}): string =>
  `Guardé "${recipe.title}" como ${RECIPE_KIND_LABELS[recipe.kind]}, con: ${recipe.ingredients
    .map((ingredient) => ingredient.name)
    .join(', ')}.`;

/** "Sumé a Compras: Carne, Pan rallado. Ya estaba en Compras: Huevo." */
export const addMissingText = (result: { added: string[]; alreadyPending: string[] }): string => {
  if (0 === result.added.length + result.alreadyPending.length) {
    return 'No falta nada: tenés todo para hacerla.';
  }

  const parts: string[] = [];

  if (0 < result.added.length) {
    parts.push(`Sumé a Compras: ${result.added.join(', ')}.`);
  }
  if (0 < result.alreadyPending.length) {
    parts.push(
      `${1 === result.alreadyPending.length ? 'Ya estaba' : 'Ya estaban'} en Compras: ${result.alreadyPending.join(', ')}.`,
    );
  }

  return parts.join(' ');
};
