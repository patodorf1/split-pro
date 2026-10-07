import { Check, Plus, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';
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

/** "coliflor y tomate", "pollo, huevo y pan rallado". */
const joinNames = (names: string[]) =>
  new Intl.ListFormat('es', { style: 'long', type: 'conjunction' }).format(names.map(lower));

/**
 * Manda lo que falta a Compras, después de preguntar "¿Agrego coliflor y tomate a Compras?". En la
 * tarjeta es un botón chico (+ y carrito) abajo a la derecha; en la receta, con texto. Si todo ya
 * está pendiente en Compras no se puede tocar. El servidor vuelve a calcular qué falta.
 */
export const AddMissingButton: React.FC<{
  groupId: number;
  recipeId: string;
  missing: MissingIngredient[];
  compact?: boolean;
}> = ({ groupId, recipeId, missing, compact = false }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);
  const pending = missing.filter((ingredient) => !ingredient.inShopping);
  const done = 0 === pending.length;

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

  const label = done
    ? t('meals.add_missing.done')
    : 1 === missing.length
      ? t('meals.add_missing.one', { name: lower(missing[0]?.name ?? '') })
      : t('meals.add_missing.many');

  return (
    <>
      {compact ? (
        <Button
          variant="outline"
          size="sm"
          className="text-primary h-9 gap-0.5 rounded-full px-2.5"
          disabled={done || add.isPending}
          onClick={(event) => {
            event.stopPropagation();
            setConfirming(true);
          }}
          aria-label={label}
          title={label}
        >
          {done ? <Check className="size-4" /> : <Plus className="size-4" />}
          <ShoppingCart className="size-4" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="text-primary gap-1.5 rounded-lg"
          disabled={done || add.isPending}
          onClick={() => setConfirming(true)}
        >
          <ShoppingCart className="size-4" />
          {label}
        </Button>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('meals.add_missing.confirm', {
                names: joinNames(pending.map((ingredient) => ingredient.name)),
              })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('meals.add_missing.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => add.mutate({ groupId, id: recipeId })}>
              <ShoppingCart className="mr-1 size-4" />
              {t('meals.add_missing.confirm_action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
