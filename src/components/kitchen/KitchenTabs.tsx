import { useTranslation } from 'next-i18next';
import React from 'react';

import { cn } from '~/lib/utils';

export const KITCHEN_TABS = ['shopping', 'stock', 'meals'] as const;
export type KitchenTab = (typeof KITCHEN_TABS)[number];

export const isKitchenTab = (value: unknown): value is KitchenTab =>
  'string' === typeof value && (KITCHEN_TABS as readonly string[]).includes(value);

/** Solapas de Cocina, arriba de todo: un toque cambia de lista sin salir de la pantalla. */
export const KitchenTabs: React.FC<{ value: KitchenTab; onChange: (tab: KitchenTab) => void }> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();

  return (
    <div role="tablist" className="bg-muted flex gap-1 rounded-xl p-1">
      {KITCHEN_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={value === tab}
          onClick={() => onChange(tab)}
          className={cn(
            'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
            value === tab ? 'bg-background text-primary shadow-xs' : 'text-muted-foreground',
          )}
        >
          {t(`kitchen.tabs.${tab}`)}
        </button>
      ))}
    </div>
  );
};
