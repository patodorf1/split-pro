import { useCallback, useMemo, useState } from 'react';

import {
  DEFAULT_TIME_ZONE,
  type YearMonth,
  addMonths,
  compareYearMonth,
  getCurrentYearMonth,
} from '~/lib/stats';

/**
 * Time zone of the device, used to decide where each month starts and ends.
 * Falls back to UTC when the browser does not expose it (or during SSR).
 */
export const useTimeZone = (): string =>
  useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }, []);

export const useCurrentYearMonth = (timeZone: string): YearMonth =>
  useMemo(() => getCurrentYearMonth(timeZone), [timeZone]);

/** Month navigation that never goes past the current month. */
export const useMonthNavigation = (timeZone: string) => {
  const currentMonth = useCurrentYearMonth(timeZone);
  const [selected, setSelected] = useState<YearMonth>(currentMonth);

  const canGoForward =
    selected.year < currentMonth.year ||
    (selected.year === currentMonth.year && selected.month < currentMonth.month);

  const goBackward = useCallback(() => setSelected((month) => addMonths(month, -1)), []);
  const goForward = useCallback(
    () => setSelected((month) => (canGoForward ? addMonths(month, 1) : month)),
    [canGoForward],
  );

  const goTo = useCallback(
    (month: YearMonth) =>
      setSelected(0 < compareYearMonth(month, currentMonth) ? currentMonth : month),
    [currentMonth],
  );

  return { selected, currentMonth, canGoForward, goBackward, goForward, goTo };
};

/**
 * Keeps the chosen currency valid as data changes: it prefers what the user
 * picked, then their default currency, then whatever is available.
 */
export const useSelectedCurrency = (available: string[], preferred?: string | null) => {
  const [picked, setPicked] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (picked && available.includes(picked)) {
      return picked;
    }
    if (preferred && available.includes(preferred)) {
      return preferred;
    }
    return available[0] ?? preferred ?? '';
  }, [picked, available, preferred]);

  return [selected, setPicked] as const;
};
