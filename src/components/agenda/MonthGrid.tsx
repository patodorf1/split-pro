import React, { useMemo } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type AgendaKind, parseDay } from '~/lib/agenda';
import { cn } from '~/lib/utils';

/** Color de cada tipo: el mismo en los puntitos de la grilla, la leyenda y los íconos. */
export const KIND_DOT_CLASSES: Record<AgendaKind, string> = {
  event: 'bg-primary',
  expiry: 'bg-destructive',
  recurring: 'bg-positive',
};

const KIND_ORDER: AgendaKind[] = ['event', 'expiry', 'recurring'];

/** Nombres cortos de lunes a domingo en el idioma de la app ("lun", "mar", …). */
const useWeekdayNames = (locale: string) =>
  useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    // 2024-01-01 fue lunes.
    return Array.from({ length: 7 }, (_, index) =>
      format.format(new Date(Date.UTC(2024, 0, 1 + index))).replace(/\.$/, ''),
    );
  }, [locale]);

/** Día completo para lectores de pantalla ("lunes, 5 de octubre de 2026"). */
const useDayLabel = (locale: string) =>
  useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return (key: string) => format.format(new Date(`${key}T00:00:00Z`));
  }, [locale]);

/**
 * Grilla del mes, semanas de lunes a domingo. Hoy va resaltado, el día elegido con un círculo
 * lleno, y debajo de cada número un puntito por tipo de cosa que tenga ese día.
 */
export const MonthGrid: React.FC<{
  days: string[];
  month: number;
  today: string;
  selected: string;
  kindsByDay: Map<string, Set<AgendaKind>>;
  onSelect: (day: string) => void;
}> = ({ days, month, today, selected, kindsByDay, onSelect }) => {
  const { i18n } = useTranslationWithUtils();
  const weekdays = useWeekdayNames(i18n.language);
  const dayLabel = useDayLabel(i18n.language);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7" aria-hidden>
        {weekdays.map((name) => (
          <span
            key={name}
            className="text-muted-foreground pb-1 text-center text-[11px] font-medium tracking-wide uppercase"
          >
            {name}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const parsed = parseDay(day)!;
          const outside = parsed.month !== month;
          const isToday = day === today;
          const isSelected = day === selected;
          const kinds = kindsByDay.get(day);

          return (
            <button
              key={day}
              type="button"
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={dayLabel(day)}
              onClick={() => onSelect(day)}
              className="focus-visible:ring-ring flex h-12 flex-col items-center justify-start gap-0.5 rounded-lg pt-1 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-sm tabular-nums transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : isToday
                      ? 'bg-primary-soft text-primary font-semibold'
                      : outside
                        ? 'text-muted-foreground/50'
                        : 'text-foreground',
                )}
              >
                {parsed.day}
              </span>
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                {KIND_ORDER.filter((kind) => kinds?.has(kind)).map((kind) => (
                  <span
                    key={kind}
                    className={cn(
                      'size-1.5 rounded-full',
                      KIND_DOT_CLASSES[kind],
                      outside && 'opacity-40',
                    )}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Leyenda chiquita de los colores, debajo de la grilla. */
export const KindLegend: React.FC = () => {
  const { t } = useTranslationWithUtils();

  return (
    <ul className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px]">
      {KIND_ORDER.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span className={cn('size-1.5 rounded-full', KIND_DOT_CLASSES[kind])} aria-hidden />
          {t(`agenda.kinds.${kind}`)}
        </li>
      ))}
    </ul>
  );
};
