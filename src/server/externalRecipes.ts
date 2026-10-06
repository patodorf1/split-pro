import { ExternalApiError, isUuid, resolveOptionalMemberId } from '~/lib/externalExpense';
import {
  type ExternalAddMissing,
  type ExternalRecipeCreate,
  type ExternalRecipePatch,
  type ExternalRecipeQuery,
  RECIPE_KIND_LABELS,
  addMissingText,
  recipeSavedText,
  recipeText,
  recipeTitleMatches,
  recipesListText,
} from '~/lib/externalRecipes';
import { parseRecipeBody } from '~/lib/recipeBody';
import { isRecordNotFound, isUniqueViolation } from '~/server/api/prismaErrors';
import { db } from '~/server/db';
import { type LoadedGroup, assertGroupWritable } from '~/server/externalExpenses';
import {
  RecipeConflictError,
  RecipeInputError,
  addMissingToShopping,
  createRecipe,
  getRecipe,
  listRecipes,
  updateRecipe,
} from '~/server/recipes/service';

/**
 * Lógica con base de la API externa del recetario (Charly). Todo pasa por el servicio de la app
 * (`src/server/recipes/service.ts`): mismo cálculo de lo que falta, mismos títulos únicos, mismo
 * "sumar lo que falta" sin duplicar en Compras. Cocinar no toca el Stock.
 */

type RecipeWithMissing = NonNullable<Awaited<ReturnType<typeof getRecipe>>>;

const recipeNotFound = () =>
  new ExternalApiError(
    404,
    'recipe_not_found',
    'Receta no encontrada en este grupo',
    'Recipe not found in this group',
  );

/** Id de la URL; si no es un uuid, es como si no existiera. */
export const parseRecipeId = (raw: string | undefined): string => {
  if (!isUuid(raw)) {
    throw recipeNotFound();
  }

  return raw;
};

/** Título repetido (chequeo previo o choque en el índice), datos vacíos y "ya no existe". */
const mapRecipeError = (error: unknown) => {
  if (error instanceof RecipeConflictError || isUniqueViolation(error)) {
    return new ExternalApiError(
      409,
      'recipe_title_taken',
      'Ya hay una receta con ese nombre en el grupo',
      'There is already a recipe with that title in this group',
      'title',
    );
  }

  if (error instanceof RecipeInputError) {
    return new ExternalApiError(
      400,
      'validation_error',
      'ingredients: hace falta al menos un ingrediente principal',
      `ingredients: ${error.message}`,
      'ingredients',
    );
  }

  if (isRecordNotFound(error)) {
    return recipeNotFound();
  }

  return error;
};

export const serializeRecipe = (recipe: RecipeWithMissing) => {
  const parsed = parseRecipeBody(recipe.body);

  return {
    id: recipe.id,
    title: recipe.title,
    kind: recipe.kind.toLowerCase(),
    kindLabel: RECIPE_KIND_LABELS[recipe.kind],
    yield: recipe.yieldText,
    ingredients: recipe.ingredients.map((ingredient) => ingredient.name),
    missing: recipe.missing,
    body: recipe.body,
    intro: parsed.intro,
    steps: parsed.steps,
    source: recipe.source.toLowerCase(),
    createdBy: recipe.createdBy,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
    text: recipeText(recipe),
  };
};

const loadRecipe = async (group: LoadedGroup, id: string) => {
  const recipe = await getRecipe(db, { groupId: group.id, id });

  if (!recipe) {
    throw recipeNotFound();
  }

  return recipe;
};

/** Las tres partes de Comidas (de un tipo, o cuyo título contiene `q`). */
export const listExternalRecipes = async (group: LoadedGroup, query: ExternalRecipeQuery) => {
  const parts = await listRecipes(db, { groupId: group.id, kind: query.kind });
  const pick = <T extends { title: string }>(list: T[]) =>
    query.q ? list.filter((recipe) => recipeTitleMatches(recipe.title, query.q!)) : list;
  const found = {
    ready: pick(parts.ready),
    oneMissing: pick(parts.oneMissing),
    moreMissing: pick(parts.moreMissing),
  };
  const serialize = (list: typeof found.ready) =>
    list.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      kind: recipe.kind.toLowerCase(),
      kindLabel: RECIPE_KIND_LABELS[recipe.kind],
      missing: recipe.missing,
    }));

  return {
    groupId: group.id,
    kind: query.kind?.toLowerCase() ?? null,
    q: query.q,
    ready: serialize(found.ready),
    oneMissing: serialize(found.oneMissing),
    moreMissing: serialize(found.moreMissing),
    text: recipesListText(found),
  };
};

export const getExternalRecipe = async (group: LoadedGroup, id: string) =>
  serializeRecipe(await loadRecipe(group, id));

/** Guarda una receta dictada a Charly. Un título que ya existe en el grupo es un 409. */
export const createExternalRecipe = async (group: LoadedGroup, input: ExternalRecipeCreate) => {
  assertGroupWritable(group);
  const createdById = resolveOptionalMemberId(input.createdBy, group.members, 'createdBy');

  try {
    const { id } = await db.$transaction((tx) =>
      createRecipe(tx, {
        groupId: group.id,
        title: input.title,
        kind: input.kind,
        ingredients: input.ingredients,
        body: input.body,
        yieldText: input.yield,
        createdById,
        source: 'API',
      }),
    );
    const recipe = await loadRecipe(group, id);

    return { recipe: serializeRecipe(recipe), text: recipeSavedText(recipe) };
  } catch (error) {
    throw mapRecipeError(error);
  }
};

/** Corrige lo que venga; `ingredients` reemplaza la lista entera. */
export const updateExternalRecipe = async (
  group: LoadedGroup,
  id: string,
  patch: ExternalRecipePatch,
) => {
  assertGroupWritable(group);

  try {
    const updated = await db.$transaction((tx) =>
      updateRecipe(tx, {
        groupId: group.id,
        id,
        title: patch.title,
        kind: patch.kind,
        ingredients: patch.ingredients,
        body: patch.body,
        yieldText: patch.yield,
      }),
    );

    if (!updated) {
      throw recipeNotFound();
    }

    const recipe = await loadRecipe(group, id);

    return { recipe: serializeRecipe(recipe), text: recipeSavedText(recipe) };
  } catch (error) {
    throw mapRecipeError(error);
  }
};

/** "Sumá lo que falta de X a Compras": sin repetir lo que ya está pendiente. */
export const addExternalMissingToShopping = async (
  group: LoadedGroup,
  id: string,
  input: ExternalAddMissing,
) => {
  assertGroupWritable(group);
  const userId = resolveOptionalMemberId(input.addedBy, group.members, 'addedBy');

  try {
    const result = await db.$transaction((tx) =>
      addMissingToShopping(tx, {
        groupId: group.id,
        id,
        userId,
        source: 'API',
      }),
    );

    if (!result) {
      throw recipeNotFound();
    }

    return { groupId: group.id, recipeId: id, ...result, text: addMissingText(result) };
  } catch (error) {
    throw mapRecipeError(error);
  }
};
