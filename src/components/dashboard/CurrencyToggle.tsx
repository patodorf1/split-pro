import React, { useMemo } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';

import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

/**
 * Shown only when the user has expenses in more than one currency: amounts of
 * different currencies are never added together, the user picks one.
 * `extraOptions` suma opciones que no son monedas (en /stats, "todo en dólares blue").
 */
export const CurrencyToggle: React.FC<{
  currencies: string[];
  value: string;
  onChange: (currency: string) => void;
  extraOptions?: SegmentedOption<string>[];
  className?: string;
}> = ({ currencies, value, onChange, extraOptions, className }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();

  const options = useMemo(
    (): SegmentedOption<string>[] =>
      currencies
        .map(
          (currency): SegmentedOption<string> => ({
            value: currency,
            label:
              getCurrencyHelpersCached(currency)
                .formatter.formatToParts(0)
                .find(({ type }) => 'currency' === type)?.value ?? currency,
            title: currency,
          }),
        )
        .concat(extraOptions ?? []),
    [currencies, getCurrencyHelpersCached, extraOptions],
  );

  if (2 > options.length) {
    return null;
  }

  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={onChange}
      size="sm"
      label={t('ui.select_currency')}
      className={className}
    />
  );
};
