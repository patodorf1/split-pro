import { SplitType } from '@prisma/client';
import { ChevronRightIcon } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useMemo } from 'react';

import { CardHeader, DashboardCard, SectionLabel } from '~/components/dashboard/DashboardCard';
import { CategoryRow, useCategoryLabel } from '~/components/dashboard/CategoryRow';
import { CurrencyToggle } from '~/components/dashboard/CurrencyToggle';
import { NextRecurringCard } from '~/components/dashboard/NextRecurringCard';
import {
  useCurrentYearMonth,
  useSelectedCurrency,
  useTimeZone,
} from '~/components/dashboard/hooks';
import MainLayout from '~/components/Layout/MainLayout';
import { CategoryIcon, SettleupIcon } from '~/components/ui/categoryIcons';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { percentageOf } from '~/lib/stats';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const TOP_CATEGORIES = 3;
const RECENT_MOVEMENTS = 5;

type Balances = RouterOutputs['expense']['getBalances']['balances'];
type RecentMovement = RouterOutputs['stats']['recentActivity'][number];
type CategoryTotals = RouterOutputs['stats']['monthlySummary']['current'][number]['categories'];

const EMPTY_BALANCES: Balances = [];
const EMPTY_MOVEMENTS: RecentMovement[] = [];
const EMPTY_CATEGORIES: CategoryTotals = [];

