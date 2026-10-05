import { keepPreviousData } from '@tanstack/react-query';
import { CalendarDaysIcon, PlusIcon } from 'lucide-react';
import Head from 'next/head';
import React, { useCallback, useMemo, useState } from 'react';

import { type AgendaItem, AgendaItemRow } from '~/components/agenda/AgendaItemRow';
import { EventEditor } from '~/components/agenda/EventEditor';
import { KindLegend, MonthGrid } from '~/components/agenda/MonthGrid';
import { MonthSwitcher } from '~/components/dashboard/MonthSwitcher';
import { useTimeZone } from '~/components/dashboard/hooks';
import { DocumentViewer } from '~/components/documents/DocumentViewer';
import {
  type DocumentFileRef,
  downloadDocument,
  getViewerKind,
} from '~/components/documents/documentClient';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import {
  type AgendaKind,
  addDaysToKey,
  formatDay,
  monthGrid,
  parseDay,
  upcomingRange,
} from '~/lib/agenda';
import { type YearMonth, addMonths, getZonedCalendarDay } from '~/lib/stats';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

interface GroupOption {
  id: number;
  name: string;
  defaultForAdd: boolean;
  eventCount: number;
}

/**
 * Grupo donde se guardan los eventos nuevos: el que ya tiene eventos (en la práctica, "Casa"); si
 * no, el elegido por defecto para agregar gastos; si hay uno solo, ese. Si no se puede decidir,
 * la hoja muestra el selector.
 */
const pickDefaultGroupId = (groups: GroupOption[]): number | null => {
  const withEvents = [...groups].sort((a, b) => b.eventCount - a.eventCount)[0];

  if (withEvents && 0 < withEvents.eventCount) {
    return withEvents.id;
  }

  return (
    groups.find((group) => group.defaultForAdd)?.id ?? (1 === groups.length ? groups[0]!.id : null)
  );
};

/** "Lunes 5 de octubre" en el idioma de la app. */
const useLongDayLabel = (locale: string) =>
  useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
    return (key: string) => {
      const label = format.format(new Date(`${key}T00:00:00Z`));
      return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
    };
  }, [locale]);

const groupByDay = (items: AgendaItem[]) => {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  }
  return byDay;
};

const ItemList: React.FC<{
  items: AgendaItem[];
  onOpenDocument: (item: Extract<AgendaItem, { kind: 'expiry' }>) => void;
}> = ({ items, onOpenDocument }) => (
  <Card className="px-0 py-0">
    <ul className="divide-border divide-y">
      {items.map((item) => (
        <li key={item.key}>
          <AgendaItemRow item={item} onOpenDocument={onOpenDocument} />
        </li>
      ))}
    </ul>
  </Card>
);

