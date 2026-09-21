import { CATEGORIES, isKnownCategory } from '~/lib/category';
import { ExternalApiError, parseListLimit } from '~/lib/externalExpense';
import { getCategoryTranslationKey, zonedStartOfDay } from '~/lib/stats';
import { getCurrencyHelpers } from '~/utils/numbers';

import categoriesEsAr from '../../public/locales/es-AR/categories.json';

/**
 * Consultas de la API externa (asistente por WhatsApp): parseo de parámetros de la URL y armado
 * de los textos en castellano. Todo puro, sin base de datos, para poder testearlo.
 *
 * Las fechas (`from`, `to`) son días calendario de Buenos Aires, inclusive en los dos extremos.
 * Por dentro se convierten al intervalo semiabierto [inicio de `from`, inicio del día después de
 * `to`) con la misma función que usa /stats para los meses (`zonedStartOfDay`), así un mes pedido
 * por la API es exactamente el mismo intervalo que muestra la app.
 */

export const SUMMARY_TIME_ZONE = 'America/Argentina/Buenos_Aires';
export const MAX_RANGE_YEARS = 10;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_LIST_OFFSET = 10_000;

export const SUMMARY_DIMENSIONS = ['month', 'category', 'payer'] as const;
export type SummaryDimension = (typeof SUMMARY_DIMENSIONS)[number];

export type EntryKind = 'expense' | 'transfer';

export interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface Period {
  from: CalendarDay;
  to: CalendarDay;
}

type QueryValue = string | string[] | undefined;
export type RawQuery = Partial<Record<string, QueryValue>>;

const invalid = (field: string, es: string, en: string, code = 'invalid_field') =>
  new ExternalApiError(400, code, `${field}: ${es}`, `${field}: ${en}`, field);

/** Un parámetro repetido (`?from=a&from=b`) es ambiguo: 400 en vez de elegir uno en silencio. */
const readParam = (query: RawQuery, field: string): string | undefined => {
  const value = query[field];

  if (Array.isArray(value)) {
    if (1 < value.length) {
      throw invalid(field, 'está repetido', 'is repeated');
    }
    return value[0];
  }

  return value;
};

// ── Días calendario ──────────────────────────────────────────────────────────────────────────

const toUtcMs = ({ year, month, day }: CalendarDay) => Date.UTC(year, month - 1, day);

