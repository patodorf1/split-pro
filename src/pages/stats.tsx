import { ChevronDownIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';

import { CategoryRow, useCategoryLabel } from '~/components/dashboard/CategoryRow';
import { CurrencyToggle } from '~/components/dashboard/CurrencyToggle';
import { DashboardCard, SectionLabel } from '~/components/dashboard/DashboardCard';
import { MonthSwitcher } from '~/components/dashboard/MonthSwitcher';
import { SegmentedControl } from '~/components/dashboard/SegmentedControl';
import { useMonthNavigation, useSelectedCurrency, useTimeZone } from '~/components/dashboard/hooks';
import MainLayout from '~/components/Layout/MainLayout';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type YearMonth, monthOverMonthChange, percentageOf } from '~/lib/stats';
import { cn } from '~/lib/utils';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

type Scope = 'mine' | 'ours';
type CategoryTotals = RouterOutputs['stats']['monthlySummary']['current'][number]['categories'];

const ALL_GROUPS = 'all';
const EMPTY_CATEGORIES: CategoryTotals = [];

const CategoryExpenses: React.FC<{
  month: YearMonth;
  timeZone: string;
  groupId: number | null;
  currency: string;
  category: string;
  scope: Scope;
}> = ({ month, timeZone, groupId, currency, category, scope }) => {
  const { t, toUIDate, getCurrencyHelpersCached } = useTranslationWithUtils();
  const expensesQuery = api.stats.categoryExpenses.useQuery({
    year: month.year,
    month: month.month,
    timeZone,
    groupId,
    currency,
    category,
  });

  const { toUIString } = getCurrencyHelpersCached(currency);

  if (expensesQuery.isPending) {
    return <p className="text-muted-foreground py-2 text-xs">{t('dashboard.stats.loading')}</p>;
  }

  if (!expensesQuery.data?.length) {
    return <p className="text-muted-foreground py-2 text-xs">{t('dashboard.stats.empty')}</p>;
  }

  return (
    <ul className="border-border mt-1 flex flex-col gap-2 border-l pl-3">
      {expensesQuery.data.map((expense) => (
        <li key={expense.id}>
          <Link
            href={`/expenses/${expense.id}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="text-muted-foreground w-12 shrink-0 text-xs whitespace-nowrap">
              {toUIDate(expense.expenseDate)}
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate text-sm">{expense.name}</span>
            <span className="text-muted-foreground shrink-0 text-sm">
              {toUIString('mine' === scope ? expense.mine : expense.amount)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
};

const CategoryHeaderButton: React.FC<{
  category: string;
  label: string;
  amount: string;
  barValue: number;
  expanded: boolean;
  onToggle: (category: string) => void;
}> = ({ category, label, amount, barValue, expanded, onToggle }) => {
  const handleClick = useCallback(() => onToggle(category), [onToggle, category]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-expanded={expanded}
      className="focus-visible:ring-ring w-full rounded-md text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      <CategoryRow
        category={category}
        label={label}
        barValue={barValue}
        value={
          <span className="flex items-center gap-1">
            {amount}
            <ChevronDownIcon
              className={cn(
                'text-muted-foreground size-3.5 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </span>
        }
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
}> = ({ categories, scope, month, timeZone, groupId, currency }) => {
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

  const largest = sorted[0]?.amount ?? 0n;
  const { toUIString } = getCurrencyHelpersCached(currency);

  if (0 === sorted.length) {
    return <p className="text-muted-foreground mt-4 text-sm">{t('dashboard.stats.empty')}</p>;
  }

  return (
    <div className="mt-4">
      <SectionLabel className="text-muted-foreground">
        {t('dashboard.stats.by_category')}
      </SectionLabel>
      <div className="mt-3 flex flex-col gap-4">
        {sorted.map(({ category, amount }) => (
          <div key={category}>
            <CategoryHeaderButton
              category={category}
              label={categoryLabel(category)}
              amount={toUIString(amount)}
              barValue={percentageOf(amount, largest)}
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
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
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
    <DashboardCard className="flex items-center gap-2">
      <Icon className={cn('size-4 shrink-0', isUp ? 'text-negative' : 'text-positive')} />
      <p className="text-muted-foreground text-sm">
        {0 === rounded
          ? t('dashboard.stats.change.same')
          : t(`dashboard.stats.change.${isUp ? 'up' : 'down'}`, { percent: rounded })}{' '}
        <span className="text-muted-foreground/70">
          ({getCurrencyHelpersCached(currency).toUIString(previous)})
        </span>
      </p>
    </DashboardCard>
  );
};

const StatsPage: NextPageWithUser = ({ user }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const timeZone = useTimeZone();
  const { selected, canGoForward, goBackward, goForward } = useMonthNavigation(timeZone);

  const [scope, setScope] = useState<Scope>('mine');
  const [group, setGroup] = useState<string>(ALL_GROUPS);
  const groupId = ALL_GROUPS === group ? null : Number(group);

  const groupsQuery = api.group.getAllGroups.useQuery();
  const summaryQuery = api.stats.monthlySummary.useQuery({
    year: selected.year,
    month: selected.month,
    timeZone,
    groupId,
  });

  const currencies = useMemo(
    () => (summaryQuery.data?.current ?? []).map(({ currency }) => currency),
    [summaryQuery.data],
  );
  const [currency, setCurrency] = useSelectedCurrency(currencies, user.currency);

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

  const actions = useMemo(
    () => <CurrencyToggle currencies={currencies} value={currency} onChange={setCurrency} />,
    [currencies, currency, setCurrency],
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
          <DashboardCard>
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

            <CategoryBreakdown
              categories={totals?.categories ?? EMPTY_CATEGORIES}
              scope={scope}
              month={selected}
              timeZone={timeZone}
              groupId={groupId}
              currency={currency || user.currency}
            />
          </DashboardCard>

          <MonthComparison
            current={total}
            previous={previousTotals?.[scope] ?? 0n}
            currency={currency || user.currency}
          />
        </div>
      </MainLayout>
    </>
  );
};

StatsPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common', 'categories']);

export default StatsPage;
