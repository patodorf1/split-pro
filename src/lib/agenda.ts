import { z } from 'zod';

/**
 * Agenda de la casa: helpers puros (sin base, sin `window`) compartidos por la pantalla y el
 * router `calendar`.
 *
 * Los días viajan como texto "AAAA-MM-DD" (día de calendario, sin zona horaria) y se cuentan como
 * "número de día" (días desde 1970-01-01) para sumar y comparar sin pelearse con husos ni con el
 * cambio de horario.
 */

export const MAX_EVENT_TITLE_LENGTH = 80;
export const MAX_EVENT_NOTE_LENGTH = 200;

/** Cuántos días mira la sección "Próximos" (hoy incluido). */
export const UPCOMING_DAYS = 14;

/** Rango máximo que acepta una consulta (una grilla de mes ocupa como mucho 42 días). */
export const MAX_RANGE_DAYS = 62;

export const EVENT_REPEATS = ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type EventRepeat = (typeof EVENT_REPEATS)[number];

export interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** "2026-02-29" → null (no existe); "2026-10-05" → { 2026, 10, 5 }. */
export const parseDay = (value: string): CalendarDay | null => {
  const match = DAY_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
};

export const formatDay = ({ year, month, day }: CalendarDay): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** Días desde 1970-01-01. Acepta días "desbordados" (32 de enero = 1 de febrero). */
export const toDayNumber = ({ year, month, day }: CalendarDay): number =>
  Math.round(Date.UTC(year, month - 1, day) / DAY_MS);

