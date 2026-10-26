import { ChevronDown, Refrigerator } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { toastMove } from '~/components/kitchen/moveToast';
import { STOCK_SECTIONS, type StockSection } from '~/lib/stock';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { AddStockItem } from './AddStockItem';
import { type StockItem, StockItemEditor } from './StockItemEditor';
import { StockItemRow } from './StockItemRow';

/** Mismo ritmo que Compras: así lo que carga Belu aparece solo. */
const POLL_INTERVAL_MS = 10_000;

export const StockTab: React.FC<{ groupId: number }> = ({ groupId }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [editing, setEditing] = useState<StockItem | null>(null);
  /** Grupos plegados a mano. Todos arrancan abiertos, como en Comidas. */
  const [closed, setClosed] = useState<ReadonlySet<StockSection>>(() => new Set());

  const toggleSection = useCallback(
    (section: StockSection) =>
      setClosed((current) => {
        const next = new Set(current);
        if (!next.delete(section)) {
          next.add(section);
        }
        return next;
      }),
    [],
  );

  const listQuery = api.stock.getList.useQuery(
    { groupId },
    { refetchOnWindowFocus: true, refetchInterval: POLL_INTERVAL_MS },
  );

  const refresh = useCallback(() => {
    void utils.stock.getList.invalidate({ groupId });
    void utils.shopping.getList.invalidate({ groupId });
  }, [groupId, utils]);

  const onError = useCallback(() => toast.error(t('stock.toast.error')), [t]);

  const restore = api.stock.restore.useMutation({ onSuccess: refresh, onError });

  /** Deshacer: vuelve al Stock en su sección y sale de Compras lo que "Se acabó" anotó. */
  const undo = useCallback(
    (item: StockItem, shoppingItemId?: string | null) =>
      restore.mutate({
        groupId,
        name: item.name,
        note: item.note,
        section: item.section,
        shoppingItemId: shoppingItemId ?? undefined,
      }),
    [groupId, restore],
  );

  const finish = api.stock.finish.useMutation({
    onSuccess: ({ item, addedToShopping, shoppingItemId }) => {
      toastMove(
        t(addedToShopping ? 'stock.toast.finished' : 'stock.toast.finished_already', {
          name: item.name,
        }),
        t('kitchen.toast.undo'),
        () => undo(item, shoppingItemId),
      );
      refresh();
    },
    onError,
  });

  const remove = api.stock.remove.useMutation({
    onSuccess: (item) => {
      toastMove(t('stock.toast.removed', { name: item.name }), t('kitchen.toast.undo'), () =>
        undo(item),
      );
      refresh();
    },
    onError,
  });

  const onFinish = useCallback(
    (item: StockItem) => finish.mutate({ groupId, id: item.id }),
    [finish, groupId],
  );
  const onRemove = useCallback(
    (item: StockItem) => remove.mutate({ groupId, id: item.id }),
    [groupId, remove],
  );

  const sections = useMemo(() => {
    const items = listQuery.data ?? [];
    return STOCK_SECTIONS.map((section) => ({
      section,
      items: items.filter((item) => item.section === section),
    })).filter(({ items: inSection }) => 0 < inSection.length);
  }, [listQuery.data]);

  return (
    <div className="flex flex-col gap-4 pb-36">
      <div className="bg-background sticky top-0 z-10 py-2">
        <AddStockItem groupId={groupId} />
      </div>

      {0 === sections.length && !listQuery.isPending ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <Refrigerator className="text-primary size-10" />
          <p className="text-base font-medium">{t('stock.empty.title')}</p>
          <p className="text-muted-foreground max-w-[260px] text-sm">{t('stock.empty.subtitle')}</p>
        </div>
      ) : null}

      {sections.map(({ section, items }) => {
        const isOpen = !closed.has(section);

        return (
          <section key={section} className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggleSection(section)}
              className="flex items-center justify-between text-left"
            >
              <span className="section-label flex items-center gap-1.5">
                {t(`stock.sections.${section}`)}
                <span className="text-muted-foreground font-normal">{items.length}</span>
              </span>
              <ChevronDown
                className={cn(
                  'text-muted-foreground size-4 transition-transform',
                  isOpen && 'rotate-180',
                )}
              />
            </button>
            {isOpen ? (
              <ul className="card-surface divide-border divide-y overflow-hidden">
                {items.map((item) => (
                  <StockItemRow
                    key={item.id}
                    item={item}
                    onEdit={setEditing}
                    onFinish={onFinish}
                    onRemove={onRemove}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      {0 < sections.length ? (
        <p className="text-muted-foreground text-center text-xs">{t('stock.hint')}</p>
      ) : null}

      {editing ? (
        <StockItemEditor
          groupId={groupId}
          item={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  );
};
