import React, { useCallback, useMemo } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type YearMonth } from '~/lib/stats';
import { averageOfNonZero } from '~/lib/trends';
import { cn } from '~/lib/utils';

const monthLabel = (month: YearMonth, locale: string, style: 'short' | 'long') => {
  // Fecha en UTC formateada en UTC, igual que el selector de mes.
  const label = new Intl.DateTimeFormat(locale, {
    month: style,
    ...('long' === style ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(month.year, month.month - 1, 1)));

  return 'short' === style ? label.replace('.', '').slice(0, 3) : label;
};

const Bar: React.FC<{
  index: number;
  height: number;
  selected: boolean;
  label: string;
  spokenLabel: string;
  compact: boolean;
  onSelect?: (index: number) => void;
}> = ({ index, height, selected, label, spokenLabel, compact, onSelect }) => {
  const handleClick = useCallback(() => onSelect?.(index), [onSelect, index]);
  const Element = onSelect ? 'button' : 'div';

  return (
    <Element
      {...(onSelect
        ? { type: 'button' as const, onClick: handleClick, 'aria-pressed': selected }
        : { role: 'img' })}
      aria-label={spokenLabel}
      className={cn(
        compact
          ? 'flex h-full min-w-0 flex-1 flex-col'
          : 'flex h-full min-w-0 flex-1 flex-col gap-1',
        onSelect &&
          'focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      <span className="flex w-full flex-1 items-end justify-center">
        <span
          className={cn(
            'w-full max-w-5 rounded-t-sm transition-[height]',
            selected ? 'bg-primary' : 'bg-primary/30',
          )}
          style={{ height: `${Math.max(height, 0 < height ? 2 : 0)}%` }}
        />
      </span>
      {compact ? null : (
        <span
          className={cn(
            'h-2.5 text-[10px] leading-none',
            selected ? 'text-foreground font-semibold' : 'text-muted-foreground',
          )}
        >
          {label}
        </span>
      )}
    </Element>
  );
};

/**
 * Barras de un monto mes a mes, con una línea punteada en el promedio de los meses con gastos.
 * Con `onSelect`, cada barra es un botón que elige ese mes.
 */
export const MonthlyBars: React.FC<{
  months: YearMonth[];
  values: bigint[];
  selectedIndex: number;
  currency: string;
  onSelect?: (index: number) => void;
  compact?: boolean;
  className?: string;
}> = ({ months, values, selectedIndex, currency, onSelect, compact = false, className }) => {
  const { i18n, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(currency);

  const positive = useMemo(() => values.map((value) => (0n < value ? value : 0n)), [values]);
  const max = useMemo(
    () => positive.reduce((acc, value) => (value > acc ? value : acc), 0n),
    [positive],
  );
  const average = useMemo(() => averageOfNonZero(positive), [positive]);
  const toPercent = (value: bigint) => (0n === max ? 0 : (Number(value) / Number(max)) * 100);

  return (
    <div className={cn('relative', compact ? 'h-12' : 'h-36', className)}>
      {0n < average ? (
        <div
          aria-hidden="true"
          className="border-muted-foreground/50 pointer-events-none absolute inset-x-0 border-t border-dashed"
          // Las barras no ocupan todo el alto: abajo van los nombres de los meses.
          style={{
            bottom: compact
              ? `${toPercent(average)}%`
              : `calc(${toPercent(average) / 100} * (100% - 14px) + 14px)`,
          }}
        />
      ) : null}
      <div className="flex h-full items-end gap-1">
        {months.map((month, index) => (
          <Bar
            key={`${month.year}-${month.month}`}
            index={index}
            height={toPercent(positive[index] ?? 0n)}
            selected={index === selectedIndex}
            label={monthLabel(month, i18n.language, 'short')}
            spokenLabel={`${monthLabel(month, i18n.language, 'long')}: ${toUIString(values[index] ?? 0n)}`}
            compact={compact}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
};
