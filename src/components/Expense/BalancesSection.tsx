import React, { useEffect, useMemo } from 'react';

import { BalanceEntry } from '~/components/Expense/BalanceEntry';
import { ConvertibleBalance } from '~/components/Expense/ConvertibleBalance';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { isCurrencyCode } from '~/lib/currency';
import { cn } from '~/lib/utils';
import { useCurrencyPreferenceStore } from '~/store/currencyPreferenceStore';
import { api } from '~/utils/api';

/**
 * Saldos por persona: los totales (debés / te deben) y una fila por persona. Lo usan la pantalla
 * de Saldos y Estadísticas. `isEmpty` avisa cuando no hay saldos, para mostrar otra cosa.
 */
export const BalancesSection: React.FC<{
  defaultCurrency?: string | null;
  className?: string;
  children?: (state: { isEmpty: boolean }) => React.ReactNode;
}> = ({ defaultCurrency, className, children }) => {
  const { t } = useTranslationWithUtils();
  const balanceQuery = api.expense.getBalances.useQuery();
  const cumulatedQuery = api.expense.getCumulatedBalances.useQuery();

  const selectedCurrency = useCurrencyPreferenceStore((s) => s.getPreference());
  const setUserDefaultCurrency = useCurrencyPreferenceStore((s) => s.setUserDefaultCurrency);

  useEffect(() => {
    if (isCurrencyCode(defaultCurrency)) {
      setUserDefaultCurrency(defaultCurrency);
    }
  }, [defaultCurrency, setUserDefaultCurrency]);

  const allNonZeroCurrencies = useMemo(() => {
    const nonZeroBalances = balanceQuery.data?.balances.flatMap((b) =>
      b.currencies.filter((c) => c.amount !== 0n),
    );
    return nonZeroBalances ? [...new Set(nonZeroBalances.map((c) => c.currency))] : [];
  }, [balanceQuery.data?.balances]);

  const isEmpty = !balanceQuery.isPending && !balanceQuery.data?.balances.length;

  return (
    <div className={className}>
      <div className="flex items-stretch justify-between gap-4">
        {selectedCurrency && isCurrencyCode(selectedCurrency) ? (
          <CumulatedBalanceDisplay
            prefix={`${t('ui.total_balance')}`}
            cumulatedBalances={[
              cumulatedQuery.data?.youOwe ?? [],
              cumulatedQuery.data?.youGet ?? [],
            ].flat()}
            currencies={allNonZeroCurrencies}
            className="mx-auto"
          />
        ) : (
          <>
            <CumulatedBalanceDisplay
              prefix={`${t('actors.you')} ${t('ui.expense.you.owe')}`}
              cumulatedBalances={cumulatedQuery.data?.youOwe}
              currencies={allNonZeroCurrencies}
            />
            <CumulatedBalanceDisplay
              prefix={`${t('actors.you')} ${t('ui.expense.you.lent')}`}
              cumulatedBalances={cumulatedQuery.data?.youGet}
              currencies={allNonZeroCurrencies}
            />
          </>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-8">
        {balanceQuery.data?.balances.map((balance) => (
          <BalanceEntry
            key={balance.friend.id}
            id={balance.friend.id}
            entity={balance.friend}
            balances={balance.currencies}
            href={`/balances/${balance.friend.id}`}
          />
        ))}
      </div>

      {children?.({ isEmpty })}
    </div>
  );
};

const CumulatedBalanceDisplay: React.FC<{
  prefix?: string;
  className?: string;
  cumulatedBalances?: { currency: string; amount: bigint }[];
  currencies: string[];
}> = ({ prefix = '', className = '', cumulatedBalances, currencies }) => {
  if (!cumulatedBalances || cumulatedBalances.length === 0) {
    return null;
  }

  return (
    <div className={cn('card-surface w-1/2 px-4 py-3', className)}>
      <div className="flex items-center justify-center gap-2 text-center">
        <SectionLabel>{prefix}</SectionLabel>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        <ConvertibleBalance
          balances={cumulatedBalances}
          showMultiOption
          className="flex-wrap"
          overrideCurrencies={currencies}
          forceShowButton={currencies.length > 1}
        />
      </div>
    </div>
  );
};
