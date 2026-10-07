import React from 'react';

import { cn } from '~/lib/utils';
import { type RouterOutputs } from '~/utils/api';

import { AddMissingButton, MissingChips } from './MissingIngredients';

export type RecipeListItem = RouterOutputs['recipes']['list']['ready'][number];

/**
 * Un plato en Comidas. Si no falta nada, solo el nombre. Si falta algo, las cápsulas de lo que
 * falta y, abajo a la derecha, el botón para mandarlo a Compras. Nunca el tipo (se ve con los
 * filtros).
 */
export const RecipeCard: React.FC<{
  groupId: number;
  recipe: RecipeListItem;
  onOpen: (id: string) => void;
}> = ({ groupId, recipe, onOpen }) => {
  const hasMissing = 0 < recipe.missing.length;

  return (
    <div className="card-surface relative overflow-hidden">
      <button
        type="button"
        onClick={() => onOpen(recipe.id)}
        className={cn('flex w-full flex-col gap-2 px-4 py-3 text-left', hasMissing && 'pr-20')}
      >
        <span className="text-base font-medium">{recipe.title}</span>
        {hasMissing ? <MissingChips missing={recipe.missing} withPrefix /> : null}
      </button>
      {hasMissing ? (
        <div className="absolute right-3 bottom-3">
          <AddMissingButton
            groupId={groupId}
            recipeId={recipe.id}
            missing={recipe.missing}
            compact
          />
        </div>
      ) : null}
    </div>
  );
};
