import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import React, { useMemo } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type YearMonth } from '~/lib/stats';
import { cn } from '~/lib/utils';

export const formatMonthLabel = (month: YearMonth, locale: string): string => {
  /*
   * The date is built in UTC, so it must be formatted in UTC too: formatting
   * it in a negative-offset zone would fall back to the previous month.
   */
  const label = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(month.year, month.month - 1, 1)));

  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
};

export const MonthSwitcher: React.FC<{
  month: YearMonth;
  canGoForward: boolean;
  onPrevious: () => void;
  onNext: () => void;
}> = ({ month, canGoForward, onPrevious, onNext }) => {
  const { t, i18n } = useTranslationWithUtils();
  const label = useMemo(() => formatMonthLabel(month, i18n.language), [month, i18n.language]);

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onPrevious}
        aria-label={t('dashboard.stats.previous_month')}
        className="text-primary focus-visible:ring-ring rounded-full p-2 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronLeftIcon className="size-5" />
      </button>
      <span aria-live="polite" className="text-foreground text-sm font-medium">
        {label}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!canGoForward}
        aria-label={t('dashboard.stats.next_month')}
        className={cn(
          'focus-visible:ring-ring rounded-full p-2 focus-visible:ring-2 focus-visible:outline-none',
          canGoForward ? 'text-primary' : 'text-muted-foreground/40',
        )}
      >
        <ChevronRightIcon className="size-5" />
      </button>
    </div>
  );
};
