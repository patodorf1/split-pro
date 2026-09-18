import { Landmark, RefreshCcwDot, X } from 'lucide-react';
import { useRouter } from 'next/router';
import React, { useCallback } from 'react';

import { type CurrencyCode } from '~/lib/currency';
import { useAddExpenseStore } from '~/store/addStore';
import { api } from '~/utils/api';

import { toast } from 'sonner';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cronToBackend } from '~/lib/cron';
import { buildSettlementInput, resolveTransferReceiver } from '~/lib/settlement';
import { cn } from '~/lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import AddBankTransactions from './AddBankTransactions';
import { CategoryPicker } from './CategoryPicker';
import { CurrencyPicker } from './CurrencyPicker';
import { QuickCategories } from './QuickCategories';
import { DateSelector } from './DateSelector';
import { RecurrenceInput } from './RecurrenceInput';
import { PayerSelector } from './PayerSelector';
import { SelectUserOrGroup } from './SelectUserOrGroup';
import { SplitExpenseForm } from './SplitTypeSection';
import { EntryModeToggle, TransferDirection } from './TransferSection';
import { UploadFile } from './UploadFile';
import { UserInput } from './UserInput';
import { CurrencyInput } from '../ui/currency-input';
import { CurrencyConversion } from '../Friend/CurrencyConversion';
import { currencyConversion } from '~/utils/numbers';
import { CurrencyConversionIcon } from '../ui/categoryIcons';
import { useSession } from 'next-auth/react';

