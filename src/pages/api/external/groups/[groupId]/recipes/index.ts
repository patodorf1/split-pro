import type { NextApiRequest, NextApiResponse } from 'next';

import { parseExternalRecipeCreate, parseExternalRecipeQuery } from '~/lib/externalRecipes';
import {
  guardExternalRequest,
  handleExternalError,
  loadGroup,
  readSingleQueryParam,
} from '~/server/externalExpenses';
import { createExternalRecipe, listExternalRecipes } from '~/server/externalRecipes';

/**
 * GET  /api/external/groups/{groupId}/recipes?kind=salad&q=texto — el recetario con lo que falta
 *      de cada receta, en las tres partes de Comidas.
 * POST /api/external/groups/{groupId}/recipes — guarda una receta.
 *
 * Pensado para Charly. Ver docs/EXTERNAL_API.md, sección "Recetas".
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!guardExternalRequest(req, res)) {
    return;
  }

  if ('GET' !== req.method && 'POST' !== req.method) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido / Method not allowed' });
  }

  try {
    const group = await loadGroup(readSingleQueryParam(req.query.groupId));

    if ('GET' === req.method) {
      const recipes = await listExternalRecipes(group, parseExternalRecipeQuery(req.query));

      return res.status(200).json(recipes);
    }

    const created = await createExternalRecipe(group, parseExternalRecipeCreate(req.body));

    return res.status(201).json({ groupId: group.id, created: true, ...created });
  } catch (error) {
    return handleExternalError(res, error, `recipes ${req.method}`);
  }
}
