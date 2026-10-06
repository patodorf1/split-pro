import { z } from 'zod';

import {
  type CalendarDay,
  type DayRange,
  EVENT_REPEATS,
  UPCOMING_DAYS,
  addDaysToKey,
  calendarEventFieldsSchema,
  formatDay,
  parseDay,
  rangeLength,
} from '~/lib/agenda';
import { ExternalApiError, parseExternalBody, personRefSchema } from '~/lib/externalExpense';

/**
 * Parseo puro (sin base) de la API externa de la Agenda, pensada para el asistente por WhatsApp.
 * Ver docs/EXTERNAL_API.md, sección "Agenda".
 */

/** Hasta un año por consulta: alcanza para "¿cuándo era el cumple de X?" sin abrir de más. */
export const MAX_EXTERNAL_AGENDA_DAYS = 366;

/** "weekly", "Weekly" o "WEEKLY" valen lo mismo. */
const repeatSchema = z.preprocess(
  (value) => ('string' === typeof value ? value.trim().toUpperCase() : value),
  z.enum(EVENT_REPEATS),
);

export const externalEventCreateSchema = calendarEventFieldsSchema
  .extend({
    repeat: repeatSchema.default('NONE'),
    createdBy: personRefSchema.optional(),
  })
  .strict();

export const externalEventPatchSchema = calendarEventFieldsSchema
  .extend({ repeat: repeatSchema })
  .partial()
  .strict()
  .refine((patch) => 0 < Object.keys(patch).length, 'Nothing to change');

export type ExternalEventCreate = z.infer<typeof externalEventCreateSchema>;
export type ExternalEventPatch = z.infer<typeof externalEventPatchSchema>;

export const parseExternalEventCreate = (body: unknown) =>
  parseExternalBody(externalEventCreateSchema, body);

export const parseExternalEventPatch = (body: unknown) =>
  parseExternalBody(externalEventPatchSchema, body);

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const badDay = (field: string) =>
  new ExternalApiError(
    400,
    'invalid_date',
    `${field}: tiene que ser una fecha AAAA-MM-DD`,
    `${field}: must be a YYYY-MM-DD date`,
    field,
  );

const readDay = (query: Record<string, string | string[] | undefined>, field: string) => {
  const raw = single(query[field])?.trim();

  if (!raw) {
    return undefined;
  }
  if (!parseDay(raw)) {
    throw badDay(field);
  }

  return raw;
};

/** Minúsculas y sin tildes, para buscar "cumple" en "Cumpleaños de Clari". */
export const normalizeSearch = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

export interface ExternalAgendaQuery {
  range: DayRange;
  /** Texto a buscar ya normalizado, o null. */
  search: string | null;
}

/**
 * `from` y `to` (días incluidos). Sin nada: hoy y los 13 días siguientes, como "Próximos" en la
 * app. Con solo `from`: 14 días desde ahí. Con solo `to`: desde hoy hasta ahí.
 */
export const parseExternalAgendaQuery = (
  query: Record<string, string | string[] | undefined>,
  today: CalendarDay,
): ExternalAgendaQuery => {
  const from = readDay(query, 'from') ?? formatDay(today);
  const to = readDay(query, 'to') ?? addDaysToKey(from, UPCOMING_DAYS - 1);
  const range = { from, to };
  const length = rangeLength(range);

  if (length < 1) {
    throw new ExternalApiError(
      400,
      'invalid_range',
      'to: no puede ser anterior a from',
      'to: cannot be before from',
      'to',
    );
  }
  if (length > MAX_EXTERNAL_AGENDA_DAYS) {
    throw new ExternalApiError(
      400,
      'invalid_range',
      `El rango puede tener como mucho ${MAX_EXTERNAL_AGENDA_DAYS} días`,
      `The range can span at most ${MAX_EXTERNAL_AGENDA_DAYS} days`,
      'to',
    );
  }

  const search = normalizeSearch(single(query.q) ?? '');

  return { range, search: search || null };
};
