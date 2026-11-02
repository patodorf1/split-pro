import { keepPreviousData } from '@tanstack/react-query';
import React, { useCallback, useMemo, useState } from 'react';

import { Bars, MonthlyBars } from '~/components/dashboard/MonthlyBars';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type YearMonth, compareYearMonth } from '~/lib/stats';
import { indexOfMonth, monthsEndingAt, yearlySummaries } from '~/lib/trends';
import { api } from '~/utils/api';

type Scope = 'mine' | 'ours';
type Valuation = 'native' | 'blue';

/** La moneda en la que la inflación hace que los años nuevos parezcan más caros. */
const INFLATION_CURRENCY = 'ARS';

/**
 * Vista "Años" de la tarjeta mes a mes: una barra por año con el promedio por mes de ese año. Tocar
 * un año muestra sus 12 meses abajo; tocar un mes lo elige en la página, como en la vista de meses.
 */
export const YearlyChart: React.FC<{
  selected: YearMonth;
  currentMonth: YearMonth;
  onSelectMonth: (month: YearMonth) => void;
  timeZone: string;
  groupId: number | null;
  currency: string;
  scope: Scope;
  valuation: Valuation;
}> = ({ selected, currentMonth, onSelectMonth, timeZone, groupId, currency, scope, valuation }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const [pickedYear, setPickedYear] = useState<number | null>(null);

  const yearlyQuery = api.stats.yearlyTrend.useQuery(
    { year: currentMonth.year, month: currentMonth.month, timeZone, groupId, valuation },
    { placeholderData: keepPreviousData },
  );

  const values = yearlyQuery.data?.series.find((entry) => entry.currency === currency)?.[scope];
  const years = useMemo(
    () =>
      values
        ? yearlySummaries(monthsEndingAt(currentMonth, values.length), values, currentMonth)
        : [],
    [values, currentMonth],
  );

  // Arranca en el año del mes elegido en la página; si no hay datos de ese año, en el último.
  const shownIndex = useMemo(() => {
    const index = years.findIndex(({ year }) => year === (pickedYear ?? selected.year));
    return -1 === index ? years.length - 1 : index;
  }, [years, pickedYear, selected.year]);
  const shownYear = years[shownIndex];

  const { toUIString } = getCurrencyHelpersCached(currency);
  const items = useMemo(
    () =>
      years.map(({ year, average }) => ({
        key: String(year),
        value: average,
        label: String(year),
        spokenLabel: t('spending_charts.yearly.bar', { year, amount: toUIString(average) }),
      })),
    [years, t, toUIString],
  );

  const handleSelectYear = useCallback(
    (index: number) => {
      const year = years[index];
      if (year) {
        setPickedYear(year.year);
      }
    },
    [years],
  );
  const handleSelectMonth = useCallback(
    (index: number) => {
      const month = shownYear?.months[index];
      // Los meses que todavía no llegaron no se pueden elegir.
      if (month && 0 >= compareYearMonth(month, currentMonth)) {
        onSelectMonth(month);
      }
    },
    [shownYear, currentMonth, onSelectMonth],
  );

  if (yearlyQuery.isPending) {
    return <p className="text-muted-foreground mt-4 text-sm">{t('dashboard.stats.loading')}</p>;
  }

  if (yearlyQuery.isError) {
    return (
      <p className="text-muted-foreground mt-4 text-sm">
        {'dolar_blue_unavailable' === yearlyQuery.error.message
          ? t('spending_charts.blue.unavailable')
          : t('spending_charts.error')}
      </p>
    );
  }

  if (!shownYear) {
    return null;
  }

  return (
    <>
      <p className="text-muted-foreground mt-1 text-xs">{t('spending_charts.yearly.subtitle')}</p>
      {'native' === valuation && INFLATION_CURRENCY === currency ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {t('spending_charts.yearly.inflation')}
        </p>
      ) : null}
      <Bars
        className="mt-4"
        items={items}
        selectedIndex={shownIndex}
        average={0n}
        onSelect={handleSelectYear}
      />
      <p className="text-muted-foreground mt-3 text-center text-xs">
        {t('spending_charts.yearly.hint')}
      </p>

      <div className="border-border mt-4 border-t pt-4">
        <p className="text-foreground text-sm font-semibold">{shownYear.year}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('spending_charts.monthly.average', { amount: toUIString(shownYear.average) })}
        </p>
        <MonthlyBars
          className="mt-4"
          months={shownYear.months}
          values={shownYear.values}
          selectedIndex={indexOfMonth(shownYear.months, selected)}
          currentMonth={currentMonth}
          currency={currency}
          onSelect={handleSelectMonth}
        />
      </div>
    </>
  );
};
