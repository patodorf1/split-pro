import { ShoppingBasket, Trash2 } from 'lucide-react';
import { type User } from 'next-auth';
import React, { useCallback, useMemo } from 'react';
import { toast } from 'sonner';

import { SimpleConfirmationDialog } from '~/components/SimpleConfirmationDialog';
import { AddShoppingItem } from '~/components/shopping/AddShoppingItem';
import { ShoppingItemActions } from '~/components/shopping/ShoppingItemActions';
import { type ShoppingItem, ShoppingItemRow } from '~/components/shopping/ShoppingItemRow';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Button } from '~/components/ui/button';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { api } from '~/utils/api';

/** Cada cuánto se vuelve a mirar la lista mientras la página está a la vista. */
const POLL_INTERVAL_MS = 10_000;

/** Solapa Compras de Cocina: la lista de la casa, tal cual estaba cuando era la página entera. */
export const ShoppingTab: React.FC<{ groupId: number; user: User }> = ({ groupId, user }) => {
  const { t } = useTranslationWithUtils();
  const utils = api.useUtils();

  const listQuery = api.shopping.getList.useQuery(
    { groupId },
    {
      refetchOnWindowFocus: true,
      refetchInterval: POLL_INTERVAL_MS,
    },
  );

  const onMutationError = useCallback(() => toast.error(t('shopping.toast.error')), [t]);

  const setChecked = api.shopping.setChecked.useMutation({
    // Update optimista: en el súper el tilde tiene que sentirse instantáneo.
    onMutate: async ({ id, checked }) => {
      const input = { groupId };

      await utils.shopping.getList.cancel(input);
      const previous = utils.shopping.getList.getData(input);

      utils.shopping.getList.setData(input, (old) => {
        if (!old) {
          return old;
        }

        const item = (checked ? old.pending : old.checked).find((entry) => entry.id === id);

        if (!item) {
          return old;
        }

        const moved: ShoppingItem = {
          ...item,
          checked,
          checkedAt: checked ? new Date() : null,
          checkedByUser: checked
            ? {
                id: user.id,
                name: user.name ?? null,
                email: user.email ?? null,
                image: user.image ?? null,
              }
            : null,
        };

        return checked
          ? {
              ...old,
              pending: old.pending.filter((entry) => entry.id !== id),
              checked: [moved, ...old.checked],
              checkedTotal: old.checkedTotal + 1,
            }
          : {
              ...old,
              checked: old.checked.filter((entry) => entry.id !== id),
              pending: [moved, ...old.pending],
              checkedTotal: Math.max(0, old.checkedTotal - 1),
            };
      });

      return { previous };
    },
    onSuccess: (data) => {
      if (data.stock?.created) {
        toast(
          t('kitchen.toast.to_stock', {
            name: data.stock.name,
            section: t(`stock.sections.${data.stock.section}`),
          }),
        );
      }
      void utils.stock.getList.invalidate({ groupId });
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.shopping.getList.setData({ groupId }, context.previous);
      }
      onMutationError();
    },
    onSettled: () => {
      void utils.shopping.getList.invalidate({ groupId });
    },
  });

  const clearChecked = api.shopping.clearChecked.useMutation({
    onSuccess: ({ count }) => {
      toast.success(t('shopping.toast.cleared', { count }));
      void utils.shopping.getList.invalidate({ groupId });
    },
    onError: onMutationError,
  });

  const onToggle = useCallback(
    (item: ShoppingItem) => {
      setChecked.mutate({ groupId, id: item.id, checked: !item.checked });
    },
    [groupId, setChecked],
  );

  const checkedTotal = listQuery.data?.checkedTotal ?? 0;

  const onClearChecked = useCallback(() => {
    clearChecked.mutate({ groupId });
  }, [clearChecked, groupId]);

  const pending = useMemo(() => listQuery.data?.pending ?? [], [listQuery.data?.pending]);
  const checked = listQuery.data?.checked ?? [];
  const pendingNames = useMemo(() => pending.map((item) => item.name), [pending]);

  const clearButton = (
    <SimpleConfirmationDialog
      title={t('shopping.actions.clear_bought')}
      description={t('shopping.confirm_clear', { count: checkedTotal })}
      hasPermission
      loading={clearChecked.isPending}
      onConfirm={onClearChecked}
      variant="destructive"
    >
      <Button variant="ghost" size="sm" className="text-muted-foreground gap-2 px-0">
        <Trash2 className="size-4" />
        {t('shopping.actions.clear_bought')}
      </Button>
    </SimpleConfirmationDialog>
  );

  return (
    <div className="flex flex-col gap-4 pb-36">
      <div className="bg-background sticky top-0 z-10 py-2">
        <AddShoppingItem groupId={groupId} pendingNames={pendingNames} />
      </div>

      {0 === pending.length && 0 === checkedTotal && !listQuery.isPending ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <ShoppingBasket className="text-primary size-10" />
          <p className="text-base font-medium">{t('shopping.empty.title')}</p>
          <p className="text-muted-foreground max-w-[260px] text-sm">
            {t('shopping.empty.subtitle')}
          </p>
        </div>
      ) : null}

      {0 < pending.length ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>
            {t('shopping.pending')} · {pending.length}
          </SectionLabel>
          <ul className="card-surface divide-border divide-y px-3">
            {pending.map((item) => (
              <ShoppingItemRow
                key={item.id}
                item={item}
                currentUserId={user.id}
                onToggle={onToggle}
                actions={<ShoppingItemActions groupId={groupId} item={item} />}
              />
            ))}
          </ul>
          <p className="text-muted-foreground text-center text-xs">{t('shopping.hint_to_stock')}</p>
        </section>
      ) : null}

      {0 < checkedTotal ? (
        <section className="flex flex-col gap-2">
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="bought" className="border-none">
              <AccordionTrigger className="text-primary py-3">
                {/* Va un span y no un <p>: adentro de un button sólo entra contenido de frase. */}
                <span className="section-label">
                  {t('shopping.bought')} · {checkedTotal}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <ul className="card-surface divide-border divide-y px-3">
                  {checked.map((item) => (
                    <ShoppingItemRow
                      key={item.id}
                      item={item}
                      currentUserId={user.id}
                      onToggle={onToggle}
                      actions={<ShoppingItemActions groupId={groupId} item={item} />}
                    />
                  ))}
                </ul>
                <div className="mt-3 flex justify-end">{clearButton}</div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      ) : null}
    </div>
  );
};
