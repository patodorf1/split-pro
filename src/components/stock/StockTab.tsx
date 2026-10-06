import { Refrigerator } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { SectionLabel } from '~/components/ui/section-label';
import { STOCK_SECTIONS } from '~/lib/stock';
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

  const listQuery = api.stock.getList.useQuery(
    { groupId },
    { refetchOnWindowFocus: true, refetchInterval: POLL_INTERVAL_MS },
  );

  const refresh = useCallback(() => {
    void utils.stock.getList.invalidate({ groupId });
    void utils.shopping.getList.invalidate({ groupId });
  }, [groupId, utils]);

  const onError = useCallback(() => toast.error(t('stock.toast.error')), [t]);

  const finish = api.stock.finish.useMutation({
    onSuccess: ({ item, addedToShopping }) => {
      toast(
        t(addedToShopping ? 'stock.toast.finished' : 'stock.toast.finished_already', {
          name: item.name,
        }),
      );
      refresh();
    },
    onError,
  });

  const remove = api.stock.remove.useMutation({
    onSuccess: (item) => {
      toast(t('stock.toast.removed', { name: item.name }));
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

      {sections.map(({ section, items }) => (
        <section key={section} className="flex flex-col gap-2">
          <SectionLabel>{t(`stock.sections.${section}`)}</SectionLabel>
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
        </section>
      ))}

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
