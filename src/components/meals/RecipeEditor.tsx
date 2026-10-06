import { Trash2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { SimpleConfirmationDialog } from '~/components/SimpleConfirmationDialog';
import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { Textarea } from '~/components/ui/textarea';
import {
  MAX_RECIPE_BODY_LENGTH,
  MAX_RECIPE_INGREDIENTS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_YIELD_LENGTH,
  RECIPE_KINDS,
  type RecipeKind,
  isRecipeKind,
  splitIngredientText,
} from '~/lib/recipes';
import { type RouterOutputs, api } from '~/utils/api';

export type RecipeDetail = RouterOutputs['recipes']['get'];

/**
 * Alta (sin `recipe`) o edición de una receta: nombre, tipo, rinde, ingredientes principales y
 * paso a paso. Se monta solo cuando está abierto, así cada vez arranca con los datos frescos.
 */
export const RecipeEditor: React.FC<{
  groupId: number;
  recipe?: RecipeDetail;
  defaultKind?: RecipeKind;
  onClose: () => void;
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
}> = ({ groupId, recipe, defaultKind, onClose, onSaved, onDeleted }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [title, setTitle] = useState(recipe?.title ?? '');
  const [kind, setKind] = useState<RecipeKind>(recipe?.kind ?? defaultKind ?? 'MAIN');
  const [yieldText, setYieldText] = useState(recipe?.yieldText ?? '');
  const [ingredients, setIngredients] = useState(
    recipe ? recipe.ingredients.map((ingredient) => ingredient.name).join(', ') : '',
  );
  const [body, setBody] = useState(recipe?.body ?? '');

  const onError = useCallback(
    (error: { data?: { code?: string } | null }) =>
      toast.error(
        'CONFLICT' === error.data?.code ? t('meals.toast.conflict') : t('meals.toast.error'),
      ),
    [t],
  );

  const onSuccess = useCallback(
    ({ id }: { id: string }) => {
      toast.success(t('meals.toast.saved'));
      void utils.recipes.invalidate();
      onClose();
      onSaved?.(id);
    },
    [onClose, onSaved, t, utils],
  );

  const create = api.recipes.create.useMutation({ onSuccess, onError });
  const update = api.recipes.update.useMutation({ onSuccess, onError });
  const remove = api.recipes.remove.useMutation({
    onSuccess: () => {
      toast(t('meals.toast.deleted'));
      void utils.recipes.invalidate();
      onClose();
      onDeleted?.();
    },
    onError,
  });

  const ingredientNames = useMemo(() => splitIngredientText(ingredients), [ingredients]);
  const saving = create.isPending || update.isPending;
  const canSave =
    '' !== title.trim() &&
    0 < ingredientNames.length &&
    ingredientNames.length <= MAX_RECIPE_INGREDIENTS &&
    !saving;

  const onSave = useCallback(() => {
    if (!canSave) {
      return;
    }

    const fields = {
      title: title.trim(),
      kind,
      yieldText: yieldText.trim() || null,
      body,
      ingredients: ingredientNames,
    };

    if (recipe) {
      update.mutate({ groupId, id: recipe.id, ...fields });
    } else {
      create.mutate({ groupId, ...fields });
    }
  }, [body, canSave, create, groupId, ingredientNames, kind, recipe, title, update, yieldText]);

  const onKindChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isRecipeKind(e.target.value)) {
      setKind(e.target.value);
    }
  }, []);

  return (
    <AppDrawer
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={recipe ? t('meals.editor.edit_title') : t('meals.editor.new_title')}
      actionTitle={t('meals.actions.save')}
      actionOnClick={onSave}
      actionDisabled={!canSave}
      shouldCloseOnAction={false}
      className="h-[90dvh]"
      trigger={null}
    >
      <div className="flex flex-col gap-4 px-1 pb-4 text-left">
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('meals.editor.title')}</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_RECIPE_TITLE_LENGTH}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('meals.editor.kind')}</span>
          <NativeSelect value={kind} onChange={onKindChange} className="w-full">
            {RECIPE_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`meals.kinds.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('meals.editor.yield')}</span>
          <Input
            value={yieldText}
            onChange={(e) => setYieldText(e.target.value)}
            placeholder={t('meals.editor.yield_placeholder')}
            maxLength={MAX_RECIPE_YIELD_LENGTH}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('meals.editor.ingredients')}</span>
          <Input
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
            placeholder={t('meals.editor.ingredients_placeholder')}
            autoCapitalize="none"
          />
          <span className="text-muted-foreground text-xs">
            {t('meals.editor.ingredients_hint')}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('meals.editor.body')}</span>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('meals.editor.body_placeholder')}
            maxLength={MAX_RECIPE_BODY_LENGTH}
            rows={12}
          />
          <span className="text-muted-foreground text-xs">{t('meals.editor.body_hint')}</span>
        </label>
        {recipe ? (
          <SimpleConfirmationDialog
            title={t('meals.editor.delete_title')}
            description={t('meals.editor.delete_description', { title: recipe.title })}
            hasPermission
            loading={remove.isPending}
            variant="destructive"
            onConfirm={() => remove.mutate({ groupId, id: recipe.id })}
          >
            <Button variant="ghost" className="text-destructive justify-start gap-2 px-0">
              <Trash2 className="size-4" />
              {t('meals.actions.delete')}
            </Button>
          </SimpleConfirmationDialog>
        ) : null}
      </div>
    </AppDrawer>
  );
};
