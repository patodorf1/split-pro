import { BookOpen, ChevronDown, CircleCheck, CookingPot, Plus, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';

import { Button } from '~/components/ui/button';
import { RECIPE_KINDS, type RecipeKind } from '~/lib/recipes';
import { cn } from '~/lib/utils';
import { type RouterOutputs, api } from '~/utils/api';

import { RecipeCard, type RecipeListItem } from './RecipeCard';
import { RecipeEditor } from './RecipeEditor';

/** Mismo ritmo que Compras y Stock: si alguien cambia el Stock, Comidas se acomoda solo. */
const POLL_INTERVAL_MS = 10_000;

/** Las tres partes, en este orden. */
const PARTS = [
  { part: 'ready', Icon: CircleCheck },
  { part: 'oneMissing', Icon: ShoppingCart },
  { part: 'moreMissing', Icon: BookOpen },
] as const;

type MealsData = RouterOutputs['recipes']['list'];
type MealCard =
  | { type: 'recipe'; title: string; recipe: RecipeListItem }
  | { type: 'cut'; title: string; cut: MealsData['cuts'][number] };

/**
 * Las tarjetas de una parte. En "Podés hacer" entran también los cortes del Stock que se cocinan
 * sin receta ("Tira de asado"), mezclados con las recetas en orden alfabético.
 */
const cardsFor = (part: (typeof PARTS)[number]['part'], data: MealsData): MealCard[] => {
  const recipes: MealCard[] = data[part].map((recipe) => ({
    type: 'recipe',
    title: recipe.title,
    recipe,
  }));

  if ('ready' !== part) {
    return recipes;
  }

  const cuts: MealCard[] = data.cuts.map((cut) => ({ type: 'cut', title: cut.name, cut }));

  return [...recipes, ...cuts].sort((a, b) =>
    a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }),
  );
};

/** "Podés hacer" arranca abierta; las otras dos, plegadas: se abren tocando el título. */
const OPEN_BY_DEFAULT: Record<(typeof PARTS)[number]['part'], boolean> = {
  ready: true,
  oneMissing: false,
  moreMissing: false,
};

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
  const [openParts, setOpenParts] = useState(OPEN_BY_DEFAULT);

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
  const total = data
    ? data.ready.length + data.cuts.length + data.oneMissing.length + data.moreMissing.length
    : 0;
  const isEmptyBook = Boolean(data) && 0 === total && undefined === kind;

  return (
    <div className="flex flex-col gap-4 pb-36">
      {/* Los cinco filtros en una sola fila, también en el celular: repartidos a lo ancho. */}
      <div className="border-border bg-card flex gap-0.5 rounded-full border p-1">
        {FILTERS.map((value) => (
          <button
            key={value ?? 'ALL'}
            type="button"
            aria-pressed={kind === value}
            onClick={() => onKindChange(value)}
            className={cn(
              'min-w-0 flex-auto rounded-full px-1 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              kind === value ? 'bg-primary-soft text-primary' : 'text-muted-foreground',
            )}
          >
            {t(`meals.kinds.${value ?? 'ALL'}`)}
          </button>
        ))}
      </div>

      {isEmptyBook ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <CookingPot className="text-primary size-10" />
          <p className="text-base font-medium">{t('meals.empty.title')}</p>
          <p className="text-muted-foreground max-w-[260px] text-sm">{t('meals.empty.subtitle')}</p>
        </div>
      ) : null}

      {data && !isEmptyBook
        ? PARTS.map(({ part, Icon }) => {
            const cards = cardsFor(part, data);
            const isOpen = openParts[part];

            return (
              <section key={part} className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenParts((current) => ({ ...current, [part]: !isOpen }))}
                  className="flex items-center justify-between text-left"
                >
                  <span className="section-label flex items-center gap-1.5">
                    <Icon className="size-3.5" />
                    {t(`meals.parts.${part}`)}
                    <span className="text-muted-foreground font-normal">{cards.length}</span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground size-4 transition-transform',
                      isOpen && 'rotate-180',
                    )}
                  />
                </button>
                {!isOpen ? null : 0 < cards.length ? (
                  cards.map((card) =>
                    'recipe' === card.type ? (
                      <RecipeCard
                        key={card.recipe.id}
                        groupId={groupId}
                        recipe={card.recipe}
                        onOpen={onOpenRecipe}
                      />
                    ) : (
                      <div
                        key={card.cut.id}
                        className="card-surface flex flex-col gap-0.5 px-4 py-3"
                      >
                        <span className="text-base font-medium">{card.cut.name}</span>
                        {card.cut.note ? (
                          <span className="text-muted-foreground text-xs">{card.cut.note}</span>
                        ) : null}
                      </div>
                    ),
                  )
                ) : (
                  <p className="text-muted-foreground px-1 text-sm">
                    {t(`meals.${undefined === kind ? 'part_empty_all' : 'part_empty'}.${part}`)}
                  </p>
                )}
              </section>
            );
          })
        : null}

      <Button
        variant="outline"
        className="text-primary gap-1.5 self-center rounded-full border-dashed"
        onClick={() => setCreating(true)}
      >
        <Plus className="size-4" />
        {t('meals.actions.add')}
      </Button>

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