export const fromDayNumber = (dayNumber: number): CalendarDay => {
  const date = new Date(dayNumber * DAY_MS);

  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

export const dayKeyFromNumber = (dayNumber: number): string => formatDay(fromDayNumber(dayNumber));

export const addDaysToKey = (key: string, days: number): string => {
  const parsed = parseDay(key);

  if (!parsed) {
    throw new Error(`Invalid day: ${key}`);
  }

  return dayKeyFromNumber(toDayNumber(parsed) + days);
};

/** Día de la semana con lunes = 0 … domingo = 6. */
export const mondayBasedWeekday = (dayNumber: number): number =>
  // 1970-01-01 fue jueves (3 contando desde el lunes).
  (((dayNumber + 3) % 7) + 7) % 7;

/** Fecha de la base (`@db.Date`, medianoche UTC) → "AAAA-MM-DD". */
export const dayKeyFromDbDate = (date: Date): string => date.toISOString().slice(0, 10);

/** "AAAA-MM-DD" → fecha para guardar en una columna `@db.Date`. */
export const dbDateFromDayKey = (key: string): Date => new Date(`${key}T00:00:00.000Z`);

export interface DayRange {
  from: string;
  to: string;
}

/**
 * Grilla de un mes con semanas de lunes a domingo: desde el lunes de la primera semana hasta el
 * domingo de la última. Devuelve el rango y los días (múltiplo de 7, entre 28 y 42).
 */
export const monthGrid = (year: number, month: number): DayRange & { days: string[] } => {
  const first = toDayNumber({ year, month, day: 1 });
  const last = toDayNumber({ year, month, day: daysInMonth(year, month) });
  const start = first - mondayBasedWeekday(first);
  const end = last + (6 - mondayBasedWeekday(last));
  const days: string[] = [];

  for (let current = start; current <= end; current += 1) {
    days.push(dayKeyFromNumber(current));
  }

  return { from: days[0]!, to: days[days.length - 1]!, days };
};

/** Rango de "Próximos": desde hoy, `UPCOMING_DAYS` días (hoy incluido). */
export const upcomingRange = (today: string, days: number = UPCOMING_DAYS): DayRange => ({
  from: today,
  to: addDaysToKey(today, days - 1),
});

/** Mismo día del mes, o el último día si ese mes no lo tiene (31 → 30/28, 29 de febrero → 28). */
const clampedDay = (year: number, month: number, day: number): number =>
  toDayNumber({ year, month, day: Math.min(day, daysInMonth(year, month)) });

/**
 * Días ("AAAA-MM-DD") en que cae un evento dentro de `[from, to]` (ambos incluidos), según su
 * repetición. Un evento repetido nunca aparece antes de su fecha de inicio.
 */
export const expandOccurrences = (
  event: { date: string; repeat: EventRepeat },
  range: DayRange,
): string[] => {
  const start = parseDay(event.date);
  const fromDay = parseDay(range.from);
  const toDay = parseDay(range.to);

  if (!start || !fromDay || !toDay) {
    return [];
  }

  const startNumber = toDayNumber(start);
  const fromNumber = Math.max(toDayNumber(fromDay), startNumber);
  const toNumber = toDayNumber(toDay);

  if (fromNumber > toNumber) {
    return [];
  }

  const result: number[] = [];

  switch (event.repeat) {
    case 'NONE': {
      if (startNumber >= fromNumber && startNumber <= toNumber) {
        result.push(startNumber);
      }
      break;
    }
    case 'WEEKLY': {
      const offset = (((fromNumber - startNumber) % 7) + 7) % 7;
      for (let current = fromNumber + ((7 - offset) % 7); current <= toNumber; current += 7) {
        result.push(current);
      }
      break;
    }
    case 'MONTHLY': {
      const from = fromDayNumber(fromNumber);
      let year = from.year;
      let month = from.month;
      for (;;) {
        const current = clampedDay(year, month, start.day);
        if (current > toNumber) {
          break;
        }
        if (current >= fromNumber) {
          result.push(current);
        }
        month += 1;
        if (12 < month) {
          month = 1;
          year += 1;
        }
      }
      break;
    }
    case 'YEARLY': {
      const lastYear = fromDayNumber(toNumber).year;
      for (let year = fromDayNumber(fromNumber).year; year <= lastYear; year += 1) {
        const current = clampedDay(year, start.month, start.day);
        if (current >= fromNumber && current <= toNumber) {
          result.push(current);
        }
      }
      break;
    }
    default:
      break;
  }

  return result.map(dayKeyFromNumber);
};

/** Cantidad de días de un rango, ambos extremos incluidos (0 si está al revés o es inválido). */
export const rangeLength = ({ from, to }: DayRange): number => {
  const fromDay = parseDay(from);
  const toDay = parseDay(to);

  if (!fromDay || !toDay) {
    return 0;
  }

  return Math.max(0, toDayNumber(toDay) - toDayNumber(fromDay) + 1);
};

const collapseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

export const dayKeySchema = z.string().refine((value) => null !== parseDay(value), 'invalid_day');

export const calendarEventFieldsSchema = z.object({
  title: z.string().transform(collapseSpaces).pipe(z.string().min(1).max(MAX_EVENT_TITLE_LENGTH)),
  date: dayKeySchema,
  /** Hora "HH:MM"; vacío o null = todo el día. */
  time: z
    .string()
    .nullish()
    .transform((value) => (value ?? '').trim())
    .pipe(z.union([z.literal(''), z.string().regex(TIME_PATTERN)]))
    .transform((value) => value || null),
  note: z
    .string()
    .nullish()
    .transform((value) => (value ?? '').trim())
    .pipe(z.string().max(MAX_EVENT_NOTE_LENGTH))
    .transform((value) => value || null),
  repeat: z.enum(EVENT_REPEATS),
});

export type CalendarEventFields = z.infer<typeof calendarEventFieldsSchema>;

/** Tipos de cosas que muestra la Agenda (definen el color del puntito y el ícono). */
export type AgendaKind = 'event' | 'expiry' | 'recurring';

/**
 * Orden de una lista de cosas de la Agenda: por día; dentro del día, primero lo de "todo el día",
 * después por hora, y a igual hora por tipo y título.
 */
export const compareAgendaItems = (
  a: { date: string; time: string | null; kind: AgendaKind; title: string },
  b: { date: string; time: string | null; kind: AgendaKind; title: string },
): number => {
  if (a.date !== b.date) {
    return a.date < b.date ? -1 : 1;
  }
  const timeA = a.time ?? '';
  const timeB = b.time ?? '';
  if (timeA !== timeB) {
    return timeA < timeB ? -1 : 1;
  }
  const kindOrder: Record<AgendaKind, number> = { event: 0, expiry: 1, recurring: 2 };
  if (a.kind !== b.kind) {
    return kindOrder[a.kind] - kindOrder[b.kind];
  }
  return a.title.localeCompare(b.title);
};
