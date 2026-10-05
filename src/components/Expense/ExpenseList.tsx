import { SplitType } from '@prisma/client';
import { type inferRouterOutputs } from '@trpc/server';
import Image from 'next/image';
import { useRouter } from 'next/router';
import React, { useMemo } from 'react';
import { toast } from 'sonner';
import { Card } from '~/components/ui/card';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import type { ExpenseRouter } from '~/server/api/routers/expense';
import { api } from '~/utils/api';
import { Separator } from '../ui/separator';
import { ExpenseRow, SettlementTitle } from './ExpenseRow';

type ExpensesOutput =
  | inferRouterOutputs<ExpenseRouter>['getGroupExpenses']
  | inferRouterOutputs<ExpenseRouter>['getExpensesWithFriend'];

type SingleExpenseOutput = ExpensesOutput[number];

type ExpenseComponent = React.FC<{
  e: SingleExpenseOutput;
  userId: number;
  href: string;
}>;

interface MonthBlock {
  key: string;
  date: Date;
  expenses: SingleExpenseOutput[];
}

/** Agrupa los gastos (ya ordenados del más nuevo al más viejo) por mes, para los encabezados. */
const groupByMonth = (expenses: ExpensesOutput): MonthBlock[] => {
  const blocks: MonthBlock[] = [];

  for (const expense of expenses) {
    const date = expense.expenseDate;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const last = blocks[blocks.length - 1];

    if (last?.key === key) {
      last.expenses.push(expense);
    } else {
      blocks.push({ key, date, expenses: [expense] });
    }
  }

  return blocks;
};

export const ExpenseList: React.FC<{
  userId: number;
  expenses?: ExpensesOutput;
  contactId: number;
  isGroup?: boolean;
  isLoading?: boolean;
}> = ({ userId, isGroup = false, expenses = [], contactId, isLoading }) => {
  const { i18n } = useTranslationWithUtils();
  const blocks = useMemo(() => groupByMonth(expenses), [expenses]);

  if (!isLoading && expenses.length === 0) {
    return <NoExpenses />;
  }

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block) => (
        <React.Fragment key={block.key}>
          <div className="flex flex-row items-center gap-4 pt-2">
            <div className="section-label">
              {new Intl.DateTimeFormat(i18n.language, {
                month: 'long',
                year: 'numeric',
              }).format(block.date)}
            </div>
            <Separator className="bg-border flex-1" />
          </div>
          <Card className="px-4 py-1.5">
            {block.expenses.map((e) => {
              const href = `/${isGroup ? 'groups' : 'balances'}/${contactId}/expenses/${e.id}`;

              if (e.splitType === SplitType.SETTLEMENT) {
                return <Settlement key={e.id} e={e} userId={userId} href={href} />;
              }
              if (e.splitType === SplitType.CURRENCY_CONVERSION) {
                return <CurrencyConversion key={e.id} e={e} userId={userId} href={href} />;
              }
              return <Expense key={e.id} e={e} userId={userId} href={href} />;
            })}
          </Card>
        </React.Fragment>
      ))}
    </div>
  );
};

const Expense: ExpenseComponent = ({ e, userId, href }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const router = useRouter();
  const { friendId } = router.query;

  const youPaid = e.paidBy === userId && e.amount >= 0n;
  const yourExpense = e.expenseParticipants.find((participant) => participant.userId === userId);
  const theirExpense = e.expenseParticipants.find(
    (participant) => participant.userId.toString() === friendId,
  );
  const yourExpenseAmount = youPaid
    ? (theirExpense?.amount ?? yourExpense?.amount ?? 0n)
    : -(yourExpense?.amount ?? 0n);

  const { toUIString } = getCurrencyHelpersCached(e.currency);

  // Lo que antes ocupaba la columna derecha (cuánto prestaste o debés) queda chiquito bajo el total.
  const detailText =
    youPaid || 0n !== yourExpenseAmount
      ? `${t('actors.you')} ${t(`ui.expense.you.${youPaid ? 'lent' : 'owe'}`)} ${toUIString(yourExpenseAmount)}`
      : t('ui.not_involved');
  const detailTone = youPaid ? 'positive' : 0n !== yourExpenseAmount ? 'negative' : 'muted';
  const detail = useMemo(
    () => ({ text: detailText, tone: detailTone }) as const,
    [detailText, detailTone],
  );
  return (
    <ExpenseRow
      href={href}
      title={e.name}
      category={e.category}
      splitType={e.splitType}
      payer={e.paidByUser}
      date={e.expenseDate}
      amount={toUIString(e.amount)}
      detail={detail}
    />
  );
};

const Settlement: ExpenseComponent = ({ e, userId, href }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(e.currency);

  const receiverId = e.expenseParticipants.find((p) => p.userId !== e.paidBy)?.userId;

  return (
    <ExpenseRow
      href={href}
      title={<SettlementTitle payer={e.paidByUser} receiverId={receiverId} userId={userId} />}
      name=""
      splitType={e.splitType}
      payer={e.paidByUser}
      subtitle={t('expense_row.transfer')}
      date={e.expenseDate}
      amount={toUIString(e.amount)}
    />
  );
};

const CurrencyConversion: ExpenseComponent = ({ e, userId, href }) => {
  const { displayName, t, getCurrencyHelpersCached } = useTranslationWithUtils();

  const receiverId = e.expenseParticipants.find((p) => p.userId !== e.paidBy)?.userId;
  const userDetails = api.user.getUserDetails.useQuery(
    { userId: receiverId ?? 0 },
    { enabled: Boolean(receiverId) },
  );

  if (!e.conversionTo) {
    toast.error(t('errors.currency_conversion_malformed'));
    console.error(
      'Malformed currency conversion data: no conversionTo present, please report this issue.',
    );
    return null;
  }

  return (
    <ExpenseRow
      href={href}
      title={
        <>
          {getCurrencyHelpersCached(e.currency).toUIString(e.amount)} ➡️{' '}
          {getCurrencyHelpersCached(e.conversionTo.currency).toUIString(e.conversionTo.amount)}
        </>
      }
      name=""
      splitType={e.splitType}
      payer={e.paidByUser}
      subtitle={
        <>
          {t('ui.expense.for')} {displayName(e.paidByUser, userId)} {t('ui.and')}{' '}
          {displayName(userDetails.data, userId)}
        </>
      }
      date={e.expenseDate}
    />
  );
};

const NoExpenses = () => (
  <div className="mt-20 flex flex-col items-center justify-center">
    <Image src="/add_expense.svg" alt="Empty" width={200} height={200} className="mb-4" />
  </div>
);
