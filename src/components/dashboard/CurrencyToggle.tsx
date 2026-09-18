import React, { useMemo } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';

import { SegmentedControl } from './SegmentedControl';

/**
 * Shown only when the user has expenses in more than one currency: amounts of
 * different currencies are never added together, the user picks one.
 */
export const CurrencyToggle: React.FC<{
  currencies: string[];
  value: string;
  onChange: (currency: string) => void;
  className?: string;
}> = ({ currencies, value, onChange, className }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();

  const options = useMemo(
    () =>
      currencies.map((currency) => ({
        value: currency,
        label:
          getCurrencyHelpersCached(currency)
            .formatter.formatToParts(0)
            .find(({ type }) => 'currency' === type)?.value ?? currency,
        title: currency,
      })),
    [currencies, getCurrencyHelpersCached],
  );

  if (2 > currencies.length) {
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
