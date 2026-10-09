import {
  DailyLimiter,
  IDEAS_MODEL,
  MAX_IDEA_REQUESTS_PER_DAY,
  type RecipeIdea,
  buildIdeasMessages,
  parseIdeasResponse,
} from '~/lib/recipeIdeas';
import { type RecipeKind, cookingStockKeys, missingIngredients } from '~/lib/recipes';
import { stockKey } from '~/lib/stock';
import { type RecipeDb } from '~/server/recipes/service';

/**
 * "Ideas con IA": junta el Stock y los títulos del recetario, le pide recetas a OpenRouter y
 * devuelve las ideas con lo que les falta (por si la IA usó algo que no hay). No guarda nada:
 * guardar una idea es crear una receta común desde la app.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FETCH_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 4000;

/** Falta la clave de OpenRouter en el servidor. */
export class IdeasUnavailableError extends Error {
  constructor() {
    super('ideas_unavailable');
    this.name = 'IdeasUnavailableError';
  }
}

/** Se llegó al tope de pedidos de hoy. */
export class IdeasLimitError extends Error {
  constructor() {
    super('ideas_limit');
    this.name = 'IdeasLimitError';
  }
}

/** La IA no respondió o respondió algo que no se pudo leer. */
export class IdeasFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdeasFailedError';
  }
}

export interface RecipeIdeaWithMissing extends RecipeIdea {
  missing: string[];
}

const limiter = new DailyLimiter(MAX_IDEA_REQUESTS_PER_DAY);

interface IdeasDeps {
  apiKey: string | undefined;
  fetch?: typeof fetch;
  limiter?: DailyLimiter;
}

export const suggestRecipeIdeas = async (
  db: RecipeDb,
  input: { groupId: number; kind?: RecipeKind; withIngredient?: string; avoidTitles: string[] },
  deps: IdeasDeps,
): Promise<RecipeIdeaWithMissing[]> => {
  if (!deps.apiKey) {
    throw new IdeasUnavailableError();
  }

  const [stock, recipes] = await Promise.all([
    db.stockItem.findMany({
      where: { groupId: input.groupId },
      select: { name: true, note: true, key: true, section: true },
      orderBy: { name: 'asc' },
    }),
    db.recipe.findMany({ where: { groupId: input.groupId }, select: { title: true } }),
  ]);

  if (!(deps.limiter ?? limiter).take(input.groupId)) {
    throw new IdeasLimitError();
  }

  const avoidTitles = [
    ...new Set([...recipes.map((recipe) => recipe.title), ...input.avoidTitles]),
  ];

  let text: string;

  try {
    const response = await (deps.fetch ?? fetch)(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: IDEAS_MODEL,
        max_tokens: MAX_TOKENS,
        messages: buildIdeasMessages({
          kind: input.kind,
          withIngredient: input.withIngredient,
          stock,
          avoidTitles,
        }),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new IdeasFailedError(`OpenRouter respondió ${response.status}`);
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- se valida campo por campo abajo
    const json = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    text = 'string' === typeof content ? content : '';
  } catch (error) {
    if (error instanceof IdeasFailedError) {
      throw error;
    }

    throw new IdeasFailedError(error instanceof Error ? error.message : 'OpenRouter falló');
  }

  const ideas = parseIdeasResponse(text, input.kind);

  if (0 === ideas.length) {
    throw new IdeasFailedError('Respuesta sin ideas');
  }

  const stockKeys = cookingStockKeys(stock);

  return ideas.map((idea) => ({
    ...idea,
    missing: missingIngredients(
      idea.ingredients.map((name) => ({ name, key: stockKey(name) })),
      stockKeys,
    ).map((ingredient) => ingredient.name),
  }));
};
