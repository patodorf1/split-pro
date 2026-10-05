import { CalendarDaysIcon, ChevronRightIcon, FileClockIcon } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import { EventEditor } from '~/components/agenda/EventEditor';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cn } from '~/lib/utils';
import { type RouterOutputs } from '~/utils/api';

export type AgendaItem = RouterOutputs['calendar']['range'][number];
type ExpiryItem = Extract<AgendaItem, { kind: 'expiry' }>;

const ROW_CLASSES =
  'flex min-h-[56px] w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left active:opacity-70';

const ICON_CLASSES = 'flex size-9 shrink-0 items-center justify-center rounded-full';

const RowBody: React.FC<{
  icon: React.ReactNode;
  iconClassName: string;
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
}> = ({ icon, iconClassName, title, subtitle, trailing }) => (
  <>
    <span className={cn(ICON_CLASSES, iconClassName)}>{icon}</span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-foreground truncate text-sm font-medium">{title}</span>
      <span className="text-muted-foreground truncate text-xs">{subtitle}</span>
    </span>
    {trailing}
  </>
);

/**
 * Una fila de la Agenda. Cada tipo hace lo suyo al tocarla: el evento propio abre su edición, el
 * vencimiento abre el documento y el gasto recurrente lleva al gasto.
 */
export const AgendaItemRow: React.FC<{
  item: AgendaItem;
  onOpenDocument: (item: ExpiryItem) => void;
}> = ({ item, onOpenDocument }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();

  if ('event' === item.kind) {
    const when = item.time ?? t('agenda.all_day');
    const subtitle = [when, 'NONE' === item.repeat ? null : t(`agenda.repeat.${item.repeat}`)]
      .concat(item.note ? [item.note] : [])
      .filter(Boolean)
      .join(' · ');

    return (
      <EventEditor
        mode="edit"
        event={item}
        trigger={
          <button type="button" className={ROW_CLASSES}>
            <RowBody
              icon={<CalendarDaysIcon className="size-4" />}
              iconClassName="bg-primary-soft text-primary"
              title={item.title}
              subtitle={subtitle}
            />
          </button>
        }
      />
    );
  }

  if ('expiry' === item.kind) {
    return (
      <button type="button" className={ROW_CLASSES} onClick={() => onOpenDocument(item)}>
        <RowBody
          icon={<FileClockIcon className="size-4" />}
          iconClassName="bg-destructive/10 text-destructive"
          title={item.title}
          subtitle={t('agenda.expiry_label', { folder: item.folderName })}
        />
      </button>
    );
  }

  const { toUIString } = getCurrencyHelpersCached(item.currency);

  return (
    <Link href={`/expenses/${item.expenseId}`} className={ROW_CLASSES}>
      <RowBody
        icon={<CategoryIcon category={item.category} className="size-4" />}
        iconClassName="bg-positive-soft text-positive"
        title={item.title}
        subtitle={t('agenda.recurring_label')}
        trailing={
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-foreground text-sm font-medium tabular-nums">
              {toUIString(item.amount)}
            </span>
            <ChevronRightIcon className="text-muted-foreground size-4" />
          </span>
        }
      />
    </Link>
  );
};
