import { getZonedCalendarDay, zonedStartOfDay } from '~/lib/stats';

/** Los días se cuentan por fecha de calendario en Argentina, sin importar la zona del teléfono. */
export const REMINDER_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Se avisa lo que vence dentro de esta cantidad de días (y lo ya vencido). */
export const REMINDER_WINDOW_DAYS = 7;

/** "Posponer" esconde el aviso por este tiempo. */
export const REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Cuántos avisos se ven en Inicio antes del "+N más". */
export const REMINDER_VISIBLE_ITEMS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const calendarDayNumber = (instant: Date, timeZone: string) => {
  const { year, month, day } = getZonedCalendarDay(timeZone, instant);

  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
};

/**
 * Días de calendario desde hoy hasta el vencimiento (en la zona dada): 0 = vence hoy,
 * negativo = ya venció.
 */
export const calendarDaysUntil = (
  expiresAt: Date,
  now: Date,
  timeZone: string = REMINDER_TIME_ZONE,
): number => calendarDayNumber(expiresAt, timeZone) - calendarDayNumber(now, timeZone);

/**
 * Fecha de vencimiento como día de calendario en Argentina, "dd/mm/aaaa" (la misma cuenta que usan
 * los avisos de Inicio, así un documento que "vence hoy" muestra la fecha de hoy).
 */
export const formatExpiryDate = (
  expiresAt: Date,
  timeZone: string = REMINDER_TIME_ZONE,
): string => {
  const { year, month, day } = getZonedCalendarDay(timeZone, expiresAt);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${pad(day)}/${pad(month)}/${year}`;
};

const EXPIRY_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2027-02-02" → el instante que se guarda en `expiresAt`: el mediodía UTC de ese día (las 9 en
 * Argentina), así el día de calendario es el mismo en cualquier zona de América. Devuelve null si
 * no es una fecha real ("2027-02-30") o tiene otro formato.
 */
export const parseExpiryDay = (text: string): Date | null => {
  const match = EXPIRY_DAY_PATTERN.exec(text.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    1900 > year ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

/** Día de calendario (en Argentina) de un vencimiento, "aaaa-mm-dd": la inversa de `parseExpiryDay`. */
export const expiryDayKey = (expiresAt: Date, timeZone: string = REMINDER_TIME_ZONE): string => {
  const { year, month, day } = getZonedCalendarDay(timeZone, expiresAt);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${year}-${pad(month)}-${pad(day)}`;
};

/** Ya venció: su día de calendario (en Argentina) es anterior a hoy. Vencer hoy no cuenta. */
export const isExpired = (
  expiresAt: Date,
  now: Date,
  timeZone: string = REMINDER_TIME_ZONE,
): boolean => 0 > calendarDaysUntil(expiresAt, now, timeZone);

/**
 * Primer instante que ya queda FUERA de la ventana de aviso: el comienzo del día
 * `hoy + REMINDER_WINDOW_DAYS + 1`. Todo vencimiento anterior (incluidos los pasados) entra.
 */
export const reminderWindowEnd = (now: Date, timeZone: string = REMINDER_TIME_ZONE): Date => {
  const { year, month, day } = getZonedCalendarDay(timeZone, now);

  return zonedStartOfDay(year, month, day + REMINDER_WINDOW_DAYS + 1, timeZone);
};

export interface ReminderState {
  snoozedUntil: Date | null;
  dismissedForExpiresAt: Date | null;
}

/**
 * Si el aviso se muestra: vence dentro de la ventana (o ya venció), no está pospuesto y no fue
 * descartado para ESTE vencimiento (si la fecha cambió después de descartarlo, vuelve).
 */
export const isReminderVisible = (
  expiresAt: Date | null,
  state: ReminderState | null | undefined,
  now: Date,
  timeZone: string = REMINDER_TIME_ZONE,
): expiresAt is Date => {
  if (!expiresAt || calendarDaysUntil(expiresAt, now, timeZone) > REMINDER_WINDOW_DAYS) {
    return false;
  }
  if (state?.snoozedUntil && state.snoozedUntil.getTime() > now.getTime()) {
    return false;
  }
  if (state?.dismissedForExpiresAt?.getTime() === expiresAt.getTime()) {
    return false;
  }

  return true;
};
