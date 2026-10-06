import { ShoppingCart } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { type RouterOutputs, api } from '~/utils/api';

export type MissingIngredient = RouterOutputs['recipes']['get']['missing'][number];

const lower = (name: string) => name.toLocaleLowerCase('es');

/** Cápsulas con lo que falta. En la lista dicen "falta pollo"; en la receta, solo "pollo". */
export const MissingChips: React.FC<{ missing: MissingIngredient[]; withPrefix?: boolean }> = ({
  missing,
  withPrefix = false,
}) => {
  const { t } = useTranslation();

  return (
    <span className="flex flex-wrap gap-1.5">
      {missing.map((ingredient) => (
        <span
          key={ingredient.name}
          className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {withPrefix
            ? t('meals.missing_chip', { name: lower(ingredient.name) })
            : lower(ingredient.name)}
        </span>
      ))}
    </span>
  );
};

/**
 * "Sumar pollo a Compras" (falta una), "Sumar lo que falta a Compras" (varias) o, si todo ya está
 * pendiente, "Ya está todo en Compras" sin poder tocarlo. El servidor vuelve a calcular qué falta.
 */
export const AddMissingButton: React.FC<{
  groupId: number;
  recipeId: string;
  missing: MissingIngredient[];
}> = ({ groupId, recipeId, missing }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const pending = missing.filter((ingredient) => !ingredient.inShopping);

  const add = api.recipes.addMissingToShopping.useMutation({
    onSuccess: ({ added }) => {
      toast(
        0 === added.length
          ? t('meals.toast.already')
          : t('meals.toast.added', { count: added.length, name: added[0] }),
      );
      void utils.recipes.invalidate();
      void utils.shopping.getList.invalidate({ groupId });
    },
    onError: () => toast.error(t('meals.toast.error')),
  });

  const label =
    0 === pending.length
      ? t('meals.add_missing.done')
      : 1 === missing.length
        ? t('meals.add_missing.one', { name: lower(missing[0]?.name ?? '') })
        : t('meals.add_missing.many');

  return (
    <Button
      variant="outline"
      size="sm"
      className="text-primary gap-1.5 rounded-lg"
      disabled={0 === pending.length || add.isPending}
      onClick={() => add.mutate({ groupId, id: recipeId })}
    >
      <ShoppingCart className="size-4" />
      {label}
    </Button>
  );
};