const SpentThisMonthCard: React.FC<{ amount: bigint; currency: string }> = ({
  amount,
  currency,
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();

  return (
    <DashboardCard>
      <SectionLabel>{t('dashboard.spent.title')}</SectionLabel>
      <p className="text-foreground mt-2 text-3xl font-semibold">
        {getCurrencyHelpersCached(currency).toUIString(amount)}
      </p>
      <p className="text-muted-foreground mt-1 text-sm">{t('dashboard.spent.subtitle')}</p>
    </DashboardCard>
  );
};

const BalanceCard: React.FC<{ balances: Balances }> = ({ balances }) => {
  const { t, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();

  const lines = useMemo(
    () =>
      balances.flatMap((balance) =>
        balance.currencies
          .filter(({ amount }) => 0n !== amount)
          .map(({ currency, amount }) => ({
            key: `${balance.friendId}-${currency}`,
            friendId: balance.friendId,
            name: displayName(balance.friend),
            currency,
            amount,
          })),
      ),
    [balances, displayName],
  );

  const friendIds = useMemo(() => new Set(lines.map((line) => line.friendId)), [lines]);
  const settleHref = 1 === friendIds.size ? `/balances/${lines[0]!.friendId}` : '/balances';

  return (
    <DashboardCard>
      <SectionLabel>{t('dashboard.balance.title')}</SectionLabel>
      {0 === lines.length ? (
        <p className="text-muted-foreground mt-2 text-sm">{t('dashboard.balance.settled_up')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {lines.map((line) => (
            <li
              key={line.key}
              className={`text-sm font-medium ${0n < line.amount ? 'text-positive' : 'text-negative'}`}
            >
              {0n < line.amount
                ? t('dashboard.balance.owes_you', {
                    name: line.name,
                    amount: getCurrencyHelpersCached(line.currency).toUIString(line.amount),
                  })
                : t('dashboard.balance.you_owe', {
                    name: line.name,
                    amount: getCurrencyHelpersCached(line.currency).toUIString(-line.amount),
                  })}
            </li>
          ))}
        </ul>
      )}
      <Link
        href={settleHref}
        className="text-primary mt-3 inline-flex items-center gap-0.5 text-sm font-medium"
      >
        {t('dashboard.balance.settle')}
        <ChevronRightIcon className="size-4" />
      </Link>
    </DashboardCard>
  );
};

const TopCategoriesCard: React.FC<{ categories: CategoryTotals; total: bigint }> = ({
  categories,
  total,
}) => {
  const { t } = useTranslationWithUtils();
  const categoryLabel = useCategoryLabel();

  const top = useMemo(
    () =>
      [...categories]
        .filter(({ mine }) => 0n < mine)
        .sort((a, b) => (a.mine > b.mine ? -1 : 1))
        .slice(0, TOP_CATEGORIES),
    [categories],
  );

  if (0 === top.length) {
    return null;
  }

  return (
    <DashboardCard>
      <Link href="/stats" className="block">
        <CardHeader>
          <SectionLabel>{t('dashboard.top_categories.title')}</SectionLabel>
          <ChevronRightIcon className="text-primary size-4" />
        </CardHeader>
        <div className="mt-3 flex flex-col gap-3">
          {top.map(({ category, mine }) => {
            const percentage = percentageOf(mine, total);

            return (
              <CategoryRow
                key={category}
                category={category}
                label={categoryLabel(category)}
                value={`${Math.round(percentage)}%`}
                barValue={percentage}
              />
            );
          })}
        </div>
      </Link>
    </DashboardCard>
  );
};

const MovementRow: React.FC<{ movement: RecentMovement; userId: number }> = ({
  movement,
  userId,
}) => {
  const { t, toUIDate, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const isSettlement = SplitType.SETTLEMENT === movement.splitType;

  return (
    <li>
      <Link href={`/expenses/${movement.id}`} className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-muted-foreground w-12 shrink-0 text-xs whitespace-nowrap">
            {toUIDate(movement.expenseDate)}
          </span>
          {isSettlement ? (
            <SettleupIcon className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <CategoryIcon
              category={movement.category}
              className="text-muted-foreground size-4 shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm">
              {isSettlement ? t('ui.settlement') : movement.name}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {displayName(movement.paidByUser, userId)}{' '}
              {t(
                `ui.expense.${movement.paidByUser.id === userId ? 'you' : 'user'}.${0n > movement.amount ? 'received' : 'paid'}`,
              )}
            </p>
          </div>
        </div>
        <span className="text-foreground shrink-0 text-sm">
          {getCurrencyHelpersCached(movement.currency).toUIString(movement.amount)}
        </span>
      </Link>
    </li>
  );
};

const RecentMovementsCard: React.FC<{ movements: RecentMovement[]; userId: number }> = ({
  movements,
  userId,
}) => {
  const { t } = useTranslationWithUtils();

  if (0 === movements.length) {
    return null;
  }

  return (
    <DashboardCard>
      <CardHeader>
        <SectionLabel>{t('dashboard.recent.title')}</SectionLabel>
        <Link href="/activity" className="text-primary text-xs font-medium">
          {t('dashboard.recent.view_all')}
        </Link>
      </CardHeader>
      <ul className="mt-3 flex flex-col gap-3">
        {movements.map((movement) => (
          <MovementRow key={movement.id} movement={movement} userId={userId} />
        ))}
      </ul>
    </DashboardCard>
  );
};

const DashboardPage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const timeZone = useTimeZone();
  const month = useCurrentYearMonth(timeZone);

  const summaryQuery = api.stats.monthlySummary.useQuery({
    year: month.year,
    month: month.month,
    timeZone,
  });
  const balanceQuery = api.expense.getBalances.useQuery();
  const recentQuery = api.stats.recentActivity.useQuery({ limit: RECENT_MOVEMENTS });

  const currencies = useMemo(
    () => (summaryQuery.data?.current ?? []).map(({ currency }) => currency),
    [summaryQuery.data],
  );
  const [currency, setCurrency] = useSelectedCurrency(currencies, user.currency);

  const monthTotals = summaryQuery.data?.current.find((entry) => entry.currency === currency);
  const categories = monthTotals?.categories ?? EMPTY_CATEGORIES;
  const balances = balanceQuery.data?.balances ?? EMPTY_BALANCES;
  const movements = recentQuery.data ?? EMPTY_MOVEMENTS;

  const actions = useMemo(
    () => <CurrencyToggle currencies={currencies} value={currency} onChange={setCurrency} />,
    [currencies, currency, setCurrency],
  );

  return (
    <>
      <Head>
        <title>{t('dashboard.title')}</title>
      </Head>
      <MainLayout
        title={t('dashboard.title')}
        actions={actions}
        loading={summaryQuery.isPending && balanceQuery.isPending}
      >
        <div className="flex flex-col gap-4 pb-8">
          <SpentThisMonthCard
            amount={monthTotals?.mine ?? 0n}
            currency={currency || user.currency}
          />
          <BalanceCard balances={balances} />
          <TopCategoriesCard categories={categories} total={monthTotals?.mine ?? 0n} />
          <NextRecurringCard />
          <RecentMovementsCard movements={movements} userId={user.id} />
        </div>
      </MainLayout>
    </>
  );
};

DashboardPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common', 'categories']);

export default DashboardPage;
