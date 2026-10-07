import { ShoppingCart } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React from 'react';

import { Button } from '~/components/ui/button';

import { type StockItem } from './StockItemEditor';
import { SwipeToRemove } from './SwipeToRemove';

/** Fila del Stock: tocar el nombre edita, el carrito lo manda a Compras, deslizar lo saca. */
export const StockItemRow: React.FC<{
  item: StockItem;
  onEdit: (item: StockItem) => void;
  onFinish: (item: StockItem) => void;
  onRemove: (item: StockItem) => void;
}> = ({ item, onEdit, onFinish, onRemove }) => {
  const { t } = useTranslation();

  return (
    <li>
      <SwipeToRemove label={t('stock.actions.remove')} onRemove={() => onRemove(item)}>
        <div className="flex items-center gap-3 px-3 py-1">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="min-w-0 flex-1 py-2 text-left"
          >
            <p className="truncate text-base">{item.name}</p>
            {item.note ? (
              <p className="text-muted-foreground truncate text-xs">{item.note}</p>
            ) : null}
          </button>
          <Button
            variant="outline"
            size="icon"
            className="text-primary size-9 shrink-0 rounded-full"
            onClick={() => onFinish(item)}
            aria-label={t('stock.actions.finished')}
          >
            <ShoppingCart className="size-4" />
          </Button>
        </div>
      </SwipeToRemove>
    </li>
  );
};