const AgendaPage: NextPageWithUser = () => {
  const { t, i18n } = useTranslationWithUtils();
  const timeZone = useTimeZone();
  const longDayLabel = useLongDayLabel(i18n.language);

  const today = useMemo(() => formatDay(getZonedCalendarDay(timeZone)), [timeZone]);
  const [month, setMonth] = useState<YearMonth>(() => {
    const { year, month: current } = getZonedCalendarDay(timeZone);
    return { year, month: current };
  });
  const [selected, setSelected] = useState(today);
  const [viewing, setViewing] = useState<DocumentFileRef | null>(null);

  const grid = useMemo(() => monthGrid(month.year, month.month), [month]);
  // "Próximos" arranca mañana: lo de hoy ya está arriba (hoy es el día elegido al entrar).
  const upcoming = useMemo(() => upcomingRange(addDaysToKey(today, 1)), [today]);

  const gridQuery = api.calendar.range.useQuery(
    { from: grid.from, to: grid.to, timeZone },
    { placeholderData: keepPreviousData },
  );
  const upcomingQuery = api.calendar.range.useQuery({ ...upcoming, timeZone });
  const groupsQuery = api.calendar.groups.useQuery();

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const defaultGroupId = useMemo(() => pickDefaultGroupId(groups), [groups]);

  const gridByDay = useMemo(() => groupByDay(gridQuery.data ?? []), [gridQuery.data]);
  const kindsByDay = useMemo(() => {
    const result = new Map<string, Set<AgendaKind>>();
    for (const [day, items] of gridByDay) {
      result.set(day, new Set(items.map((item) => item.kind)));
    }
    return result;
  }, [gridByDay]);
  const upcomingByDay = useMemo(
    () => [...groupByDay(upcomingQuery.data ?? []).entries()],
    [upcomingQuery.data],
  );

  const selectedItems = gridByDay.get(selected) ?? [];

  /** Al cambiar de mes queda elegido hoy (si es ese mes) o el día 1. */
  const goToMonth = useCallback(
    (next: YearMonth) => {
      setMonth(next);
      const todayParts = parseDay(today)!;
      setSelected(
        todayParts.year === next.year && todayParts.month === next.month
          ? today
          : formatDay({ ...next, day: 1 }),
      );
    },
    [today],
  );
  const goPrevious = useCallback(() => goToMonth(addMonths(month, -1)), [goToMonth, month]);
  const goNext = useCallback(() => goToMonth(addMonths(month, 1)), [goToMonth, month]);
  const goToday = useCallback(() => {
    const { year, month: current } = parseDay(today)!;
    goToMonth({ year, month: current });
  }, [goToMonth, today]);

  const onSelect = useCallback(
    (day: string) => {
      const parsed = parseDay(day)!;
      // Tocar un día gris (del mes de al lado) también cambia de mes.
      if (parsed.month !== month.month || parsed.year !== month.year) {
        setMonth({ year: parsed.year, month: parsed.month });
      }
      setSelected(day);
    },
    [month],
  );

  const onOpenDocument = useCallback(
    (item: { documentId: string; title: string; mimeType: string }) => {
      const ref = { id: item.documentId, name: item.title, mimeType: item.mimeType };

      if (getViewerKind(item.mimeType)) {
        setViewing(ref);
      } else {
        downloadDocument(ref);
      }
    },
    [],
  );
  const closeViewer = useCallback(() => setViewing(null), []);

  const dayHeading = (day: string) => {
    if (day === today) {
      return t('agenda.today');
    }
    if (day === addDaysToKey(today, 1)) {
      return t('agenda.tomorrow');
    }
    return longDayLabel(day);
  };

  const addButton = (date: string, trigger: React.ReactNode) => (
    <EventEditor
      mode="create"
      groups={groups}
      defaultGroupId={defaultGroupId}
      initialDate={date}
      trigger={trigger}
    />
  );

  const actions = addButton(
    selected,
    <Button variant="ghost" size="icon" className="size-9" aria-label={t('agenda.add_event')}>
      <PlusIcon className="text-primary size-6" />
    </Button>,
  );

  const todayParts = parseDay(today)!;
  const isCurrentMonth =
    selected === today && todayParts.month === month.month && todayParts.year === month.year;

  return (
    <>
      <Head>
        <title>{t('agenda.title')}</title>
      </Head>
      <MainLayout title={t('agenda.title')} actions={actions}>
        <div className="flex flex-col gap-5 pb-8">
          <Card className="flex flex-col gap-2 px-2 pt-2 pb-3">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <MonthSwitcher month={month} canGoForward onPrevious={goPrevious} onNext={goNext} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary h-8 shrink-0 px-3 text-xs font-semibold"
                disabled={isCurrentMonth}
                aria-label={t('agenda.go_today')}
                onClick={goToday}
              >
                {t('agenda.today')}
              </Button>
            </div>
            <MonthGrid
              days={grid.days}
              month={month.month}
              today={today}
              selected={selected}
              kindsByDay={kindsByDay}
              onSelect={onSelect}
            />
            <KindLegend />
          </Card>

          <section className="flex flex-col gap-2" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>{dayHeading(selected)}</SectionLabel>
              {0 < selectedItems.length
                ? addButton(
                    selected,
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary h-8 gap-1 px-2 text-xs font-semibold"
                    >
                      <PlusIcon className="size-4" />
                      {t('agenda.add_event')}
                    </Button>,
                  )
                : null}
            </div>
            {0 < selectedItems.length ? (
              <ItemList items={selectedItems} onOpenDocument={onOpenDocument} />
            ) : (
              <Card className="flex flex-col items-center gap-3 py-6 text-center">
                <span className="bg-primary-soft text-primary flex size-11 items-center justify-center rounded-full">
                  <CalendarDaysIcon className="size-5" />
                </span>
                <p className="text-muted-foreground text-sm">
                  {gridQuery.isPending ? '…' : t('agenda.day_empty')}
                </p>
                {addButton(
                  selected,
                  <Button size="sm" className="gap-1">
                    <PlusIcon className="size-4" />
                    {t('agenda.add_event')}
                  </Button>,
                )}
              </Card>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <SectionLabel>{t('agenda.upcoming')}</SectionLabel>
            {upcomingQuery.isError || gridQuery.isError ? (
              <p className="text-destructive text-sm">{t('agenda.errors.load')}</p>
            ) : null}
            {upcomingQuery.isSuccess && 0 === upcomingByDay.length ? (
              <p className="text-muted-foreground text-sm">{t('agenda.upcoming_empty')}</p>
            ) : null}
            {upcomingByDay.map(([day, items]) => (
              <div key={day} className="flex flex-col gap-1.5">
                <p className="text-muted-foreground px-1 text-xs font-medium">{dayHeading(day)}</p>
                <ItemList items={items} onOpenDocument={onOpenDocument} />
              </div>
            ))}
          </section>
        </div>
        <DocumentViewer document={viewing} onClose={closeViewer} />
      </MainLayout>
    </>
  );
};

AgendaPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default AgendaPage;
