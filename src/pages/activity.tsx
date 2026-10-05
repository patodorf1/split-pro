import { SplitType } from '@prisma/client';
import { type User } from 'next-auth';
import Head from 'next/head';
import Link from 'next/link';
import MainLayout from '~/components/Layout/MainLayout';
import {
  ExpenseRow,
  type RowTone,
  SettlementTitle,
  usePayerLabel,
} from '~/components/Expense/ExpenseRow';
import { Card } from '~/components/ui/card';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { getCurrencyHelpers } from '~/utils/numbers';
import { type TFunction } from 'next-i18next';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { withI18nStaticProps } from '~/utils/i18n/server';
import { RefreshCcwDot } from 'lucide-react';
import { Button } from '~/components/ui/button';
import React from 'react';

/**
 * Lo que le toca al usuario en el movimiento, chiquito bajo el monto: "Vos prestaste $X",
 * "Vos debés $X" o "No participás". Los borrados no llevan detalle.
 */
function getPaymentDetail(
  user: User,
  amount: bigint,
  paidBy: number,
  expenseUserAmt: bigint,
  isSettlement: boolean,
  t: TFunction,
  toUIString: (value: bigint) => string,
  isDeleted?: boolean,
): { text: string; tone: RowTone } | null {
  if (isDeleted) {
    return null;
  } else if (0n === expenseUserAmt) {
    return { text: t('ui.not_involved'), tone: 'muted' };
  } else if (isSettlement) {
    return {
      text: `${t('actors.you')} ${user.id === paidBy ? t('ui.expense.you.paid') : t('ui.expense.you.received')} ${toUIString(amount)}`,
      tone: user.id === paidBy ? 'positive' : 'negative',
    };
  }

  const lent = (user.id === paidBy) !== amount < 0n;

  return {
    text: `${t('actors.you')} ${t(`ui.expense.you.${lent ? 'lent' : 'owe'}`)} ${toUIString(expenseUserAmt)}`,
    tone: lent ? 'positive' : 'negative',
  };
}

const ActivityPage: NextPageWithUser = ({ user }) => {
  const { displayName, t, i18n } = useTranslationWithUtils();
  const payerLabel = usePayerLabel();
  const expensesQuery = api.expense.getAllExpenses.useQuery();

  const actions = React.useMemo(
    () => (
      <Link href="/recurring">
        <Button variant="ghost" size="sm">
          <RefreshCcwDot className="size-6" />
        </Button>
      </Link>
    ),
    [],
  );

  return (
    <>
      <Head>
        <title>{t('navigation.activity')}</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <MainLayout
        title={t('navigation.activity')}
        actions={actions}
        loading={expensesQuery.isPending}
      >
        <div className="flex flex-col gap-4">
          {!expensesQuery.data?.length ? (
            <div className="text-muted-foreground mt-[30vh] text-center">{t('ui.no_activity')}</div>
          ) : null}
          {expensesQuery.data?.length ? (
            <Card className="px-4 py-1.5">
              {expensesQuery.data.map((e) => {
                const { toUIString } = getCurrencyHelpers({
                  locale: i18n.language,
                  currency: e.expense.currency,
                });
                const isSettlement = e.expense.splitType === SplitType.SETTLEMENT;
                const deletedBy = e.expense.deletedByUser;
                const receiverId =
                  e.expense.expenseParticipants.find((p) => p.userId !== e.expense.paidBy)
                    ?.userId ?? null;

                let subtitle: React.ReactNode = isSettlement
                  ? t('expense_row.transfer')
                  : payerLabel(e.expense.paidByUser, user.id, e.expense.amount < 0n);
                if (deletedBy) {
                  subtitle =
                    deletedBy.id === user.id
                      ? t('expense_row.deleted_by_you')
                      : t('expense_row.deleted_by', {
                          name: displayName(deletedBy, user.id),
                          interpolation: { escapeValue: false },
                        });
                }

                return (
                  <ExpenseRow
                    key={e.expenseId}
                    href={`/expenses/${e.expenseId}`}
                    title={
                      isSettlement ? (
                        <SettlementTitle
                          payer={e.expense.paidByUser}
                          receiverId={receiverId}
                          userId={user.id}
                        />
                      ) : (
                        e.expense.name
                      )
                    }
                    name={isSettlement ? '' : e.expense.name}
                    category={e.expense.category}
                    splitType={e.expense.splitType}
                    payer={e.expense.paidByUser}
                    subtitle={subtitle}
                    date={e.expense.expenseDate}
                    amount={toUIString(e.expense.amount)}
                    detail={getPaymentDetail(
                      user,
                      e.expense.amount,
                      e.expense.paidBy,
                      e.amount,
                      isSettlement,
                      t,
                      toUIString,
                      !!e.expense.deletedBy,
                    )}
                    deleted={!!deletedBy}
                  />
                );
              })}
            </Card>
          ) : null}
        </div>
      </MainLayout>
    </>
  );
};

ActivityPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default ActivityPage;
