import React from 'react';

import { type RouterOutputs } from '~/utils/api';

import { AddMissingButton, MissingChips } from './MissingIngredients';

export type RecipeListItem = RouterOutputs['recipes']['list']['ready'][number];

/**
 * Un plato en Comidas. Si no falta nada, solo el nombre. Si falta algo, las cápsulas de lo que
 * falta y el botón para mandarlo a Compras. Nunca el tipo (se ve con los filtros).
 */
export const RecipeCard: React.FC<{
  groupId: number;
  recipe: RecipeListItem;
  onOpen: (id: string) => void;
}> = ({ groupId, recipe, onOpen }) => (
  <div className="card-surface overflow-hidden">
    <button
      type="button"
      onClick={() => onOpen(recipe.id)}
      className="flex w-full flex-col gap-2 px-4 py-3 text-left"
    >
      <span className="text-base font-medium">{recipe.title}</span>
      {0 < recipe.missing.length ? <MissingChips missing={recipe.missing} withPrefix /> : null}
    </button>
    {0 < recipe.missing.length ? (
      <div className="px-4 pb-3">
        <AddMissingButton groupId={groupId} recipeId={recipe.id} missing={recipe.missing} />
      </div>
    ) : null}
  </div>
);
