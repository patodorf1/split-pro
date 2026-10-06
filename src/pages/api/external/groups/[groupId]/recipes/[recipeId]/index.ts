import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalRecipePatch } from '~/lib/externalRecipes';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { getExternalRecipe, parseRecipeId, updateExternalRecipe } from '~/server/externalRecipes';

/**
 * GET   /api/external/groups/{groupId}/recipes/{recipeId} — la receta con su paso a paso y lo
 *       que falta hoy.
 * PATCH /api/external/groups/{groupId}/recipes/{recipeId} — corrige lo que venga.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('GET' !== req.method && 'PATCH' !== req.method) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));
    const recipeId = parseRecipeId(readSingleQueryParam(req.query.recipeId));

    if ('GET' === req.method) {
      const recipe = await getExternalRecipe(group, recipeId);

      return res.status(200).json({ groupId: group.id, recipe });
    }

    const updated = await updateExternalRecipe(group, recipeId, parseExternalRecipePatch(req.body));

    return res.status(200).json({ groupId: group.id, ...updated });
  } catch (error) {
    return handleExternalError(res, error, `recipe ${req.method}`);
  }
}
