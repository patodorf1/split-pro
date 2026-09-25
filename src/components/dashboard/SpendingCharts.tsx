import { keepPreviousData } from '@tanstack/react-query';
import { ChevronDownIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

import { useCategoryLabel } from '~/components/dashboard/CategoryRow';
import { formatMonthLabel } from '~/components/dashboard/MonthSwitcher';
import { MonthlyBars } from '~/components/dashboard/MonthlyBars';
import { Card } from '~/components/ui/card';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type YearMonth, compareYearMonth } from '~/lib/stats';
import {
  TREND_BASELINE_MONTHS,
  TREND_FETCH_MONTHS,
  averageOfNonZero,
  categoryTrends,
  indexOfMonth,
  monthsEndingAt,
  trendWindowEnd,
} from '~/lib/trends';
import { cn } from '~/lib/utils';
import { type RouterOutputs, api } from '~/utils/api';

type Scope = 'mine' | 'ours';
type Valuation = 'native' | 'blue';
type TrendSeries = RouterOutputs['stats']['monthlyTrend'][number];

/** Categorías que se ven antes de tocar "Ver todas". */
const TRENDS_PREVIEW = 6;

const ChangeBadge: React.FC<{ change: number | null }> = ({ change }) => {
  const { t } = useTranslationWithUtils();

  if (null === change) {
    return (
      <span className="text-muted-foreground text-xs font-medium">
        {t('spending_charts.trends.new')}
      </span>
    );
  }

  const rounded = Math.round(change);
  if (0 === rounded) {
    return <span className="text-muted-foreground text-xs font-medium">=</span>;
  }

  const isUp = 0 < rounded;
  const Icon = isUp ? TrendingUpIcon : TrendingDownIcon;

  return (
    <span
      className={cn(
        'flex items-center gap-0.5 text-xs font-semibold tabular-nums',
        isUp ? 'text-negative' : 'text-positive',
      )}
    >
      <Icon className="size-3.5" />
      {isUp ? '+' : '−'}
      {Math.abs(rounded)}%
    </span>
  );
};

