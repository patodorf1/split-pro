import { ChevronLeft, CircleCheck, Pencil } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useMemo, useState } from 'react';

import { Button } from '~/components/ui/button';
import { parseRecipeBody } from '~/lib/recipeBody';
import { api } from '~/utils/api';

import { AddMissingButton, MissingChips } from './MissingIngredients';
import { RecipeEditor } from './RecipeEditor';
import { RecipeSteps } from './RecipeSteps';

const POLL_INTERVAL_MS = 10_000;

/**
 * Una receta: volver a Comidas, título, rinde, si se puede hacer hoy (o qué falta, con el botón a
 * Compras) y el paso a paso numerado. Sin paso a paso, invita a dictarlo o escribirlo.
 */
export const RecipeScreen: React.FC<{ groupId: number; recipeId: string; onBack: () => void }> = ({
  groupId,
  recipeId,
  onBack,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const recipeQuery = api.recipes.get.useQuery(
    { groupId, id: recipeId },
    { refetchOnWindowFocus: true, refetchInterval: POLL_INTERVAL_MS, retry: false },
  );

  const recipe = recipeQuery.data;
  const body = useMemo(() => parseRecipeBody(recipe?.body ?? ''), [recipe?.body]);
  const hasBody = 0 < body.intro.length + body.steps.length;

  return (
    <div className="flex flex-col gap-3 pb-36">
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="text-primary -ml-2 gap-0.5 px-2" onClick={onBack}>
          <ChevronLeft className="size-5" />
          {t('meals.actions.back')}
        </Button>
        {recipe ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-primary gap-1.5"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
            {t('meals.actions.edit')}
          </Button>
        ) : null}
      </div>

      {recipeQuery.isError ? (
        <p className="text-muted-foreground mt-10 text-center text-sm">
          {t('meals.recipe.not_found')}
        </p>
      ) : null}

      {recipe ? (
        <>
          <div>
            <h2 className="text-2xl font-semibold">{recipe.title}</h2>
            {recipe.yieldText ? (
              <p className="text-muted-foreground text-sm">{recipe.yieldText}</p>
            ) : null}
          </div>

          {0 === recipe.missing.length ? (
            <div className="bg-positive-soft text-positive rounded-card flex items-center gap-2 px-4 py-3 font-medium">
              <CircleCheck className="size-5" />
              {t('meals.recipe.ready')}
            </div>
          ) : (
            <div className="card-surface flex flex-col gap-2 px-4 py-3">
              <p className="font-medium">{t('meals.recipe.missing')}</p>
              <MissingChips missing={recipe.missing} />
              <div>
                <AddMissingButton groupId={groupId} recipeId={recipe.id} missing={recipe.missing} />
              </div>
            </div>
          )}

          {hasBody ? (
            <RecipeSteps body={body} />
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-3 px-4 py-8 text-center text-sm">
              <p className="max-w-[280px]">{t('meals.recipe.no_steps')}</p>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {t('meals.actions.write_steps')}
              </Button>
            </div>
          )}

          {editing ? (
            <RecipeEditor
              groupId={groupId}
              recipe={recipe}
              onClose={() => setEditing(false)}
              onDeleted={onBack}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
};
