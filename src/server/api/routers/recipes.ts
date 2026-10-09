import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  MAX_RECIPE_BODY_LENGTH,
  MAX_RECIPE_INGREDIENTS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_YIELD_LENGTH,
  RECIPE_KINDS,
} from '~/lib/recipes';
import { MAX_AVOID_TITLES, MAX_IDEAS_WITH_LENGTH } from '~/lib/recipeIdeas';
import { MAX_SHOPPING_ITEM_NAME_LENGTH } from '~/lib/shopping';
import { env } from '~/env';
import { isRecordNotFound, isUniqueViolation } from '~/server/api/prismaErrors';
import { createTRPCRouter, groupProcedure } from '~/server/api/trpc';
import {
  RecipeConflictError,
  RecipeInputError,
  addMissingToShopping,
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  updateRecipe,
} from '~/server/recipes/service';
import {
  IdeasFailedError,
  IdeasLimitError,
  IdeasUnavailableError,
  suggestRecipeIdeas,
} from '~/server/recipes/ideas';

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Recipe not found' });

/**
 * Título repetido (chequeo previo, o P2002 si dos teléfonos renombran a la vez), datos vacíos
 * después de limpiar, y P2025 ("ya no existe": otro la borró en el medio).
 */
const mapError = (error: unknown) => {
  if (error instanceof RecipeConflictError || isUniqueViolation(error)) {
    return new TRPCError({ code: 'CONFLICT', message: 'recipe_title_taken' });
  }

  if (error instanceof RecipeInputError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }

  if (isRecordNotFound(error)) {
    return notFound();
  }

  return error;
};

const recipeFields = z.object({
  title: z.string().trim().min(1).max(MAX_RECIPE_TITLE_LENGTH),
  kind: z.enum(RECIPE_KINDS),
  yieldText: z.string().max(MAX_RECIPE_YIELD_LENGTH).nullable().optional(),
  body: z.string().max(MAX_RECIPE_BODY_LENGTH).optional(),
  ingredients: z
    .array(z.string().min(1).max(MAX_SHOPPING_ITEM_NAME_LENGTH))
    .min(1)
    .max(MAX_RECIPE_INGREDIENTS),
});

const recipeId = z.object({ id: z.string().uuid() });

/** Recetario de la casa. Mismo criterio de acceso que Compras y Stock (miembros del grupo). */
export const recipesRouter = createTRPCRouter({
  /** Comidas: las tres partes, filtradas por tipo si se pide. */
  list: groupProcedure
    .input(z.object({ kind: z.enum(RECIPE_KINDS).optional() }))
    .query(({ ctx, input }) => listRecipes(ctx.db, input)),

  get: groupProcedure.input(recipeId).query(async ({ ctx, input }) => {
    const recipe = await getRecipe(ctx.db, input);

    if (!recipe) {
      throw notFound();
    }

    return recipe;
  }),

  create: groupProcedure.input(recipeFields).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.db.$transaction((tx) =>
        createRecipe(tx, { ...input, createdById: ctx.session.user.id, source: 'APP' }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }),

  update: groupProcedure
    .input(recipeFields.partial().merge(recipeId))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.db.$transaction((tx) => updateRecipe(tx, input));

        if (!result) {
          throw notFound();
        }

        return result;
      } catch (error) {
        throw mapError(error);
      }
    }),

  remove: groupProcedure.input(recipeId).mutation(async ({ ctx, input }) => {
    try {
      if (!(await deleteRecipe(ctx.db, input))) {
        throw notFound();
      }

      return { id: input.id };
    } catch (error) {
      throw mapError(error);
    }
  }),

  /**
   * "Ideas con IA": dos recetas con lo que hay en el Stock, del tipo del filtro y, si se pide,
   * con un ingrediente principal ("pollo"). Es mutación porque
   * cada pedido cuesta plata y da algo distinto: no se cachea ni se repite solo.
   */
  ideas: groupProcedure
    .input(
      z.object({
        kind: z.enum(RECIPE_KINDS).optional(),
        withIngredient: z.string().trim().max(MAX_IDEAS_WITH_LENGTH).optional(),
        avoidTitles: z
          .array(z.string().max(MAX_RECIPE_TITLE_LENGTH))
          .max(MAX_AVOID_TITLES)
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await suggestRecipeIdeas(ctx.db, input, { apiKey: env.OPENROUTER_API_KEY });
      } catch (error) {
        if (error instanceof IdeasUnavailableError) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ideas_unavailable' });
        }

        if (error instanceof IdeasLimitError) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'ideas_limit' });
        }

        if (error instanceof IdeasFailedError) {
          console.error('recipes.ideas', error.message);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'ideas_failed' });
        }

        throw error;
      }
    }),

  /** "Sumar lo que falta a Compras": sin duplicar lo que ya está pendiente. */
  addMissingToShopping: groupProcedure.input(recipeId).mutation(async ({ ctx, input }) => {
    try {
      const result = await ctx.db.$transaction((tx) =>
        addMissingToShopping(tx, {
          groupId: input.groupId,
          id: input.id,
          userId: ctx.session.user.id,
          source: 'APP',
        }),
      );

      if (!result) {
        throw notFound();
      }

      return result;
    } catch (error) {
      throw mapError(error);
    }
  }),
});
