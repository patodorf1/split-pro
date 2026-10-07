import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient, RecipeSource, ShoppingItemSource } from '@prisma/client';

import {
  MAX_RECIPE_BODY_LENGTH,
  MAX_RECIPE_YIELD_LENGTH,
  type RecipeIngredientInput,
  type RecipeKind,
  cleanRecipeIngredients,
  cleanRecipeTitle,
  cookingStockKeys,
  groupRecipesByStatus,
  missingIngredients,
  recipeTitleKey,
  stockCuts,
} from '~/lib/recipes';
import { cleanOptionalText } from '~/lib/shopping';
import { type StockSection } from '~/lib/stock';
import { loadPendingShoppingKeys } from '~/server/stock/service';

/**
 * Acceso a datos del recetario. Recibe el cliente por parámetro para correr dentro de una
 * transacción y para testearse sin base. El estado de cada receta (qué falta) se calcula en
 * memoria: son decenas de recetas y de productos.
 */

export type RecipeDb = Pick<
  PrismaClient | Prisma.TransactionClient,
  'recipe' | 'recipeIngredient' | 'stockItem' | 'shoppingItem'
>;

const INGREDIENTS = {
  select: { name: true, key: true, position: true },
  orderBy: { position: 'asc' },
} as const;

export const RECIPE_SELECT = {
  id: true,
  title: true,
  kind: true,
  yieldText: true,
  body: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  ingredients: INGREDIENTS,
} as const;

export interface MissingIngredient {
  name: string;
  /** Ya está pendiente en Compras: el botón no lo vuelve a sumar. */
  inShopping: boolean;
}

export interface RecipeFields {
  title: string;
  kind: RecipeKind;
  yieldText?: string | null;
  body?: string;
  ingredients: string[];
}

/** Ya hay otra receta con ese título en el grupo. */
export class RecipeConflictError extends Error {
  constructor() {
    super('Recipe title already taken');
    this.name = 'RecipeConflictError';
  }
}

/** Título o ingredientes que quedan vacíos después de limpiarlos. */
export class RecipeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeInputError';
  }
}

interface PantryItem {
  id: string;
  name: string;
  note: string | null;
  key: string;
  section: StockSection;
}

interface Pantry {
  stock: PantryItem[];
  stockKeys: string[];
  pending: Set<string>;
}

/** Lo que hay en casa (sin Limpieza) y lo que ya está anotado en Compras. */
const loadPantry = async (db: RecipeDb, groupId: number): Promise<Pantry> => {
  const [stock, pending] = await Promise.all([
    db.stockItem.findMany({
      where: { groupId },
      select: { id: true, name: true, note: true, key: true, section: true },
    }),
    loadPendingShoppingKeys(db, groupId),
  ]);

  return { stock, stockKeys: cookingStockKeys(stock), pending };
};

const missingFor = (
  ingredients: readonly { name: string; key: string }[],
  pantry: Pantry,
): MissingIngredient[] =>
  missingIngredients(ingredients, pantry.stockKeys).map((ingredient) => ({
    name: ingredient.name,
    inShopping: pantry.pending.has(ingredient.key),
  }));

const cleanBody = (body: string | undefined) =>
  (body ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_RECIPE_BODY_LENGTH);

const cleanYield = (value: string | null | undefined) =>
  cleanOptionalText(value, MAX_RECIPE_YIELD_LENGTH) ?? null;

/** En Compras se ve "Pan rallado", aunque el ingrediente se haya escrito "pan rallado". */
const capitalize = (name: string) => `${name.charAt(0).toLocaleUpperCase('es')}${name.slice(1)}`;

const requireTitle = (raw: string) => {
  const title = cleanRecipeTitle(raw);

  if (!title) {
    throw new RecipeInputError('Empty recipe title');
  }

  return title;
};

const requireIngredients = (names: string[]) => {
  const ingredients = cleanRecipeIngredients(names);

  if (0 === ingredients.length) {
    throw new RecipeInputError('A recipe needs at least one main ingredient');
  }

  return ingredients;
};

/** Guarda los ingredientes ya limpios de una receta (la usan crear y editar). */
const insertIngredients = (db: RecipeDb, recipeId: string, ingredients: RecipeIngredientInput[]) =>
  db.recipeIngredient.createMany({
    data: ingredients.map((ingredient) => ({ recipeId, ...ingredient })),
    skipDuplicates: true,
  });

const titleTaken = async (db: RecipeDb, groupId: number, titleKey: string) =>
  null !== (await db.recipe.findFirst({ where: { groupId, titleKey }, select: { id: true } }));

/** Comidas: las recetas del grupo (de un tipo, si se pide) en sus tres partes. */
export const listRecipes = async (db: RecipeDb, input: { groupId: number; kind?: RecipeKind }) => {
  const [recipes, pantry] = await Promise.all([
    db.recipe.findMany({
      where: { groupId: input.groupId, kind: input.kind },
      select: { id: true, title: true, kind: true, ingredients: INGREDIENTS },
    }),
    loadPantry(db, input.groupId),
  ]);

  const withMissing = recipes.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    kind: recipe.kind,
    missing: missingFor(recipe.ingredients, pantry),
  }));
  // Los cortes sin receta son proteínas: se ven en "Todo" y en "Proteínas", no en los otros tipos.
  const cuts =
    undefined === input.kind || 'PROTEIN' === input.kind
      ? stockCuts(
          pantry.stock,
          recipes.map((recipe, index) => ({
            title: recipe.title,
            kind: recipe.kind,
            ingredientKeys: recipe.ingredients.map((ingredient) => ingredient.key),
            ready: 0 === withMissing[index]!.missing.length,
          })),
        )
      : [];

  return {
    ...groupRecipesByStatus(withMissing),
    cuts: cuts.map((item) => ({ id: item.id, name: item.name, note: item.note })),
  };
};

