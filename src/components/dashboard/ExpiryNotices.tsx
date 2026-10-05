import { CalendarDaysIcon, ChevronRightIcon, ClockIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DocumentViewer } from '~/components/documents/DocumentViewer';
import {
  type DocumentFileRef,
  downloadDocument,
  getViewerKind,
} from '~/components/documents/documentClient';
import { useTimeZone } from '~/components/dashboard/hooks';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { formatDay } from '~/lib/agenda';
import { REMINDER_VISIBLE_ITEMS } from '~/lib/documentReminders';
import { getZonedCalendarDay } from '~/lib/stats';
import { cn } from '~/lib/utils';
import { type RouterOutputs, api } from '~/utils/api';

type Expiry = RouterOutputs['documents']['upcomingExpiries'][number];
type TodayEvent = Extract<RouterOutputs['calendar']['range'][number], { kind: 'event' }>;

const useExpiryLabel = () => {
  const { t } = useTranslationWithUtils();

  return useCallback(
    (daysLeft: number) => {
      if (0 === daysLeft) {
        return t('dashboard.expiry.today');
      }
      if (0 < daysLeft) {
        return t('dashboard.expiry.in_days', { count: daysLeft });
      }
      return t('dashboard.expiry.ago', { count: -daysLeft });
    },
    [t],
  );
};

/** Saca un documento de la lista al instante; si el servidor falla, lo devuelve. */
const useHideExpiry = () => {
  const { t } = useTranslationWithUtils();
  const utils = api.useUtils();

  return {
    onMutate: async ({ id }: { id: string }) => {
      await utils.documents.upcomingExpiries.cancel();
      const previous = utils.documents.upcomingExpiries.getData();
      utils.documents.upcomingExpiries.setData(undefined, (items) =>
        items?.filter((item) => item.id !== id),
      );
      return { previous };
    },
    onError: (_error: unknown, _input: { id: string }, context?: { previous?: Expiry[] }) => {
      if (context?.previous) {
        utils.documents.upcomingExpiries.setData(undefined, context.previous);
      }
      toast.error(t('documents.errors.generic'));
    },
    onSettled: () => utils.documents.upcomingExpiries.invalidate(),
  };
};

const ExpiryRow: React.FC<{
  item: Expiry;
  onOpen: (item: Expiry) => void;
  onSnooze: (id: string) => void;
  onDismiss: (id: string) => void;
}> = ({ item, onOpen, onSnooze, onDismiss }) => {
  const { t } = useTranslationWithUtils();
  const expiryLabel = useExpiryLabel();
  const urgent = 0 >= item.daysLeft;

  return (
    <li className="flex min-w-0 items-center gap-1 py-0.5">
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1 text-left text-xs"
      >
        <span className="text-muted-foreground min-w-0 truncate">
          <span className="text-muted-foreground/80">{item.folderName}</span>
          <span aria-hidden> · </span>
          <span className="text-foreground/90">{item.name}</span>
        </span>
        <span
          className={cn(
            'shrink-0 whitespace-nowrap',
            urgent ? 'text-destructive/90' : 'text-muted-foreground',
          )}
        >
          {expiryLabel(item.daysLeft)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onSnooze(item.id)}
        aria-label={t('dashboard.expiry.snooze', { name: item.name })}
        title={t('dashboard.expiry.snooze', { name: item.name })}
        className="text-muted-foreground/70 hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        <ClockIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={t('dashboard.expiry.dismiss', { name: item.name })}
        title={t('dashboard.expiry.dismiss', { name: item.name })}
        className="text-muted-foreground/70 hover:text-foreground -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        <XIcon className="size-3.5" />
      </button>
    </li>
  );
};

/** Eventos propios de la Agenda para hoy (turnos, cumpleaños…), en el día del teléfono. */
const useTodayEvents = (): TodayEvent[] => {
  const timeZone = useTimeZone();
  const today = useMemo(() => formatDay(getZonedCalendarDay(timeZone)), [timeZone]);
  const todayQuery = api.calendar.range.useQuery({ from: today, to: today, timeZone });

  return useMemo(
    () => (todayQuery.data ?? []).filter((item): item is TodayEvent => 'event' === item.kind),
    [todayQuery.data],
  );
};

const TodayEventRow: React.FC<{ item: TodayEvent }> = ({ item }) => {
  const { t } = useTranslationWithUtils();

  return (
    <li className="py-0.5">
      <Link href="/agenda" className="flex min-w-0 items-center gap-2 py-1 text-sm">
        <CalendarDaysIcon className="text-primary size-4 shrink-0" />
        <span className="text-primary shrink-0 text-xs font-semibold tracking-wide uppercase">
          {t('agenda.today')}
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate">
          {item.time ? `${item.time} · ` : ''}
          {item.title}
        </span>
        <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
      </Link>
    </li>
  );
};

/**
 * Avisos de arriba de Inicio: primero lo que hay hoy en la Agenda (tocarlo lleva a la Agenda) y
 * después los documentos por vencer (próximos 7 días) o vencidos, que se abren, posponen o
 * descartan. Si no hay nada, no ocupa lugar.
 */
export const ExpiryNotices: React.FC = () => {
  const { t } = useTranslationWithUtils();
  const todayEvents = useTodayEvents();
  const expiriesQuery = api.documents.upcomingExpiries.useQuery();
  const hideHandlers = useHideExpiry();
  const snooze = api.documents.snoozeReminder.useMutation(hideHandlers);
  const dismiss = api.documents.dismissReminder.useMutation(hideHandlers);
  const [viewing, setViewing] = useState<DocumentFileRef | null>(null);

  const onOpen = useCallback((item: Expiry) => {
    const ref = { id: item.id, name: item.name, mimeType: item.mimeType };

    if (getViewerKind(item.mimeType)) {
      setViewing(ref);
    } else {
      downloadDocument(ref);
    }
  }, []);
  const closeViewer = useCallback(() => setViewing(null), []);
  const onSnooze = useCallback((id: string) => snooze.mutate({ id }), [snooze]);
  const onDismiss = useCallback((id: string) => dismiss.mutate({ id }), [dismiss]);

  const items = expiriesQuery.data ?? [];
  const viewer = <DocumentViewer document={viewing} onClose={closeViewer} />;

  if (0 === items.length && 0 === todayEvents.length) {
    // Sin avisos no ocupa lugar (salvo el visor, si justo se descartó el último con un documento abierto).
    return viewing ? viewer : null;
  }

  const visible = items.slice(0, REMINDER_VISIBLE_ITEMS);
  const hidden = items.length - visible.length;

  return (
    <section
      aria-label={t('dashboard.expiry.title')}
      className={cn(
        'rounded-xl border px-3 py-1',
        0 < todayEvents.length
          ? 'border-primary/30 bg-primary-soft'
          : 'border-border/60 bg-muted/30',
      )}
    >
      <ul className="divide-border/50 divide-y">
        {todayEvents.map((item) => (
          <TodayEventRow key={item.key} item={item} />
        ))}
        {visible.map((item) => (
          <ExpiryRow
            key={item.id}
            item={item}
            onOpen={onOpen}
            onSnooze={onSnooze}
            onDismiss={onDismiss}
          />
        ))}
      </ul>
      {0 < hidden ? (
        <Link href="/documents" className="text-muted-foreground block py-1 text-xs">
          {t('dashboard.expiry.more', { count: hidden })}
        </Link>
      ) : null}
      {viewer}
    </section>
  );
};
