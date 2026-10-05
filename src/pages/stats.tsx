import { keepPreviousData } from '@tanstack/react-query';
import { ChevronRightIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import Head from 'next/head';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useCategoryLabel } from '~/components/dashboard/CategoryRow';
import { CurrencyToggle } from '~/components/dashboard/CurrencyToggle';
import { MonthSwitcher } from '~/components/dashboard/MonthSwitcher';
import { SegmentedControl } from '~/components/dashboard/SegmentedControl';
import { SpendingCharts } from '~/components/dashboard/SpendingCharts';
import { useMonthNavigation, useSelectedCurrency, useTimeZone } from '~/components/dashboard/hooks';
import { ExpenseRow } from '~/components/Expense/ExpenseRow';
import MainLayout from '~/components/Layout/MainLayout';
import { Card } from '~/components/ui/card';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { getCategoryColor } from '~/lib/categoryColors';
import { type YearMonth, monthOverMonthChange, percentageOf } from '~/lib/stats';
import { cn } from '~/lib/utils';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

type Scope = 'mine' | 'ours';
type Valuation = 'native' | 'blue';
type CategoryTotals = RouterOutputs['stats']['monthlySummary']['current'][number]['categories'];

const ALL_GROUPS = 'all';
/** Opción del selector de moneda que pasa todo a dólares al blue del día de cada gasto. */
const BLUE_OPTION = 'blue';
const BLUE_CURRENCY = 'USD';
const VALUATION_STORAGE_KEY = 'casa-stats-valuation';