const TrendRow: React.FC<{
  category: string;
  current: bigint;
  baseline: bigint;
  change: number | null;
  values: bigint[];
  months: YearMonth[];
  selectedIndex: number;
  currency: string;
  expanded: boolean;
  onToggle: (category: string) => void;
}> = ({
  category,
  current,
  baseline,
  change,
  values,
  months,
  selectedIndex,
  currency,
  expanded,
  onToggle,
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const categoryLabel = useCategoryLabel();
  const { toUIString } = getCurrencyHelpersCached(currency);
  const handleClick = useCallback(() => onToggle(category), [onToggle, category]);

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={expanded}
        className="focus-visible:ring-ring flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CategoryIcon category={category} className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0">
            <span className="text-foreground block truncate text-sm">
              {categoryLabel(category)}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {toUIString(current)} ·{' '}
              {t('spending_charts.trends.before', { amount: toUIString(baseline) })}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <ChangeBadge change={change} />
          <ChevronDownIcon
            className={cn(
              'text-muted-foreground size-3.5 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </span>
      </button>
      {expanded ? (
        <MonthlyBars
          className="mt-2"
          months={months}
          values={values}
          selectedIndex={selectedIndex}
          currency={currency}
          compact
        />
      ) : null}
    </li>
  );
};

/**
 * Sección de gráficos de /stats: las barras de lo gastado en los últimos 12 meses y la lista de
 * categorías que más subieron o bajaron en el mes elegido.
 */
export const SpendingCharts: React.FC<{
  selected: YearMonth;
  currentMonth: YearMonth;
  onSelectMonth: (month: YearMonth) => void;
  timeZone: string;
  groupId: number | null;
  currency: string;
  scope: Scope;
  valuation: Valuation;
}> = ({ selected, currentMonth, onSelectMonth, timeZone, groupId, currency, scope, valuation }) => {
  const { t, i18n, getCurrencyHelpersCached } = useTranslationWithUtils();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const end = trendWindowEnd(selected, currentMonth);
  const windowEnd = useMemo(() => ({ year: end.year, month: end.month }), [end.year, end.month]);
  const trendQuery = api.stats.monthlyTrend.useQuery(
    {
      year: windowEnd.year,
      month: windowEnd.month,
      timeZone,
      groupId,
      valuation,
      months: TREND_FETCH_MONTHS,
    },
    { placeholderData: keepPreviousData },
  );

  const allMonths = useMemo(() => monthsEndingAt(windowEnd, TREND_FETCH_MONTHS), [windowEnd]);
  const visibleMonths = useMemo(() => allMonths.slice(TREND_BASELINE_MONTHS), [allMonths]);
  const series: TrendSeries | undefined = trendQuery.data?.find(
    (entry) => entry.currency === currency,
  );

  const selectedIndex = indexOfMonth(allMonths, selected);
  const visibleValues = useMemo(
    () => (series?.[scope] ?? []).slice(TREND_BASELINE_MONTHS),
    [series, scope],
  );

  const trends = useMemo(
    () =>
      categoryTrends(
        (series?.categories ?? []).map((entry) => ({
          category: entry.category,
          values: entry[scope],
        })),
        selectedIndex,
      ),
    [series, scope, selectedIndex],
  );

  const handleSelect = useCallback(
    (index: number) => {
      const month = visibleMonths[index];
      if (month) {
        onSelectMonth(month);
      }
    },
    [visibleMonths, onSelectMonth],
  );
  const toggle = useCallback(
    (category: string) => setExpanded((current) => (current === category ? null : category)),
    [],
  );
  const toggleShowAll = useCallback(() => setShowAll((value) => !value), []);

  if (trendQuery.isPending) {
    return (
      <Card>
        <p className="text-muted-foreground text-sm">{t('dashboard.stats.loading')}</p>
      </Card>
    );
  }

  if (trendQuery.isError) {
    return (
      <Card>
        <p className="text-muted-foreground text-sm">
          {'dolar_blue_unavailable' === trendQuery.error.message
            ? t('spending_charts.blue.unavailable')
            : t('spending_charts.error')}
        </p>
      </Card>
    );
  }

  if (!series || 0 === visibleValues.length) {
    return null;
  }

  const { toUIString } = getCurrencyHelpersCached(currency);
  const average = averageOfNonZero(visibleValues);
  const inProgress = 0 === compareYearMonth(selected, currentMonth);
  const shownTrends = showAll ? trends : trends.slice(0, TRENDS_PREVIEW);

  return (
    <>
      <Card>
        <SectionLabel>{t('spending_charts.monthly.title')}</SectionLabel>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('spending_charts.monthly.average', { amount: toUIString(average) })}
        </p>
        <MonthlyBars
          className="mt-4"
          months={visibleMonths}
          values={visibleValues}
          selectedIndex={selectedIndex - TREND_BASELINE_MONTHS}
          currency={currency}
          onSelect={handleSelect}
        />
        <p className="text-muted-foreground mt-3 text-center text-xs">
          {t('spending_charts.monthly.hint')}
        </p>
      </Card>

      {0 < trends.length ? (
        <Card>
          <SectionLabel>{t('spending_charts.trends.title')}</SectionLabel>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('spending_charts.trends.subtitle', {
              month: formatMonthLabel(selected, i18n.language),
              count: TREND_BASELINE_MONTHS,
            })}
            {inProgress ? ` ${t('spending_charts.trends.in_progress')}` : ''}
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {shownTrends.map((trend) => (
              <TrendRow
                key={trend.category}
                {...trend}
                values={
                  series.categories
                    .find((entry) => entry.category === trend.category)
                    ?.[scope].slice(TREND_BASELINE_MONTHS) ?? []
                }
                months={visibleMonths}
                selectedIndex={selectedIndex - TREND_BASELINE_MONTHS}
                currency={currency}
                expanded={expanded === trend.category}
                onToggle={toggle}
              />
            ))}
          </ul>
          {TRENDS_PREVIEW < trends.length ? (
            <button
              type="button"
              onClick={toggleShowAll}
              className="text-primary mt-4 text-xs font-medium"
            >
              {showAll
                ? t('spending_charts.trends.show_less')
                : t('spending_charts.trends.show_all')}
            </button>
          ) : null}
        </Card>
      ) : null}
    </>
  );
};
