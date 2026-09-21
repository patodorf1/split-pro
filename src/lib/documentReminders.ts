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
