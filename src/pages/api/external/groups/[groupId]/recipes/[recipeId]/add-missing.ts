import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalAddMissing } from '~/lib/externalRecipes';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { addExternalMissingToShopping, parseRecipeId } from '~/server/externalRecipes';

/**
 * POST /api/external/groups/{groupId}/recipes/{recipeId}/add-missing — suma a Compras lo que
 * falta de la receta, sin repetir lo que ya está pendiente.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('POST' !== req.method) {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));
    const recipeId = parseRecipeId(readSingleQueryParam(req.query.recipeId));
    const result = await addExternalMissingToShopping(
      group,
      recipeId,
      parseExternalAddMissing(req.body),
    );

    return res.status(200).json(result);
  } catch (error) {
    return handleExternalError(res, error, 'recipe add-missing');
  }
}
