import { Check } from 'lucide-react';
import React, { useCallback } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cn } from '~/lib/utils';
import { type RouterOutputs } from '~/utils/api';

export type ShoppingItem = RouterOutputs['shopping']['getList']['pending'][number];

/** Nombre corto: alcanza con el primer nombre para saber quién lo pidió. */
const shortName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const ShoppingItemRow: React.FC<{
  item: ShoppingItem;
  currentUserId: number;
  onToggle: (item: ShoppingItem) => void;
  actions?: React.ReactNode;
}> = ({ item, currentUserId, onToggle, actions }) => {
  const { t, displayName } = useTranslationWithUtils();

  const toggle = useCallback(() => onToggle(item), [item, onToggle]);

  const author =
    'ALEXA' === item.source
      ? t('shopping.source.alexa')
      : item.addedByUser
        ? shortName(displayName(item.addedByUser, currentUserId))
        : null;

  return (
    <li className="flex items-center gap-3 py-1">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={item.checked}
        aria-label={item.name}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 active:scale-90',
          item.checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-transparent',
        )}
      >
        <Check className="size-5" strokeWidth={3} />
      </button>

      <button type="button" onClick={toggle} className="min-w-0 flex-1 py-2 text-left">
        <p
          className={cn(
            'truncate text-base transition-all duration-200',
            item.checked && 'text-muted-foreground line-through',
          )}
        >
          {item.name}
          {item.quantity ? (
            <span className="text-muted-foreground ml-2 text-sm">{item.quantity}</span>
          ) : null}
        </p>
        {item.note ? <p className="text-muted-foreground truncate text-xs">{item.note}</p> : null}
      </button>

      {author ? (
        <span className="text-muted-foreground shrink-0 text-[11px] tracking-wide uppercase">
          {author}
        </span>
      ) : null}

      {actions}
    </li>
  );
};
