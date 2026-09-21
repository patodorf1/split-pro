/**
 * Pure helpers shared by the dashboard (home) and the stats page.
 *
 * Everything here is side-effect free so it can be unit tested and reused both
 * on the server (tRPC `stats` router) and on the client.
 */

import { CATEGORIES, DEFAULT_CATEGORY } from '~/lib/category';

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export const DEFAULT_TIME_ZONE = 'UTC';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const buildFormatter = (timeZone: string): Intl.DateTimeFormat | null => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null;
  }
};

const getPartsFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = buildFormatter(timeZone) ?? buildFormatter(DEFAULT_TIME_ZONE)!;

  formatterCache.set(timeZone, formatter);
  return formatter;
};

const getDateParts = (instant: Date, timeZone: string) => {
  const parts = getPartsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some engines render midnight as `24` when `hour12` is false.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
};

/**
 * Offset (in ms) between the given time zone and UTC at that precise instant.
 * Positive when the zone is ahead of UTC.
 */
export const getTimeZoneOffsetMs = (instant: Date, timeZone: string): number => {
  const { year, month, day, hour, minute, second } = getDateParts(instant, timeZone);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const truncatedToSeconds = Math.floor(instant.getTime() / 1000) * 1000;

  return asIfUtc - truncatedToSeconds;
};

/** The UTC instant at which the given day starts (00:00) in the given time zone. */
export const zonedStartOfDay = (
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date => {
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Two passes so DST transitions right at the boundary settle correctly.
  const firstGuess = wallClock - getTimeZoneOffsetMs(new Date(wallClock), timeZone);

  return new Date(wallClock - getTimeZoneOffsetMs(new Date(firstGuess), timeZone));
};

/** The UTC instant at which the given month starts in the user's time zone. */
export const zonedStartOfMonth = (year: number, month: number, timeZone: string): Date =>
  zonedStartOfDay(year, month, 1, timeZone);

export const addMonths = ({ year, month }: YearMonth, delta: number): YearMonth => {
  const zeroBased = year * 12 + (month - 1) + delta;

  return { year: Math.floor(zeroBased / 12), month: (((zeroBased % 12) + 12) % 12) + 1 };
};

export const compareYearMonth = (a: YearMonth, b: YearMonth): number =>
  a.year * 12 + a.month - (b.year * 12 + b.month);

export const getCurrentYearMonth = (timeZone: string, now: Date = new Date()): YearMonth => {
  const { year, month } = getDateParts(now, timeZone);

  return { year, month };
};

/** Calendar day (year, month 1-12, day) of an instant in the given time zone. */
export const getZonedCalendarDay = (
  timeZone: string,
  now: Date = new Date(),
): YearMonth & { day: number } => {
  const { year, month, day } = getDateParts(now, timeZone);

  return { year, month, day };
};

/**
 * Half-open interval `[from, to)` of UTC instants covering the given month in
 * the user's time zone. `expenseDate` is always compared against this range.
 */
export const getMonthRange = (
  year: number,
  month: number,
  timeZone: string,
): { from: Date; to: Date } => {
  const next = addMonths({ year, month }, 1);

  return {
    from: zonedStartOfMonth(year, month, timeZone),
    to: zonedStartOfMonth(next.year, next.month, timeZone),
  };
};

/**
 * `Expense.expenseDate` is a `timestamp without time zone` holding UTC wall
 * clock values, so raw queries must compare against a literal in that same
 * shape instead of relying on the database session time zone.
 */
export const toUtcTimestampLiteral = (date: Date): string => date.toISOString().slice(0, 23);

/**
 * A participant row stores "what this person paid minus their share": the payer
 * ends up positive, everybody else negative. This turns it back into the plain
 * share of the expense for that user.
 */
export const computeShare = ({
  expenseAmount,
  paidBy,
  userId,
  participantAmount,
}: {
  expenseAmount: bigint;
  paidBy: number;
  userId: number;
  participantAmount: bigint | null | undefined;
}): bigint => {
  if (null === participantAmount || undefined === participantAmount) {
    return 0n;
  }

  return paidBy === userId ? expenseAmount - participantAmount : -participantAmount;
};

/** Share of `part` over `total`, in percent (0-100). */
export const percentageOf = (part: bigint, total: bigint): number => {
  if (0n === total) {
    return 0;
  }

  return (Number(part) / Number(total)) * 100;
};

/**
 * Variation against the previous month, in percent. `null` when there is no
 * previous month to compare against.
 */
export const monthOverMonthChange = (current: bigint, previous: bigint): number | null => {
  if (0n === previous) {
    return null;
  }

  return ((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 100;
};

const SECTION_BY_CATEGORY_ITEM: Record<string, string> = Object.entries(CATEGORIES).reduce<
  Record<string, string>
>((acc, [section, items]) => {
  (items as readonly string[]).forEach((item) => {
    if ('other' !== item) {
      acc[item] = section;
    }
  });
  return acc;
}, {});

/**
 * `Expense.category` holds either a section (when the user picked "other") or a
 * single item. This resolves the key to translate in the `categories`
 * namespace, falling back to the default category for unknown values.
 */
export const getCategoryTranslationKey = (category: string): string => {
  if (category in CATEGORIES) {
    return `categories_list.${category}.name`;
  }

  const section = SECTION_BY_CATEGORY_ITEM[category];

  return section
    ? `categories_list.${section}.items.${category}`
    : `categories_list.${DEFAULT_CATEGORY}.name`;
};
