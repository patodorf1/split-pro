import React from 'react';
import { useTranslation } from 'next-i18next';

import { CategoryIcon } from '~/components/ui/categoryIcons';
import { getCategoryTranslationKey } from '~/lib/stats';
import { cn } from '~/lib/utils';

import { ProgressBar } from './ProgressBar';

/** Translated name of a stored `Expense.category` value. */
export const useCategoryLabel = () => {
  const { t } = useTranslation('categories');

  return (category: string) => t(getCategoryTranslationKey(category));
};

/**
 * One line of a category breakdown: icon, translated name, a value on the right
 * and a proportional bar underneath.
 */
export const CategoryRow: React.FC<{
  category: string;
  label: string;
  value: React.ReactNode;
  barValue: number;
  className?: string;
}> = ({ category, label, value, barValue, className }) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <CategoryIcon category={category} className="text-muted-foreground size-4 shrink-0" />
        <span className="text-foreground truncate text-sm">{label}</span>
      </div>
      <span className="text-foreground shrink-0 text-sm font-medium">{value}</span>
    </div>
    <ProgressBar value={barValue} />
  </div>
);
