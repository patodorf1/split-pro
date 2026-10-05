import { SplitType } from '@prisma/client';
import { ChevronRightIcon } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useMemo } from 'react';

import { BalanceCards } from '~/components/dashboard/BalanceCards';
import { ExpenseRow, SettlementTitle } from '~/components/Expense/ExpenseRow';
import { CategoryRow, useCategoryLabel } from '~/components/dashboard/CategoryRow';
import { CurrencyToggle } from '~/components/dashboard/CurrencyToggle';
import { ExpiryNotices } from '~/components/dashboard/ExpiryNotices';
import { NextRecurringCard } from '~/components/dashboard/NextRecurringCard';
import {
  useCurrentYearMonth,
  useSelectedCurrency,
  useTimeZone,
} from '~/components/dashboard/hooks';
import MainLayout from '~/components/Layout/MainLayout';
import { Card, CardHeader } from '~/components/ui/card';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { percentageOf } from '~/lib/stats';
import { type NextPageWithUser } from '~/types';
import { type RouterOutputs, api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const TOP_CATEGORIES = 3;
const RECENT_MOVEMENTS = 5;

type BalanceCardList = RouterOutputs['stats']['homeBalances'];
type RecentMovement = RouterOutputs['stats']['recentActivity'][number];
type CategoryTotals = RouterOutputs['stats']['monthlySummary']['current'][number]['categories'];

const EMPTY_BALANCE_CARDS: BalanceCardList = [];
const EMPTY_MOVEMENTS: RecentMovement[] = [];
const EMPTY_CATEGORIES: CategoryTotals = [];

const TopCategoriesCard: React.FC<{ categories: CategoryTotals; total: bigint }> = ({
  categories,
  total,
}) => {
  const { t } = useTranslationWithUtils();
  const categoryLabel = useCategoryLabel();

  const top = useMemo(
    () =>
      [...categories]
        .filter(({ ours }) => 0n < ours)
        .sort((a, b) => (a.ours > b.ours ? -1 : 1))
        .slice(0, TOP_CATEGORIES),
    [categories],
  );

  if (0 === top.length) {
    return null;
  }

  return (
    <Card>
      <Link href="/stats" className="block">
        <CardHeader>
          <SectionLabel>{t('dashboard.top_categories.title')}</SectionLabel>
          <ChevronRightIcon className="text-primary size-4" />
        </CardHeader>
        <div className="flex flex-col gap-3">
          {top.map(({ category, ours }) => {
            const percentage = percentageOf(ours, total);

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
    </Card>
  );
};

const MovementRow: React.FC<{ movement: RecentMovement; userId: number }> = ({
  movement,
  userId,
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const isSettlement = SplitType.SETTLEMENT === movement.splitType;

  return (
    <li>
      <ExpenseRow
        href={`/expenses/${movement.id}`}
        title={
          isSettlement ? (
            <SettlementTitle
              payer={movement.paidByUser}
              receiverId={movement.receiverId}
              userId={userId}
            />
          ) : (
            movement.name
          )
        }
        name={isSettlement ? '' : movement.name}
        category={movement.category}
        splitType={movement.splitType}
        payer={movement.paidByUser}
        subtitle={isSettlement ? t('expense_row.transfer') : null}
        date={movement.expenseDate}
        amount={getCurrencyHelpersCached(movement.currency).toUIString(movement.amount)}
      />
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
    <Card>
      <CardHeader>
        <SectionLabel>{t('dashboard.recent.title')}</SectionLabel>
        <Link href="/activity" className="text-primary text-xs font-medium">
          {t('dashboard.recent.view_all')}
        </Link>
      </CardHeader>
      <ul className="-my-2.5 flex flex-col">
        {movements.map((movement) => (
          <MovementRow key={movement.id} movement={movement} userId={userId} />
        ))}
      </ul>
    </Card>
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
  const balanceQuery = api.stats.homeBalances.useQuery();
  const recentQuery = api.stats.recentActivity.useQuery({ limit: RECENT_MOVEMENTS });

  const currencies = useMemo(
    () => (summaryQuery.data?.current ?? []).map(({ currency }) => currency),
    [summaryQuery.data],
  );
  const [currency, setCurrency] = useSelectedCurrency(currencies, user.currency);

  const monthTotals = summaryQuery.data?.current.find((entry) => entry.currency === currency);
  const categories = monthTotals?.categories ?? EMPTY_CATEGORIES;
  const balanceCards = balanceQuery.data ?? EMPTY_BALANCE_CARDS;
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
          <ExpiryNotices />
          <BalanceCards
            cards={balanceCards}
            spent={{
              total: monthTotals?.ours ?? 0n,
              mine: monthTotals?.mine ?? 0n,
              currency: currency || user.currency,
            }}
          />
          <TopCategoriesCard categories={categories} total={monthTotals?.ours ?? 0n} />
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