const fromUtcMs = (ms: number): CalendarDay => {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

export const addDays = (day: CalendarDay, delta: number): CalendarDay =>
  fromUtcMs(toUtcMs(day) + delta * 24 * 60 * 60 * 1000);

export const compareDays = (a: CalendarDay, b: CalendarDay): number => toUtcMs(a) - toUtcMs(b);

export const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const formatDay = ({ year, month, day }: CalendarDay): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` válido (existe en el calendario, entre 2000 y 2100). */
export const parseDayParam = (
  value: string | undefined,
  field: string,
): CalendarDay | undefined => {
  if (undefined === value || '' === value.trim()) {
    return undefined;
  }

  const match = DAY_PATTERN.exec(value.trim());
  const day = match
    ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    : undefined;

  // Date.UTC corre el 30 de febrero al 2 de marzo: si vuelve distinto, la fecha no existe.
  const roundTrip = day ? fromUtcMs(toUtcMs(day)) : undefined;

  if (!day || roundTrip?.month !== day.month || roundTrip.day !== day.day) {
    throw invalid(field, 'debe ser una fecha YYYY-MM-DD', 'must be a YYYY-MM-DD date');
  }

  if (2000 > day.year || 2100 < day.year) {
    throw invalid(field, 'está fuera de rango', 'is out of range');
  }

  return day;
};

/**
 * Período pedido. Sin `from` ni `to`: el mes en curso (o ninguno, si `defaultToCurrentMonth` es
 * falso, como en el listado). Solo `from`: hasta hoy. Solo `to`: desde el 1 de ese mes.
 */
export const resolvePeriod = (
  rawFrom: CalendarDay | undefined,
  rawTo: CalendarDay | undefined,
  today: CalendarDay,
  { defaultToCurrentMonth }: { defaultToCurrentMonth: boolean },
): Period | undefined => {
  if (!rawFrom && !rawTo) {
    if (!defaultToCurrentMonth) {
      return undefined;
    }
    return {
      from: { year: today.year, month: today.month, day: 1 },
      to: { year: today.year, month: today.month, day: lastDayOfMonth(today.year, today.month) },
    };
  }

  const from = rawFrom ?? { year: rawTo!.year, month: rawTo!.month, day: 1 };
  const to = rawTo ?? (0 < compareDays(from, today) ? from : today);

  if (0 < compareDays(from, to)) {
    throw invalid(
      'from',
      'no puede ser posterior a "to"',
      'cannot be later than "to"',
      'invalid_range',
    );
  }

  // Tope: hasta 10 años calendario (del 2016-09-21 al 2026-09-20 entra; un día más, no).
  const limit = addDays(
    fromUtcMs(Date.UTC(from.year + MAX_RANGE_YEARS, from.month - 1, from.day)),
    -1,
  );

  if (0 < compareDays(to, limit)) {
    throw invalid(
      'to',
      `el rango no puede superar ${MAX_RANGE_YEARS} años`,
      `the range cannot exceed ${MAX_RANGE_YEARS} years`,
      'range_too_long',
    );
  }

  return { from, to };
};

/** Período en días de Buenos Aires → instantes UTC [start, end) para comparar con `expenseDate`. */
export const periodToInstants = (
  period: Period,
  timeZone: string = SUMMARY_TIME_ZONE,
): { start: Date; end: Date } => {
  const next = addDays(period.to, 1);

  return {
    start: zonedStartOfDay(period.from.year, period.from.month, period.from.day, timeZone),
    end: zonedStartOfDay(next.year, next.month, next.day, timeZone),
  };
};

// ── Filtros ──────────────────────────────────────────────────────────────────────────────────

export const parseGroupBy = (value: string | undefined): SummaryDimension[] => {
  if (undefined === value || '' === value.trim()) {
    return [];
  }

  const parts = value.split(',').map((part) => part.trim().toLowerCase());
  const unknown = parts.find((part) => !(SUMMARY_DIMENSIONS as readonly string[]).includes(part));

  if (undefined !== unknown) {
    throw invalid(
      'groupBy',
      `"${unknown}" no es válido (usá month, category, payer o combinaciones separadas por coma)`,
      `"${unknown}" is not valid (use month, category, payer or a comma separated combination)`,
    );
  }

  if (new Set(parts).size !== parts.length) {
    throw invalid('groupBy', 'tiene un valor repetido', 'contains a repeated value');
  }

  // Orden fijo (mes, categoría, pagador) sin importar cómo vino: la respuesta es predecible.
  return SUMMARY_DIMENSIONS.filter((dimension) => parts.includes(dimension));
};

/** Una o varias claves de categoría separadas por coma, todas conocidas. */
export const parseCategories = (value: string | undefined): string[] | undefined => {
  if (undefined === value || '' === value.trim()) {
    return undefined;
  }

  const keys = [...new Set(value.split(',').map((part) => part.trim()))];

  for (const key of keys) {
    if (!key || !isKnownCategory(key)) {
      throw invalid(
        'category',
        `"${key}" no es una categoría conocida`,
        `"${key}" is not a known category`,
        'unknown_category',
      );
    }
  }

  return keys;
};

/**
 * Texto buscado en la descripción, normalizado: minúsculas y sin acentos ("Estefí" → "estefi").
 * La base aplica la misma normalización a la descripción con `translate` (ver
 * `SEARCH_ACCENTED` / `SEARCH_PLAIN`), así que se compara igual contra igual.
 */
export const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();

/** Letras con acento que la base reemplaza antes de comparar; `SEARCH_PLAIN` es su versión sin. */
export const SEARCH_ACCENTED = 'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÝÑÇáàâäãåéèêëíìîïóòôöõúùûüýÿñç';
export const SEARCH_PLAIN = 'AAAAAAEEEEIIIIOOOOOUUUUYNCaaaaaaeeeeiiiiooooouuuuyync';

export const parseSearch = (
  value: string | undefined,
): { raw: string; normalized: string } | undefined => {
  if (undefined === value) {
    return undefined;
  }

  // Caracteres de control afuera y espacios colapsados: lo que queda es texto normal.
  const raw = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) {
    return undefined;
  }

  if (MAX_SEARCH_LENGTH < raw.length) {
    throw invalid(
      'q',
      `admite como máximo ${MAX_SEARCH_LENGTH} caracteres`,
      `allows at most ${MAX_SEARCH_LENGTH} characters`,
    );
  }

  return { raw, normalized: normalizeSearchText(raw) };
};

export const parseEntryKind = (value: string | undefined): EntryKind | undefined => {
  if (undefined === value || '' === value.trim()) {
    return undefined;
  }

  const kind = value.trim().toLowerCase();

  if ('expense' !== kind && 'transfer' !== kind) {
    throw invalid('type', 'debe ser expense o transfer', 'must be expense or transfer');
  }

  return kind;
};

export const parseOffset = (value: string | undefined): number => {
  if (undefined === value || '' === value) {
    return 0;
  }

  if (!/^\d+$/.test(value) || MAX_LIST_OFFSET < Number(value)) {
    throw invalid(
      'offset',
      `debe ser un entero entre 0 y ${MAX_LIST_OFFSET}`,
      `must be an integer between 0 and ${MAX_LIST_OFFSET}`,
    );
  }

  return Number(value);
};

const SUMMARY_PARAMS = new Set(['groupId', 'from', 'to', 'groupBy', 'category', 'q', 'paidBy']);
const LIST_FILTER_PARAMS = ['from', 'to', 'category', 'q', 'paidBy', 'type', 'offset'] as const;

/** Un parámetro mal escrito (`catgory`) no se ignora en silencio: devolvería el total sin filtrar. */
const assertKnownParams = (query: RawQuery, allowed: Set<string>) => {
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));

  if (0 < unknown.length) {
    throw invalid(
      unknown[0]!,
      `parámetro desconocido (${unknown.join(', ')})`,
      `unknown parameter (${unknown.join(', ')})`,
      'unknown_parameter',
    );
  }
};

export interface SummaryQuery {
  period: Period;
  groupBy: SummaryDimension[];
  categories?: string[];
  search?: { raw: string; normalized: string };
  paidBy?: string;
}

export const parseSummaryQuery = (query: RawQuery, today: CalendarDay): SummaryQuery => {
  assertKnownParams(query, SUMMARY_PARAMS);

  const period = resolvePeriod(
    parseDayParam(readParam(query, 'from'), 'from'),
    parseDayParam(readParam(query, 'to'), 'to'),
    today,
    { defaultToCurrentMonth: true },
  )!;
  const paidBy = readParam(query, 'paidBy')?.trim();

  return {
    period,
    groupBy: parseGroupBy(readParam(query, 'groupBy')),
    categories: parseCategories(readParam(query, 'category')),
    search: parseSearch(readParam(query, 'q')),
    paidBy: paidBy || undefined,
  };
};

export interface ExpenseListQuery {
  limit: number;
  offset: number;
  /** `true` si vino algún parámetro nuevo: sin ninguno, el listado es exactamente el de siempre. */
  filtered: boolean;
  period?: Period;
  categories?: string[];
  search?: { raw: string; normalized: string };
  paidBy?: string;
  type?: EntryKind;
}

/**
 * A diferencia del resumen, el listado no rechaza parámetros desconocidos: antes los ignoraba y
 * tiene que seguir haciéndolo (compatibilidad con quien ya lo llama).
 */
export const parseExpenseListQuery = (query: RawQuery, today: CalendarDay): ExpenseListQuery => {
  const paidBy = readParam(query, 'paidBy')?.trim();

  return {
    // `limit` se lee como siempre (el primero si viene repetido).
    limit: parseListLimit(Array.isArray(query.limit) ? query.limit[0] : query.limit),
    offset: parseOffset(readParam(query, 'offset')),
    filtered: LIST_FILTER_PARAMS.some((param) => undefined !== query[param]),
    period: resolvePeriod(
      parseDayParam(readParam(query, 'from'), 'from'),
      parseDayParam(readParam(query, 'to'), 'to'),
      today,
      { defaultToCurrentMonth: false },
    ),
    categories: parseCategories(readParam(query, 'category')),
    search: parseSearch(readParam(query, 'q')),
    paidBy: paidBy || undefined,
    type: parseEntryKind(readParam(query, 'type')),
  };
};

// ── Textos ───────────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? String(month);

/** Nombre en castellano (es-AR) de una clave de categoría, el mismo que muestra la app. */
export const categoryDisplayName = (category: string): string => {
  const path = getCategoryTranslationKey(category).split('.');
  let node: unknown = categoriesEsAr;

  for (const key of path) {
    node = node && 'object' === typeof node ? (node as Record<string, unknown>)[key] : undefined;
  }

  return 'string' === typeof node ? node : category;
};

/** Todas las claves de categoría válidas (para la documentación y los mensajes). */
export const ALL_CATEGORY_KEYS: string[] = [
  ...new Set(
    Object.entries(CATEGORIES).flatMap(([section, items]) => [
      section,
      ...(items as readonly string[]).filter((item) => 'other' !== item),
    ]),
  ),
];

export const formatMoney = (minor: bigint, currency: string): string =>
  getCurrencyHelpers({ currency, locale: 'es-AR' }).toUIString(minor);

const isFirstOfMonth = (day: CalendarDay) => 1 === day.day;
const isLastOfMonth = (day: CalendarDay) => day.day === lastDayOfMonth(day.year, day.month);

const dayLabel = (day: CalendarDay, withYear: boolean) =>
  `${day.day} de ${monthName(day.month)}${withYear ? ` de ${day.year}` : ''}`;

/** "en enero de 2026", "en 2026", "de enero a marzo de 2026", "del 3 al 10 de mayo de 2026"… */
export const periodLabel = ({ from, to }: Period): string => {
  const sameYear = from.year === to.year;

  if (isFirstOfMonth(from) && isLastOfMonth(to)) {
    if (sameYear && from.month === to.month) {
      return `en ${monthName(from.month)} de ${from.year}`;
    }
    if (1 === from.month && 12 === to.month) {
      return sameYear ? `en ${from.year}` : `entre ${from.year} y ${to.year}`;
    }
    return sameYear
      ? `de ${monthName(from.month)} a ${monthName(to.month)} de ${to.year}`
      : `de ${monthName(from.month)} de ${from.year} a ${monthName(to.month)} de ${to.year}`;
  }

  if (0 === compareDays(from, to)) {
    return `el ${dayLabel(from, true)}`;
  }

  if (sameYear && from.month === to.month) {
    return `del ${from.day} al ${dayLabel(to, true)}`;
  }

  return `del ${dayLabel(from, !sameYear)} al ${dayLabel(to, true)}`;
};

/** Meses del período como `YYYY-MM`, en orden ("2026-07", "2026-08", "2026-09"). */
export const monthKeysOf = ({ from, to }: Period): string[] => {
  const keys: string[] = [];

  for (let y = from.year, m = from.month; y < to.year || (y === to.year && m <= to.month); ) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (12 < m) {
      m = 1;
      y += 1;
    }
  }

  return keys;
};

/** "2026-01" → "enero de 2026" (o "enero" si todos los meses son del mismo año). */
export const monthKeyLabel = (key: string, withYear = true): string => {
  const [year, month] = key.split('-').map(Number);
  return withYear ? `${monthName(month ?? 0)} de ${year}` : monthName(month ?? 0);
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${1 === count ? singular : pluralForm}`;

export const formatPercent = (value: number): string => `${Math.round(value)} %`;

const joinList = (items: string[], conjunction = 'y') =>
  1 >= items.length
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;

export interface SummaryTextPerson {
  name: string;
  amount: bigint;
}

export interface SummaryTextBreakdownItem {
  month?: string;
  categoryName?: string;
  payerName?: string;
  total: bigint;
  percentage: number;
}

export interface SummaryTextCurrency {
  currency: string;
  total: bigint;
  count: number;
  paid: SummaryTextPerson[];
  breakdown?: SummaryTextBreakdownItem[];
}

export interface SummaryTextInput {
  period: Period;
  groupBy: SummaryDimension[];
  categoryNames?: string[];
  search?: string;
  payerName?: string;
  currencies: SummaryTextCurrency[];
}

/** Top 3 de categorías, o los meses (hasta 12; si son más, el más caro). */
const breakdownSentence = (
  entry: SummaryTextCurrency,
  groupBy: SummaryDimension[],
  withCurrency: boolean,
): string | null => {
  const items = entry.breakdown ?? [];

  if (1 !== groupBy.length || 0 === items.length || 'payer' === groupBy[0]) {
    return null;
  }

  const prefix = withCurrency ? ` (${entry.currency})` : '';
  const money = (value: bigint) => formatMoney(value, entry.currency);

  if ('category' === groupBy[0]) {
    const top = items
      .slice(0, 3)
      .map(
        (item) => `${item.categoryName} ${money(item.total)} (${formatPercent(item.percentage)})`,
      );
    return `Lo que más${prefix}: ${top.join(', ')}.`;
  }

  const months = items.filter((item) => item.month);
  const sameYear = new Set(months.map((item) => item.month!.slice(0, 4))).size <= 1;

  if (12 < months.length) {
    const max = months.reduce((best, item) => (item.total > best.total ? item : best));
    return `El mes más caro${prefix} fue ${monthKeyLabel(max.month!)}, con ${money(max.total)}.`;
  }

  const list = months.map(
    (item) => `${monthKeyLabel(item.month!, !sameYear)} ${money(item.total)}`,
  );
  return `Por mes${prefix}: ${list.join(', ')}.`;
};

/**
 * Frase lista para leer, p. ej. "En enero de 2026 gastaron $ 1.234.567,89 en 84 gastos (Pato puso
 * $ 700.000, Belén $ 534.567,89)." Con filtros los nombra ("de Combustible", "con “estefi”") y con
 * un solo `groupBy` suma el top 3 de categorías o el detalle por mes.
 */
export const buildSummaryText = (input: SummaryTextInput): string => {
  const when = capitalize(periodLabel(input.period));
  const filterParts: string[] = [];

  if (input.categoryNames?.length) {
    filterParts.push(`de ${joinList(input.categoryNames, 'o')}`);
  }
  if (input.search) {
    filterParts.push(`con “${input.search}”`);
  }

  const filters = filterParts.length ? ` ${filterParts.join(' ')}` : '';
  const withSpending = input.currencies.filter((entry) => 0 < entry.count);

  if (0 === withSpending.length) {
    return input.payerName
      ? `${when} ${input.payerName} no pagó gastos${filters}.`
      : `${when} no hubo gastos${filters}.`;
  }

  const clauses = withSpending.map((entry) => {
    const money = (value: bigint) => formatMoney(value, entry.currency);
    const base = `${money(entry.total)} en ${plural(entry.count, 'gasto', 'gastos')}${filters}`;

    if (input.payerName) {
      return base;
    }

    const payers = entry.paid.filter((person) => 0n < person.amount);

    if (1 === payers.length) {
      return `${base} (pagó todo ${payers[0]!.name})`;
    }

    const detail = payers.map((person, index) =>
      0 === index
        ? `${person.name} puso ${money(person.amount)}`
        : `${person.name} ${money(person.amount)}`,
    );
    return detail.length ? `${base} (${detail.join(', ')})` : base;
  });

  const verb = input.payerName ? `${input.payerName} pagó` : 'gastaron';
  const sentences = [`${when} ${verb} ${joinList(clauses)}.`];

  withSpending.forEach((entry) => {
    const sentence = breakdownSentence(entry, input.groupBy, 1 < withSpending.length);
    if (sentence) {
      sentences.push(sentence);
    }
  });

  return sentences.join(' ');
};