/** Una receta con su paso a paso y lo que falta hoy. */
export const getRecipe = async (db: RecipeDb, input: { groupId: number; id: string }) => {
  const [recipe, pantry] = await Promise.all([
    db.recipe.findFirst({ where: { id: input.id, groupId: input.groupId }, select: RECIPE_SELECT }),
    loadPantry(db, input.groupId),
  ]);

  return recipe ? { ...recipe, missing: missingFor(recipe.ingredients, pantry) } : null;
};

export const createRecipe = async (
  db: RecipeDb,
  input: RecipeFields & { groupId: number; createdById: number | null; source: RecipeSource },
) => {
  const title = requireTitle(input.title);
  const ingredients = requireIngredients(input.ingredients);
  const titleKey = recipeTitleKey(title);

  /*
   * Un INSERT común con un título repetido abortaría la transacción en Postgres (25P02), así que
   * primero se mira. Y como entre la mirada y el insert otro puede ganar de mano, el insert usa
   * `skipDuplicates` (ON CONFLICT DO NOTHING), que tampoco aborta: si no insertó nada, el título
   * ya estaba. Los ingredientes van después, ya con la receta creada.
   */
  if (await titleTaken(db, input.groupId, titleKey)) {
    throw new RecipeConflictError();
  }

  const id = randomUUID();
  const { count } = await db.recipe.createMany({
    data: [
      {
        id,
        groupId: input.groupId,
        title,
        titleKey,
        kind: input.kind,
        yieldText: cleanYield(input.yieldText),
        body: cleanBody(input.body),
        source: input.source,
        createdById: input.createdById,
      },
    ],
    skipDuplicates: true,
  });

  if (0 === count) {
    throw new RecipeConflictError();
  }

  await insertIngredients(db, id, ingredients);

  return { id };
};

/**
 * Editar lo que venga (lo que no viene, no se toca). Los ingredientes, si vienen, reemplazan a
 * los anteriores. Renombrar a un título que ya existe en el grupo es un conflicto.
 */
export const updateRecipe = async (
  db: RecipeDb,
  input: Partial<RecipeFields> & { groupId: number; id: string },
) => {
  const recipe = await db.recipe.findFirst({
    where: { id: input.id, groupId: input.groupId },
    select: { id: true, titleKey: true },
  });

  if (!recipe) {
    return null;
  }

  // Todo lo que puede rechazarse se revisa antes de escribir.
  const title = undefined === input.title ? undefined : requireTitle(input.title);
  const titleKey = title ? recipeTitleKey(title) : recipe.titleKey;
  const ingredients =
    undefined === input.ingredients ? undefined : requireIngredients(input.ingredients);

  if (titleKey !== recipe.titleKey && (await titleTaken(db, input.groupId, titleKey))) {
    throw new RecipeConflictError();
  }

  // Lo único con unicidad (el título) se escribe al final.
  if (ingredients) {
    await db.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    await insertIngredients(db, recipe.id, ingredients);
  }

  await db.recipe.update({
    where: { id: recipe.id },
    data: {
      title,
      titleKey,
      kind: input.kind,
      yieldText: undefined === input.yieldText ? undefined : cleanYield(input.yieldText),
      body: undefined === input.body ? undefined : cleanBody(input.body),
    },
  });

  return { id: recipe.id };
};

/** Borrar una receta (sus ingredientes se van con ella). */
export const deleteRecipe = async (db: RecipeDb, input: { groupId: number; id: string }) =>
  0 < (await db.recipe.deleteMany({ where: { id: input.id, groupId: input.groupId } })).count;

/**
 * "Sumar lo que falta a Compras": vuelve a calcular qué falta (la pantalla puede estar vieja) y
 * agrega cada ingrediente que no esté ya pendiente, con el mismo criterio que "Se acabó".
 */
export const addMissingToShopping = async (
  db: RecipeDb,
  input: { groupId: number; id: string; userId: number | null; source: ShoppingItemSource },
) => {
  const recipe = await db.recipe.findFirst({
    where: { id: input.id, groupId: input.groupId },
    select: { ingredients: INGREDIENTS },
  });

  if (!recipe) {
    return null;
  }

  const pantry = await loadPantry(db, input.groupId);
  const missing = missingIngredients(recipe.ingredients, pantry.stockKeys);
  const toAdd = missing.filter((ingredient) => !pantry.pending.has(ingredient.key));

  if (0 < toAdd.length) {
    // Compras no tiene unicidad por nombre: este insert no puede chocar.
    await db.shoppingItem.createMany({
      data: toAdd.map((ingredient) => ({
        groupId: input.groupId,
        name: capitalize(ingredient.name),
        addedBy: input.userId,
        source: input.source,
      })),
    });
  }

  return {
    added: toAdd.map((ingredient) => capitalize(ingredient.name)),
    alreadyPending: missing
      .filter((ingredient) => pantry.pending.has(ingredient.key))
      .map((ingredient) => capitalize(ingredient.name)),
  };
};