export const AddOrEditExpensePage: React.FC<{
  enableSendingInvites: boolean;
  expenseId?: string;
  bankConnectionEnabled: boolean;
}> = ({ enableSendingInvites, expenseId, bankConnectionEnabled }) => {
  const showFriends = useAddExpenseStore((s) => s.showFriends);
  const amount = useAddExpenseStore((s) => s.amount);
  const isNegative = useAddExpenseStore((s) => s.isNegative);
  const participants = useAddExpenseStore((s) => s.participants);
  const group = useAddExpenseStore((s) => s.group);
  const currency = useAddExpenseStore((s) => s.currency);
  const category = useAddExpenseStore((s) => s.category);
  const description = useAddExpenseStore((s) => s.description);
  const isFileUploading = useAddExpenseStore((s) => s.isFileUploading);
  const amtStr = useAddExpenseStore((s) => s.amountStr);
  const expenseDate = useAddExpenseStore((s) => s.expenseDate);
  const isExpenseSettled = useAddExpenseStore((s) => s.canSplitScreenClosed);
  const paidBy = useAddExpenseStore((s) => s.paidBy);
  const splitType = useAddExpenseStore((s) => s.splitType);
  const fileKey = useAddExpenseStore((s) => s.fileKey);
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const splitShares = useAddExpenseStore((s) => s.splitShares);
  const transactionId = useAddExpenseStore((s) => s.transactionId);
  const cronExpression = useAddExpenseStore((s) => s.cronExpression);
  const multipleTransactions = useAddExpenseStore((s) => s.multipleTransactions);
  const entryMode = useAddExpenseStore((s) => s.entryMode);
  const transferToId = useAddExpenseStore((s) => s.transferToId);

  const { t, generateSplitDescription, getCurrencyHelpersCached } = useTranslationWithUtils();

  const {
    setCurrency,
    setCategory,
    setDescription,
    setAmount,
    setAmountStr,
    resetState,
    setSplitScreenOpen,
    setExpenseDate,
    setMultipleTransactions,
    setIsTransactionLoading,
    setSingleTransaction,
  } = useAddExpenseStore((s) => s.actions);

  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();
  const updateProfile = api.user.updateUserDetail.useMutation();
  const { update } = useSession();

  const onCurrencyPick = useCallback(
    (newCurrency: CurrencyCode | null) => {
      if (!newCurrency) {
        return;
      }

      updateProfile.mutate({ currency: newCurrency });

      previousCurrencyRef.current = currency;
      setCurrency(newCurrency);
    },
    [currency, setCurrency, updateProfile],
  );

  const router = useRouter();

  const onUpdateAmount = useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (strValue !== undefined) {
        setAmountStr(strValue);
      }
      if (bigIntValue !== undefined) {
        setAmount(bigIntValue);
      }
      previousCurrencyRef.current = null;
    },
    [setAmount, setAmountStr],
  );

  const addExpense = useCallback(async () => {
    if (!paidBy) {
      return;
    }

    if (!isExpenseSettled) {
      setSplitScreenOpen(true);
      return;
    }

    setMultipleTransactions([]);
    setIsTransactionLoading(false);

    const sign = isNegative ? -1n : 1n;

    try {
      await addExpenseMutation.mutateAsync(
        [
          {
            name: description,
            currency,
            amount: amount * sign,
            groupId: group?.id ?? null,
            splitType,
            participants: participants.map((p) => ({
              userId: p.id,
              amount: (p.amount ?? 0n) * sign,
            })),
            paidBy: paidBy.id,
            category,
            fileKey,
            expenseDate,
            expenseId,
            transactionId,
            cronExpression: cronExpression ? cronToBackend(cronExpression) : undefined,
          },
        ],
        {
          onSuccess: (d) => {
            if (d) {
              if (multipleTransactions.length > 0) {
                const allTransactions = [...multipleTransactions];
                const transactionToAdd = allTransactions.pop();
                if (transactionToAdd) {
                  setMultipleTransactions(allTransactions);
                  setSingleTransaction(transactionToAdd);
                }
                return;
              } else {
                const id = d.length > 0 ? d[0]?.id : expenseId;

                let navPromise: () => Promise<any> = () => Promise.resolve(true);

                const { friendId, groupId } = router.query;

                if (friendId && !groupId) {
                  navPromise = () => router.push(`/balances/${friendId as string}/expenses/${id}`);
                } else if (groupId) {
                  navPromise = () => router.push(`/groups/${groupId as string}/expenses/${id}`);
                } else {
                  navPromise = () => router.push(`/expenses/${id}?keepAdding=1`);
                }

                if (expenseId) {
                  navPromise = async () => router.back();
                }

                navPromise().catch(console.error);
                update((session: any) => ({
                  ...session,
                  user: {
                    ...(session?.user ?? {}),
                    currency,
                  },
                })).catch(console.error);
              }
            }
          },
        },
      );
    } catch (error) {
      console.error(error);
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('An unexpected error occurred while submitting the expense.');
      }
    }
  }, [
    setSplitScreenOpen,
    description,
    currency,
    isNegative,
    amount,
    participants,
    category,
    expenseDate,
    expenseId,
    router,
    addExpenseMutation,
    group,
    paidBy,
    splitType,
    fileKey,
    isExpenseSettled,
    setMultipleTransactions,
    transactionId,
    setIsTransactionLoading,
    cronExpression,
    multipleTransactions,
    setSingleTransaction,
    update,
  ]);

  /** Con dos participantes el que recibe sale solo; con más, hay que elegirlo. */
  const transferReceiver = resolveTransferReceiver(participants, paidBy?.id, transferToId);
  const isTransfer = 'TRANSFER' === entryMode;
  const canSaveTransfer = Boolean(amount) && Boolean(paidBy) && Boolean(transferReceiver);

  /**
   * Guardar una transferencia de saldo. Crea exactamente el mismo registro que "Saldar cuentas"
   * (misma mutación, mismo `buildSettlementInput`), así que no suma a los totales del mes.
   */
  const addTransfer = useCallback(async () => {
    if (!paidBy || !transferReceiver || !amount) {
      return;
    }

    try {
      await addExpenseMutation.mutateAsync(
        [
          buildSettlementInput({
            sender: paidBy,
            receiver: transferReceiver,
            amount,
            currency,
            groupId: group?.id ?? null,
            name: t('ui.settle_up_name'),
            expenseDate,
          }),
        ],
        {
          onSuccess: (d) => {
            const id = d.length > 0 ? d[0]?.id : undefined;
            const friendId = 'string' === typeof router.query.friendId ? router.query.friendId : '';
            const groupId = 'string' === typeof router.query.groupId ? router.query.groupId : '';

            const target =
              friendId && !groupId
                ? `/balances/${friendId}/expenses/${id}`
                : groupId
                  ? `/groups/${groupId}/expenses/${id}`
                  : `/expenses/${id}?keepAdding=1`;

            router.push(target).catch(console.error);
          },
        },
      );
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : t('errors.saving_expense'));
    }
  }, [
    paidBy,
    transferReceiver,
    amount,
    currency,
    group,
    expenseDate,
    addExpenseMutation,
    router,
    t,
  ]);

  const onSave = isTransfer ? addTransfer : addExpense;
  const isSaveDisabled =
    addExpenseMutation.isPending ||
    (isTransfer ? !canSaveTransfer : !amount || '' === description || isFileUploading);

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDescription(e.target.value.toString() ?? '');
    },
    [setDescription],
  );

  const clearTransaction = useCallback(() => {
    resetState();
    setMultipleTransactions([]);
  }, [resetState, setMultipleTransactions]);

  const previousCurrencyRef = React.useRef<CurrencyCode | null>(null);

  const onConvertAmount: React.ComponentProps<typeof CurrencyConversion>['onSubmit'] = useCallback(
    ({ amount: absAmount, rate }) => {
      if (!previousCurrencyRef.current) {
        return;
      }

      const targetAmount =
        (absAmount >= 0n ? 1n : -1n) *
        currencyConversion({
          amount: absAmount,
          rate,
          from: previousCurrencyRef.current,
          to: currency,
        });
      setAmount(targetAmount);
      setAmountStr(getCurrencyHelpersCached(currency).toUIString(targetAmount, false, true));
      previousCurrencyRef.current = null;
    },
    [setAmount, setAmountStr, currency, getCurrencyHelpersCached],
  );

  const currencyConversionComponent = React.useMemo(() => {
    if (
      currency === previousCurrencyRef.current ||
      previousCurrencyRef.current === null ||
      !amount ||
      0n === amount
    ) {
      return null;
    }

    return (
      <CurrencyConversion
        onSubmit={onConvertAmount}
        amount={amount}
        currency={previousCurrencyRef.current}
        editingTargetCurrency={currency}
      >
        <Button size="icon" variant="secondary" className="size-8">
          <CurrencyConversionIcon className="size-4" />
        </Button>
      </CurrencyConversion>
    );
  }, [amount, currency, onConvertAmount]);

  const onBackButtonPress = useCallback(() => {
    router.back();
  }, [router]);

  /** Todavía no se eligió con quién: es el paso de grupos/amigos con el buscador abajo. */
  const isPickingFirstParticipant = !group && 1 === participants.length;

  /** Moneda + monto: el mismo renglón sirve para el gasto y para la transferencia. */
  const amountRow = (
    <div className="flex gap-2">
      <CurrencyPicker currentCurrency={currency} onCurrencyPick={onCurrencyPick} />
      <CurrencyInput
        placeholder={t('expense_details.add_expense_details.amount_placeholder')}
        currency={currency}
        strValue={amtStr}
        allowNegative={!isTransfer}
        hideSymbol
        onValueChange={onUpdateAmount}
        rightIcon={currencyConversionComponent}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="text-primary px-0" onClick={onBackButtonPress}>
          {t('actions.cancel')}
        </Button>
        <div className="text-center">
          {expenseId
            ? t('actions.edit_expense')
            : isTransfer
              ? t('transfer.title')
              : t('actions.add_expense')}
        </div>
        <Button
          variant="ghost"
          className="text-primary px-0"
          disabled={isSaveDisabled}
          onClick={onSave}
        >
          {t('actions.save')}
        </Button>{' '}
      </div>
      {isPickingFirstParticipant ? (
        // Primer paso: grupos y amigos arriba, buscador abajo (lo pone SelectUserOrGroup).
        <SelectUserOrGroup enableSendingInvites={enableSendingInvites} withSearch />
      ) : showFriends ? (
        <>
          <UserInput isEditing={Boolean(expenseId)} />
          <SelectUserOrGroup enableSendingInvites={enableSendingInvites} />
        </>
      ) : (
        <>
          <UserInput isEditing={Boolean(expenseId)} />
          {!expenseId && 1 < participants.length ? (
            <EntryModeToggle className="mt-4 self-center" />
          ) : null}
          {isTransfer ? (
            <>
              <TransferDirection className="mt-6" />
              {amountRow}
              <div className="mt-4 flex items-start justify-between sm:mt-10">
                <DateSelector
                  mode="single"
                  required
                  selected={expenseDate}
                  onSelect={setExpenseDate}
                />
                <Button
                  className="min-w-[100px]"
                  size="sm"
                  loading={addExpenseMutation.isPending}
                  disabled={isSaveDisabled}
                  onClick={addTransfer}
                >
                  {t('actions.save')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 sm:mt-6">
                <QuickCategories
                  groupId={group?.id}
                  category={category}
                  onCategoryPick={setCategory}
                />
              </div>
              <div className="flex gap-2">
                <CategoryPicker category={category} onCategoryPick={setCategory} />
                <Input
                  placeholder={t('expense_details.add_expense_details.description_placeholder')}
                  value={description}
                  onChange={handleDescriptionChange}
                  className="text-lg placeholder:text-sm"
                  autoFocus
                />
              </div>
              {amountRow}
              {/* Quién pagó y cómo se divide: siempre a la vista, no recién cuando hay monto. */}
              <div className="flex flex-col gap-2">
                <PayerSelector />
                {1 < participants.length ? (
                  <SplitExpenseForm>
                    <Button variant="ghost" className="text-primary h-8 w-full px-1.5 py-0 text-sm">
                      {generateSplitDescription(
                        splitType,
                        participants,
                        splitShares,
                        paidBy,
                        currentUser,
                      )}
                    </Button>
                  </SplitExpenseForm>
                ) : null}
              </div>
              <div className="min-h-[90px]">
                {amount && '' !== description ? (
                  <div className="flex items-start justify-between">
                    <DateSelector
                      mode="single"
                      required
                      selected={expenseDate}
                      onSelect={setExpenseDate}
                    />
                    <div className="flex items-center gap-4">
                      <UploadFile />
                      <Button
                        className="min-w-[100px]"
                        size="sm"
                        loading={addExpenseMutation.isPending || isFileUploading}
                        disabled={
                          addExpenseMutation.isPending ||
                          !amount ||
                          '' === description ||
                          isFileUploading ||
                          !isExpenseSettled
                        }
                        onClick={addExpense}
                      >
                        {t('actions.save')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
          <div
            className={cn('flex items-center justify-evenly px-4 lg:px-0', isTransfer && 'hidden')}
          >
            {!expenseId && (
              <RecurrenceInput>
                <Button variant="ghost" size="sm">
                  <RefreshCcwDot
                    className={cn(
                      cronExpression && 'text-primary',
                      (!amtStr || !description) && 'invisible',
                      'size-6',
                    )}
                  />
                  <span className="sr-only">Toggle recurring expense options</span>
                </Button>
              </RecurrenceInput>
            )}
            <div className="flex gap-2">
              <AddBankTransactions bankConnectionEnabled={bankConnectionEnabled}>
                <Button
                  variant="ghost"
                  className="hover:text-foreground/80 items-center justify-between px-2"
                >
                  <Landmark
                    className={cn(
                      transactionId ? 'text-primary' : 'text-muted-foreground',
                      'h-6 w-6',
                    )}
                  />
                </Button>
              </AddBankTransactions>
              <Button
                variant="ghost"
                className={cn('px-2', transactionId ? 'text-destructive' : 'invisible')}
                disabled={!transactionId}
                onClick={clearTransaction}
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
