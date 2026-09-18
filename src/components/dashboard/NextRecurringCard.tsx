import cronParser from 'cron-parser';
import { RefreshCcwDot } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo } from 'react';

import { useIntlCronParser } from '~/hooks/useIntlCronParser';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cronFromBackend } from '~/lib/cron';
import { api } from '~/utils/api';

import { CardHeader, DashboardCard, SectionLabel } from './DashboardCard';

/**
 * Next scheduled recurring expense. Renders nothing when there is none, so the
 * card simply disappears from the dashboard.
 */
export const NextRecurringCard: React.FC = () => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { cronParser: describeCron, i18nReady } = useIntlCronParser();
  const recurringQuery = api.expense.getRecurringExpenses.useQuery();

  const next = useMemo(() => {
    const upcoming = (recurringQuery.data ?? [])
      .filter((item) => item.job.active)
      .flatMap((item) => {
        try {
          const schedule = cronFromBackend(item.job.schedule);

          return [{ item, schedule, at: cronParser.parseExpression(schedule).next().toDate() }];
        } catch {
          console.error(`Failed to parse cron expression: ${item.job.schedule}`);
          return [];
        }
      });

    return upcoming.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
  }, [recurringQuery.data]);

  if (!next) {
    return null;
  }

  const { expense } = next.item;
  const { toUIString } = getCurrencyHelpersCached(expense.currency);

  return (
    <DashboardCard>
      <CardHeader>
        <SectionLabel>{t('dashboard.recurring.title')}</SectionLabel>
      </CardHeader>
      <Link href="/recurring" className="mt-3 flex items-start gap-2">
        <RefreshCcwDot className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-foreground truncate text-sm">{expense.name}</span>
            <span className="text-foreground shrink-0 text-sm font-medium">
              {toUIString(expense.amount)}
            </span>
          </div>
          {i18nReady ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {describeCron(next.schedule)}
            </p>
          ) : null}
        </div>
      </Link>
    </DashboardCard>
  );
};
