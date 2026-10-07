import { Beef, BookOpen, CircleCheck, CookingPot, Plus, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';

import { Button } from '~/components/ui/button';
import { SectionLabel } from '~/components/ui/section-label';
import { RECIPE_KINDS, type RecipeKind } from '~/lib/recipes';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { RecipeCard } from './RecipeCard';
import { RecipeEditor } from './RecipeEditor';

/** Mismo ritmo que Compras y Stock: si alguien cambia el Stock, Comidas se acomoda solo. */
const POLL_INTERVAL_MS = 10_000;

/** Las tres partes, en este orden. */
const PARTS = [
  { part: 'ready', Icon: CircleCheck },
  { part: 'oneMissing', Icon: ShoppingCart },
  { part: 'moreMissing', Icon: BookOpen },
] as const;

/** "Todo" (sin tipo) y los cuatro tipos. */
const FILTERS = [undefined, ...RECIPE_KINDS] as const;

export const MealsTab: React.FC<{
  groupId: number;
  kind?: RecipeKind;
  onKindChange: (kind?: RecipeKind) => void;
  onOpenRecipe: (id: string) => void;
}> = ({ groupId, kind, onKindChange, onOpenRecipe }) => {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);

  const listQuery = api.recipes.list.useQuery(
    { groupId, kind },
    {
      refetchOnWindowFocus: true,
      refetchInterval: POLL_INTERVAL_MS,
      // Al cambiar de filtro se queda lo anterior a la vista hasta que llega lo nuevo.
      placeholderData: (previous) => previous,
    },
  );

  const data = listQuery.data;
  const total = data ? data.ready.length + data.oneMissing.length + data.moreMissing.length : 0;
  const isEmptyBook = Boolean(data) && 0 === total && undefined === kind;

  return (
    <div className="flex flex-col gap-4 pb-36">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-2 overflow-x-auto py-1">
          {FILTERS.map((value) => (
            <button
              key={value ?? 'ALL'}
              type="button"
              aria-pressed={kind === value}
              onClick={() => onKindChange(value)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                kind === value
                  ? 'border-primary/40 bg-primary-soft text-primary'
                  : 'border-border bg-card text-foreground',
              )}
            >
              {t(`meals.kinds.${value ?? 'ALL'}`)}
            </button>
          ))}
        </div>
        <Button
          size="icon"
          className="size-9 shrink-0 rounded-full"
          onClick={() => setCreating(true)}
          aria-label={t('meals.actions.add')}
        >
          <Plus className="size-5" />
        </Button>
      </div>

      {isEmptyBook ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <CookingPot className="text-primary size-10" />
          <p className="text-base font-medium">{t('meals.empty.title')}</p>
          <p className="text-muted-foreground max-w-[260px] text-sm">{t('meals.empty.subtitle')}</p>
        </div>
      ) : null}

      {data && !isEmptyBook
        ? PARTS.map(({ part, Icon }) => (
            <React.Fragment key={part}>
              <section className="flex flex-col gap-2">
                <SectionLabel className="flex items-center gap-1.5">
                  <Icon className="size-3.5" />
                  {t(`meals.parts.${part}`)}
                </SectionLabel>
                {0 < data[part].length ? (
                  data[part].map((recipe) => (
                    <RecipeCard
                      key={recipe.id}
                      groupId={groupId}
                      recipe={recipe}
                      onOpen={onOpenRecipe}
                    />
                  ))
                ) : (
                  <p className="text-muted-foreground px-1 text-sm">
                    {t(`meals.${undefined === kind ? 'part_empty_all' : 'part_empty'}.${part}`)}
                  </p>
                )}
              </section>
              {'ready' === part && 0 < data.cuts.length ? (
                <section className="flex flex-col gap-2">
                  <SectionLabel className="flex items-center gap-1.5">
                    <Beef className="size-3.5" />
                    {t('meals.parts.cuts')}
                  </SectionLabel>
                  {data.cuts.map((cut) => (
                    <div key={cut.id} className="card-surface flex flex-col gap-0.5 px-4 py-3">
                      <span className="text-base font-medium">{cut.name}</span>
                      {cut.note ? (
                        <span className="text-muted-foreground text-xs">{cut.note}</span>
                      ) : null}
                    </div>
                  ))}
                </section>
              ) : null}
            </React.Fragment>
          ))
        : null}

      {creating ? (
        <RecipeEditor
          groupId={groupId}
          defaultKind={kind}
          onClose={() => setCreating(false)}
          onSaved={onOpenRecipe}
        />
      ) : null}
    </div>
  );
};
