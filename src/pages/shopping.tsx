import { ShoppingBasket, Trash2 } from 'lucide-react';
import Head from 'next/head';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import MainLayout from '~/components/Layout/MainLayout';
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
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

/** Última lista abierta, para que el celular arranque donde quedó. */
const LAST_GROUP_KEY = 'casa.shopping.lastGroupId';
/** Cada cuánto se vuelve a mirar la lista mientras la página está a la vista. */
const POLL_INTERVAL_MS = 10_000;

const readStorage = (storage: Storage | undefined, key: string): string | null => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeStorage = (storage: Storage | undefined, key: string, value: string | null) => {
  try {
    if (null === value) {
      storage?.removeItem(key);
    } else {
      storage?.setItem(key, value);
    }
  } catch {
    // Modo privado o storage bloqueado: la lista sigue funcionando igual.
  }
};

const ShoppingPage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const utils = api.useUtils();

  const groupsQuery = api.group.getAllGroups.useQuery();

  const groups = useMemo(
    () =>
      (groupsQuery.data ?? [])
        .filter(({ group }) => !group.archivedAt)
        .map(({ group, pinned }) => ({ id: group.id, name: group.name, pinned })),
    [groupsQuery.data],
  );

  const [groupId, setGroupId] = useState<number | null>(null);

  useEffect(() => {
    if (null !== groupId || 0 === groups.length) {
      return;
    }

    const stored = Number(readStorage(globalThis.window?.localStorage, LAST_GROUP_KEY));
    const preferred =
      groups.find((group) => group.id === stored) ??
      groups.find((group) => group.pinned) ??
      groups[0];

    setGroupId(preferred?.id ?? null);
  }, [groupId, groups]);

  const onGroupChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(event.target.value);

    setGroupId(id);
    writeStorage(globalThis.window?.localStorage, LAST_GROUP_KEY, String(id));
  }, []);

  const listQuery = api.shopping.getList.useQuery(
    { groupId: groupId ?? 0 },
    {
      enabled: null !== groupId,
      refetchOnWindowFocus: true,
      refetchInterval: POLL_INTERVAL_MS,
    },
  );

  const onMutationError = useCallback(() => toast.error(t('shopping.toast.error')), [t]);

  const setChecked = api.shopping.setChecked.useMutation({
    // Update optimista: en el súper el tilde tiene que sentirse instantáneo.
    onMutate: async ({ id, checked }) => {
      if (null === groupId) {
        return {};
      }

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
    onError: (_error, _variables, context) => {
      if (null !== groupId && context?.previous) {
        utils.shopping.getList.setData({ groupId }, context.previous);
      }
      onMutationError();
    },
    onSettled: () => {
      if (null !== groupId) {
        void utils.shopping.getList.invalidate({ groupId });
      }
    },
  });

  const clearChecked = api.shopping.clearChecked.useMutation({
    onSuccess: ({ count }) => {
      toast.success(t('shopping.toast.cleared', { count }));
      if (null !== groupId) {
        void utils.shopping.getList.invalidate({ groupId });
      }
    },
    onError: onMutationError,
  });

  const onToggle = useCallback(
    (item: ShoppingItem) => {
      if (null === groupId) {
        return;
      }

      setChecked.mutate({ groupId, id: item.id, checked: !item.checked });
    },
    [groupId, setChecked],
  );

  const checkedTotal = listQuery.data?.checkedTotal ?? 0;

  const onClearChecked = useCallback(() => {
    if (null !== groupId) {
      clearChecked.mutate({ groupId });
    }
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
    <>
      <Head>
        <title>{t('shopping.title')}</title>
      </Head>
      <MainLayout title={t('shopping.title')} loading={groupsQuery.isPending}>
        {0 === groups.length ? (
          <p className="text-muted-foreground mt-10 text-center text-sm">
            {t('shopping.empty.no_groups')}
          </p>
        ) : (
          <div className="flex flex-col gap-4 pb-36">
            {1 < groups.length ? (
              <div className="flex items-center gap-2">
                <SectionLabel>{t('shopping.group_label')}</SectionLabel>
                <NativeSelect
                  value={groupId ?? ''}
                  onChange={onGroupChange}
                  aria-label={t('shopping.group_label')}
                  className="max-w-[220px]"
                >
                  {groups.map((group) => (
                    <NativeSelectOption key={group.id} value={group.id}>
                      {group.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            {null !== groupId ? (
              <div className="bg-background sticky top-0 z-10 py-2">
                <AddShoppingItem groupId={groupId} pendingNames={pendingNames} />
              </div>
            ) : null}

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
                      actions={
                        null !== groupId ? (
                          <ShoppingItemActions groupId={groupId} item={item} />
                        ) : null
                      }
                    />
                  ))}
                </ul>
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
                            actions={
                              null !== groupId ? (
                                <ShoppingItemActions groupId={groupId} item={item} />
                              ) : null
                            }
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
        )}
      </MainLayout>
    </>
  );
};

ShoppingPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default ShoppingPage;
