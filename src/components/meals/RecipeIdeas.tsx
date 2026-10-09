import { Check, ChevronDown, LoaderCircle, Sparkles } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { parseRecipeBody } from '~/lib/recipeBody';
import { MAX_AVOID_TITLES, MAX_IDEAS_WITH_LENGTH } from '~/lib/recipeIdeas';
import { type RecipeKind } from '~/lib/recipes';
import { cn } from '~/lib/utils';
import { type RouterOutputs, api } from '~/utils/api';

import { MissingChips } from './MissingIngredients';
import { RecipeSteps } from './RecipeSteps';

type Idea = RouterOutputs['recipes']['ideas'][number];

/** Una idea: nombre, de qué se trata, con qué se hace; el paso a paso se abre tocándola. */
const IdeaCard: React.FC<{
  groupId: number;
  idea: Idea;
  onOpenRecipe: (id: string) => void;
}> = ({ groupId, idea, onOpenRecipe }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const body = useMemo(() => parseRecipeBody(idea.body), [idea.body]);

  const create = api.recipes.create.useMutation({
    onSuccess: ({ id }) => {
      toast.success(t('meals.ideas.saved_toast', { title: idea.title }));
      setSavedId(id);
      void utils.recipes.list.invalidate();
    },
    onError: (error) =>
      toast.error(
        'CONFLICT' === error.data?.code ? t('meals.toast.conflict') : t('meals.toast.error'),
      ),
  });

  return (
    <div className="card-surface flex flex-col gap-2 px-4 py-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-start justify-between gap-3 text-left"
      >
        <span className="flex flex-col gap-1">
          <span className="font-semibold">{idea.title}</span>
          {idea.description ? (
            <span className="text-muted-foreground text-sm">{idea.description}</span>
          ) : null}
          <span className="text-muted-foreground text-xs">
            {[idea.yieldText, idea.ingredients.join(', ')].filter(Boolean).join(' · ')}
          </span>
          {0 < idea.missing.length ? (
            <MissingChips
              missing={idea.missing.map((name) => ({ name, inShopping: false }))}
              withPrefix
            />
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground mt-1 size-4 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? <RecipeSteps body={body} /> : null}
      <div className="flex justify-end gap-2">
        {savedId ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => onOpenRecipe(savedId)}
          >
            <Check className="size-4" />
            {t('meals.ideas.open_saved')}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={create.isPending}
            onClick={() =>
              create.mutate({
                groupId,
                title: idea.title,
                kind: idea.kind,
                yieldText: idea.yieldText,
                body: idea.body,
                ingredients: idea.ingredients,
              })
            }
          >
            {t('meals.ideas.save')}
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * "Ideas con IA": pide dos recetas con lo que hay en el Stock, del tipo del filtro elegido y, si se
 * escribe, con un ingrediente principal ("pollo"). Se pueden guardar en el recetario o pedir otras
 * (sin repetir las que ya se vieron con ese mismo ingrediente).
 */
export const RecipeIdeas: React.FC<{
  groupId: number;
  kind?: RecipeKind;
  onClose: () => void;
  onOpenRecipe: (id: string) => void;
}> = ({ groupId, kind, onClose, onOpenRecipe }) => {
  const { t } = useTranslation();
  const [withText, setWithText] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  // Lo ya visto, por ingrediente: cambiar de "pollo" a "trucha" arranca de cero.
  const [seen, setSeen] = useState<{ withIngredient: string; titles: string[] }>({
    withIngredient: '',
    titles: [],
  });

  const suggest = api.recipes.ideas.useMutation({
    onSuccess: (result, variables) => {
      const withIngredient = variables.withIngredient ?? '';

      setIdeas(result);
      setSeen((current) => ({
        withIngredient,
        titles: [
          ...(current.withIngredient === withIngredient ? current.titles : []),
          ...result.map((idea) => idea.title),
        ].slice(-MAX_AVOID_TITLES),
      }));
    },
  });

  const ask = useCallback(() => {
    const withIngredient = withText.trim().slice(0, MAX_IDEAS_WITH_LENGTH);

    suggest.mutate({
      groupId,
      kind,
      withIngredient: withIngredient || undefined,
      avoidTitles: seen.withIngredient === withIngredient ? seen.titles : [],
    });
  }, [groupId, kind, seen, suggest, withText]);

  const errorKey = suggest.error?.message;
  const blocked = 'ideas_limit' === errorKey || 'ideas_unavailable' === errorKey;
  const errorText =
    'ideas_limit' === errorKey
      ? t('meals.ideas.error_limit')
      : 'ideas_unavailable' === errorKey
        ? t('meals.ideas.error_unavailable')
        : t('meals.ideas.error');

  return (
    <AppDrawer
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={t('meals.ideas.title', { kind: t(`meals.kinds.${kind ?? 'ALL'}`) })}
      className="h-[90dvh]"
      trigger={null}
    >
      <div className="flex flex-col gap-3 px-1 pb-4 text-left">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!suggest.isPending && !blocked) {
              ask();
            }
          }}
        >
          <Input
            value={withText}
            onChange={(e) => setWithText(e.target.value)}
            placeholder={t('meals.ideas.with_placeholder')}
            aria-label={t('meals.ideas.with_label')}
            maxLength={MAX_IDEAS_WITH_LENGTH}
            autoCapitalize="none"
            enterKeyHint="search"
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={suggest.isPending || blocked} className="gap-1.5">
            <Sparkles className="size-4" />
            {0 < ideas.length && seen.withIngredient === withText.trim()
              ? t('meals.ideas.more')
              : t('meals.ideas.ask')}
          </Button>
        </form>
        {suggest.isPending ? (
          <div className="text-muted-foreground mt-12 flex flex-col items-center gap-3 text-center text-sm">
            <LoaderCircle className="text-primary size-8 animate-spin" />
            {t('meals.ideas.loading')}
          </div>
        ) : suggest.isError ? (
          <p className="text-muted-foreground mt-12 text-center text-sm">{errorText}</p>
        ) : 0 === ideas.length ? (
          <p className="text-muted-foreground mt-6 px-2 text-center text-sm">
            {t('meals.ideas.hint')}
          </p>
        ) : (
          ideas.map((idea) => (
            <IdeaCard key={idea.title} groupId={groupId} idea={idea} onOpenRecipe={onOpenRecipe} />
          ))
        )}
      </div>
    </AppDrawer>
  );
};

/** El botón de Comidas que abre las ideas: abajo de los filtros, a lo ancho. */
export const RecipeIdeasButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const { t } = useTranslation();

  return (
    <Button
      variant="outline"
      size="sm"
      className="text-primary gap-1.5 self-start rounded-full"
      onClick={onClick}
    >
      <Sparkles className="size-4" />
      {t('meals.ideas.button')}
    </Button>
  );
};