/** Recuerda en el teléfono si se estaba mirando todo en dólares. */
const useRememberedValuation = () => {
  const [valuation, setValuation] = useState<Valuation>('native');

  useEffect(() => {
    try {
      if (BLUE_OPTION === globalThis.window?.localStorage?.getItem(VALUATION_STORAGE_KEY)) {
        setValuation('blue');
      }
    } catch {
      // Sin almacenamiento (modo privado): arranca en moneda original.
    }
  }, []);

  const remember = useCallback((next: Valuation) => {
    setValuation(next);
    try {
      globalThis.window?.localStorage?.setItem(VALUATION_STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento: vale solo mientras la pantalla esté abierta.
    }
  }, []);

  return [valuation, remember] as const;
};
const EMPTY_CATEGORIES: CategoryTotals = [];

const CategoryExpenses: React.FC<{
  month: YearMonth;
  timeZone: string;
  groupId: number | null;
  currency: string;
  category: string;
  scope: Scope;
  valuation: Valuation;
}> = ({ month, timeZone, groupId, currency, category, scope, valuation }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const expensesQuery = api.stats.categoryExpenses.useQuery({
    year: month.year,
    month: month.month,
    timeZone,
    groupId,
    currency,
    category,
    valuation,
  });

  const { toUIString } = getCurrencyHelpersCached(currency);

  if (expensesQuery.isPending) {
    return <p className="text-muted-foreground py-2 text-xs">{t('dashboard.stats.loading')}</p>;
  }

  if (!expensesQuery.data?.length) {
    return <p className="text-muted-foreground py-2 text-xs">{t('dashboard.stats.empty')}</p>;
  }

  return (
    <ul className="pb-1">
      {expensesQuery.data.map((expense) => (
        <li key={expense.id}>
          <ExpenseRow
            href={`/expenses/${expense.id}`}
            title={expense.name}
            category={expense.category}
            payer={expense.paidByUser}
            date={expense.expenseDate}
            amount={toUIString('mine' === scope ? expense.mine : expense.amount)}
          />
        </li>
      ))}
    </ul>
  );
};

/** Porcentaje del total, redondeado; lo que no llega al 1% se muestra como "<1%". */
const formatShare = (amount: bigint, total: bigint) => {
  const share = percentageOf(amount, total);
  const rounded = Math.round(share);

  if (0 === rounded && 0 < share) {
    return '<1%';
  }

  return `${rounded}%`;
};

const CategoryHeaderButton: React.FC<{
  category: string;
  label: string;
  amount: string;
  share: string;
  count: number;
  expanded: boolean;
  onToggle: (category: string) => void;
}> = ({ category, label, amount, share, count, expanded, onToggle }) => {
  const { t } = useTranslationWithUtils();
  const handleClick = useCallback(() => onToggle(category), [onToggle, category]);
  const dotStyle = useMemo(() => ({ backgroundColor: getCategoryColor(category) }), [category]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-expanded={expanded}
      className="focus-visible:ring-ring flex w-full items-center gap-3 rounded-md py-3 text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={dotStyle} />
      <CategoryIcon category={category} size={22} />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-[15px] leading-tight font-medium">
          {label}
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {t('expense_row.expenses_count', { count })}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="text-foreground block text-[15px] leading-tight font-bold tabular-nums">
          {amount}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">{share}</span>
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className={cn(
          'text-muted-foreground size-4 shrink-0 transition-transform',
          expanded && 'rotate-90',
        )}
      />
    </button>
  );
};

const CategoryBreakdown: React.FC<{
  categories: CategoryTotals;
  scope: Scope;
  month: YearMonth;
  timeZone: string;
  groupId: number | null;
  currency: string;
  valuation: Valuation;
  total: bigint;
}> = ({ categories, scope, month, timeZone, groupId, currency, valuation, total }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const categoryLabel = useCategoryLabel();
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = useCallback(
    (category: string) => setExpanded((current) => (current === category ? null : category)),
    [],
  );

  const sorted = useMemo(
    () =>
      categories
        .map((entry) => ({ category: entry.category, amount: entry[scope], count: entry.count }))
        .filter(({ amount }) => 0n !== amount)
        .sort((a, b) => (a.amount > b.amount ? -1 : 1)),
    [categories, scope],
  );

  const { toUIString } = getCurrencyHelpersCached(currency);

  return (
    <section>
      <SectionLabel className="mb-2 px-1">{t('dashboard.stats.by_category')}</SectionLabel>
      <Card className="py-1">
        {0 === sorted.length ? (
          <p className="text-muted-foreground py-3 text-sm">{t('dashboard.stats.empty')}</p>
        ) : (
          <ul className="divide-border divide-y">
            {sorted.map(({ category, amount, count }) => (
              <li key={category}>
                <CategoryHeaderButton
                  category={category}
                  label={categoryLabel(category)}
                  amount={toUIString(amount)}
                  share={formatShare(amount, total)}
                  count={count}
                  expanded={expanded === category}
                  onToggle={toggle}
                />
                {expanded === category ? (
                  <CategoryExpenses
                    month={month}
                    timeZone={timeZone}
                    groupId={groupId}
                    currency={currency}
                    category={category}
                    scope={scope}
                    valuation={valuation}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
};

const MonthComparison: React.FC<{ current: bigint; previous: bigint; currency: string }> = ({
  current,
  previous,
  currency,
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const change = monthOverMonthChange(current, previous);

  if (null === change) {
    return null;
  }

  const rounded = Math.round(Math.abs(change));
  const isUp = 0 < change;
  const Icon = isUp ? TrendingUpIcon : TrendingDownIcon;

  return (
    <Card className="flex items-center gap-2">
      <Icon className={cn('size-4 shrink-0', isUp ? 'text-negative' : 'text-positive')} />
      <p className="text-muted-foreground text-sm">
        {0 === rounded
          ? t('dashboard.stats.change.same')
          : t(`dashboard.stats.change.${isUp ? 'up' : 'down'}`, { percent: rounded })}{' '}
        <span className="text-muted-foreground/70">
          ({getCurrencyHelpersCached(currency).toUIString(previous)})
        </span>
      </p>
    </Card>
  );
};

const StatsPage: NextPageWithUser = ({ user }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const timeZone = useTimeZone();
  const { selected, currentMonth, canGoForward, goBackward, goForward, goTo } =
    useMonthNavigation(timeZone);

  const [scope, setScope] = useState<Scope>('mine');
  const [valuation, setValuation] = useRememberedValuation();
  const [group, setGroup] = useState<string>(ALL_GROUPS);
  const groupId = ALL_GROUPS === group ? null : Number(group);

  const groupsQuery = api.group.getAllGroups.useQuery();
  // Al cambiar de mes se sigue viendo el anterior mientras carga: la pantalla no salta arriba.
  const summaryQuery = api.stats.monthlySummary.useQuery(
    {
      year: selected.year,
      month: selected.month,
      timeZone,
      groupId,
      valuation,
    },
    { placeholderData: keepPreviousData },
  );

  // Monedas en que se cargaron los gastos del mes: siguen siendo las opciones aunque se vea en
  // Dólares, para poder volver.
  const currencies = useMemo(() => summaryQuery.data?.currencies ?? [], [summaryQuery.data]);
  const [nativeCurrency, setCurrency] = useSelectedCurrency(currencies, user.currency);
  const inDollars = 'blue' === valuation;
  const currency = inDollars ? BLUE_CURRENCY : nativeCurrency;

  const totals = summaryQuery.data?.current.find((entry) => entry.currency === currency);
  const previousTotals = summaryQuery.data?.previous.find((entry) => entry.currency === currency);

  const scopeOptions = useMemo(
    () => [
      { value: 'mine' as const, label: t('dashboard.stats.scope.mine') },
      { value: 'ours' as const, label: t('dashboard.stats.scope.ours') },
    ],
    [t],
  );

  const handleGroupChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => setGroup(event.target.value),
    [],
  );

  const blueOptions = useMemo(
    () =>
      currencies.includes('ARS') || inDollars
        ? [
            {
              value: BLUE_OPTION,
              label: t('spending_charts.blue.option'),
              title: t('spending_charts.blue.option_title'),
            },
          ]
        : [],
    [currencies, inDollars, t],
  );

  const handleCurrencyChange = useCallback(
    (value: string) => {
      if (BLUE_OPTION === value) {
        setValuation('blue');
        return;
      }
      setValuation('native');
      setCurrency(value);
    },
    [setValuation, setCurrency],
  );

  const actions = useMemo(
    () => (
      <CurrencyToggle
        currencies={currencies}
        value={inDollars ? BLUE_OPTION : currency}
        onChange={handleCurrencyChange}
        extraOptions={blueOptions}
      />
    ),
    [currencies, inDollars, currency, handleCurrencyChange, blueOptions],
  );

  const total = totals?.[scope] ?? 0n;

  return (
    <>
      <Head>
        <title>{t('dashboard.stats.title')}</title>
      </Head>
      <MainLayout
        title={t('dashboard.stats.title')}
        actions={actions}
        loading={summaryQuery.isPending && !summaryQuery.data}
      >
        <div className="flex flex-col gap-4 pb-8">
          <Card>
            <MonthSwitcher
              month={selected}
              canGoForward={canGoForward}
              onPrevious={goBackward}
              onNext={goForward}
            />

            <SegmentedControl
              className="mt-3"
              options={scopeOptions}
              value={scope}
              onChange={setScope}
              label={t('dashboard.stats.scope.label')}
            />

            <p className="text-foreground mt-4 text-center text-3xl font-semibold">
              {getCurrencyHelpersCached(currency || user.currency).toUIString(total)}
            </p>
            {inDollars ? (
              <p className="text-muted-foreground mt-1 text-center text-xs">
                {summaryQuery.isError && 'dolar_blue_unavailable' === summaryQuery.error.message
                  ? t('spending_charts.blue.unavailable')
                  : t('spending_charts.blue.note')}
              </p>
            ) : null}

            {1 < (groupsQuery.data?.length ?? 0) ? (
              <NativeSelect
                size="sm"
                className="mt-4 w-full"
                value={group}
                onChange={handleGroupChange}
                aria-label={t('dashboard.stats.group')}
              >
                <NativeSelectOption value={ALL_GROUPS}>
                  {t('dashboard.stats.all_groups')}
                </NativeSelectOption>
                {groupsQuery.data?.map(({ group: g }) => (
                  <NativeSelectOption key={g.id} value={String(g.id)}>
                    {g.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
          </Card>

          <CategoryBreakdown
            categories={totals?.categories ?? EMPTY_CATEGORIES}
            scope={scope}
            month={selected}
            timeZone={timeZone}
            groupId={groupId}
            currency={currency || user.currency}
            valuation={valuation}
            total={total}
          />

          <MonthComparison
            current={total}
            previous={previousTotals?.[scope] ?? 0n}
            currency={currency || user.currency}
          />

          <SpendingCharts
            selected={selected}
            currentMonth={currentMonth}
            onSelectMonth={goTo}
            timeZone={timeZone}
            groupId={groupId}
            currency={currency || user.currency}
            scope={scope}
            valuation={valuation}
          />
        </div>
      </MainLayout>
    </>
  );
};

StatsPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common', 'categories']);

export default StatsPage;
