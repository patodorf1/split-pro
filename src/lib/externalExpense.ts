import { SplitType, type User } from '@prisma/client';
import { z } from 'zod';

import { DEFAULT_CATEGORY, isKnownCategory } from '~/lib/category';
import { CURRENCIES, type CurrencyCode, isCurrencyCode } from '~/lib/currency';
import { buildSettlementInput } from '~/lib/settlement';
import { type SplitShares, calculateParticipantSplit, initSplitShares } from '~/store/addStore';
import type { CreateExpense } from '~/types/expense.types';

/**
 * Parseo y validación de la API externa de gastos (asistente por WhatsApp).
 *
 * Todo lo de acá es puro (sin base de datos) para poder testearlo: recibe el body crudo y los
 * miembros del grupo y devuelve el mismo payload que arma la pantalla /add para
 * `createExpense`. El reparto se calcula con `calculateParticipantSplit`, la misma función que usa
 * la app, y las transferencias con `buildSettlementInput`, así los registros son idénticos.
 */

export const MAX_EXTERNAL_DESCRIPTION_LENGTH = 100;
export const MAX_EXTERNAL_NOTE_LENGTH = 1000;
export const MAX_EXTERNAL_IDEMPOTENCY_KEY_LENGTH = 200;
/** Nombre que la app le pone a una transferencia de saldo en español (`ui.settle_up_name`). */
export const EXTERNAL_SETTLEMENT_NAME = 'Transferencia de saldo';
/**
 * Argentina no tiene horario de verano desde 2009: America/Argentina/Buenos_Aires es siempre
 * UTC-3. Una fecha pura se guarda al mediodía de Buenos Aires (15:00 UTC), igual que el histórico
 * importado, para que ningún corrimiento de zona horaria la cambie de día.
 */
const BUENOS_AIRES_OFFSET = '-03:00';
/** Tope de la parte entera de un importe: 13 dígitos alcanzan de sobra y BigInt no desborda. */
const MAX_INTEGER_DIGITS = 13;

export class ExternalApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly es: string;
  readonly en: string;
  readonly field?: string;

  constructor(status: number, code: string, es: string, en: string, field?: string) {
    super(en);
    this.name = 'ExternalApiError';
    this.status = status;
    this.code = code;
    this.es = es;
    this.en = en;
    this.field = field;
  }

  toJSON() {
    return {
      error: `${this.es} / ${this.en}`,
      code: this.code,
      ...(this.field ? { field: this.field } : {}),
    };
  }
}

const invalid = (field: string, es: string, en: string, code = 'invalid_field') =>
  new ExternalApiError(400, code, `${field}: ${es}`, `${field}: ${en}`, field);

/** Una persona se indica por email o por id de usuario. */
const personRefSchema = z.union([z.number().int().positive(), z.string().trim().min(1).max(254)]);
export type PersonRef = z.infer<typeof personRefSchema>;

/** Valida un id o email suelto (p. ej. `deletedBy` en un DELETE). */
export const parsePersonRef = (value: unknown): PersonRef | undefined => {
  const parsed = personRefSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const amountInputSchema = z.union([z.number(), z.string()]);

const idempotencyKeySchema = z.string().trim().min(1).max(MAX_EXTERNAL_IDEMPOTENCY_KEY_LENGTH);

const splitSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('EQUAL'),
      participants: z.array(personRefSchema).min(1).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal('EXACT'),
      shares: z.record(z.string(), amountInputSchema),
    })
    .strict(),
]);

const expenseBodySchema = z
  .object({
    type: z.literal('expense').optional(),
    description: z.string().trim().min(1).max(MAX_EXTERNAL_DESCRIPTION_LENGTH),
    amount: amountInputSchema,
    currency: z.string().trim().min(1).max(10).optional(),
    paidBy: personRefSchema,
    createdBy: personRefSchema.optional(),
    category: z.string().trim().min(1).max(50).optional(),
    date: z.string().trim().min(1).max(40).optional(),
    split: splitSchema.optional(),
    notes: z.string().trim().max(MAX_EXTERNAL_NOTE_LENGTH).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

const transferBodySchema = z
  .object({
    type: z.literal('transfer'),
    from: personRefSchema,
    to: personRefSchema,
    amount: amountInputSchema,
    currency: z.string().trim().min(1).max(10).optional(),
    createdBy: personRefSchema.optional(),
    description: z.string().trim().min(1).max(MAX_EXTERNAL_DESCRIPTION_LENGTH).optional(),
    date: z.string().trim().min(1).max(40).optional(),
    notes: z.string().trim().max(MAX_EXTERNAL_NOTE_LENGTH).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

const ZOD_MESSAGES_ES: Partial<Record<z.ZodIssueCode, string>> = {
  invalid_type: 'falta o tiene un tipo inválido',
  too_small: 'es obligatorio o es demasiado corto',
  too_big: 'es demasiado largo',
  unrecognized_keys: 'tiene campos desconocidos',
  invalid_literal: 'tiene un valor no permitido',
  invalid_union: 'tiene un formato inválido',
  invalid_union_discriminator: 'tiene un "type" inválido (EQUAL o EXACT)',
};

/** Convierte el primer error de zod en un 400 legible, con el campo que falló. */
export const zodErrorToExternal = (error: z.ZodError): ExternalApiError => {
  // Un campo mal escrito ("paidby") explica mejor el problema que el obligatorio que falta.
  const issue =
    error.issues.find((i) => i.code === z.ZodIssueCode.unrecognized_keys) ?? error.issues[0];
  const field = issue?.path.join('.') || 'body';
  // Un campo que acepta número o texto (paidBy, amount) y no vino da un error de unión: es "falta".
  const isMissing =
    issue?.code === z.ZodIssueCode.invalid_union &&
    issue.unionErrors.every((e) =>
      e.issues.some((i) => i.code === z.ZodIssueCode.invalid_type && 'undefined' === i.received),
    );
  const es = isMissing
    ? 'es obligatorio'
    : ((issue && ZOD_MESSAGES_ES[issue.code]) ?? 'es inválido');
  const en = isMissing ? 'is required' : (issue?.message ?? 'invalid');
  const extra = issue?.code === 'unrecognized_keys' ? ` (${(issue.keys ?? []).join(', ')})` : '';

  // El mensaje en inglés de zod ya nombra los campos desconocidos.
  return invalid(field, `${es}${extra}`, en, 'validation_error');
};

/**
 * Convierte un importe en unidades de moneda (45000.5 o "45000.50") a centavos BigInt, sin pasar
 * por aritmética de punto flotante: se trabaja sobre el texto. Más decimales de los que admite la
 * moneda es un error (no redondeamos en silencio plata de nadie).
 */
export const parseAmountToMinorUnits = (
  value: unknown,
  decimalDigits: number,
  field = 'amount',
  { allowZero = false }: { allowZero?: boolean } = {},
): bigint => {
  let text: string;

  if ('number' === typeof value) {
    if (!Number.isFinite(value)) {
      throw invalid(field, 'debe ser un número', 'must be a number');
    }
    text = String(value);
  } else if ('string' === typeof value) {
    text = value.trim();
  } else {
    throw invalid(field, 'debe ser un número', 'must be a number');
  }

  if (text.startsWith('-')) {
    throw invalid(field, 'debe ser positivo', 'must be positive');
  }

  // String(1e21) o String(1e-7) usan notación exponencial: o es enorme o tiene demasiados decimales.
  if (/e/i.test(text)) {
    throw invalid(
      field,
      'es demasiado grande o tiene demasiados decimales',
      'is too large or has too many decimals',
    );
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);

  if (!match) {
    throw invalid(
      field,
      'debe ser un número con punto decimal, sin separador de miles (ej. 45000.5)',
      'must be a plain number with a dot as decimal separator (e.g. 45000.5)',
    );
  }

  const [, integerPart = '0', fractionPart = ''] = match;

  if (fractionPart.length > decimalDigits) {
    throw invalid(
      field,
      `admite como máximo ${decimalDigits} decimales`,
      `allows at most ${decimalDigits} decimals`,
    );
  }

  if (integerPart.replace(/^0+/, '').length > MAX_INTEGER_DIGITS) {
    throw invalid(field, 'es demasiado grande', 'is too large');
  }

  const multiplier = 10n ** BigInt(decimalDigits);
  const minor =
    BigInt(integerPart) * multiplier + BigInt(fractionPart.padEnd(decimalDigits, '0') || '0');

  if (0n === minor && !allowZero) {
    throw invalid(field, 'debe ser mayor que cero', 'must be greater than zero');
  }

  return minor;
};

const isValidCalendarDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * `YYYY-MM-DD` → ese día al mediodía de Buenos Aires. Un datetime ISO sin zona se interpreta en
 * hora de Buenos Aires. Sin fecha → ahora. Fechas antes de 2000 o a más de un año hacia adelante se
 * rechazan: casi seguro son un error de tipeo.
 */
export const parseExpenseDate = (value: string | undefined, now: Date = new Date()): Date => {
  if (undefined === value) {
    return now;
  }

  let date: Date | undefined;
  const dateOnly = DATE_ONLY.exec(value);
  const dateTime = dateOnly ? null : DATE_TIME.exec(value);
  const parts = dateOnly ?? dateTime;

  if (!parts || !isValidCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))) {
    throw invalid(
      'date',
      'debe ser una fecha YYYY-MM-DD o un datetime ISO 8601',
      'must be a YYYY-MM-DD date or an ISO 8601 datetime',
    );
  }

  if (dateOnly) {
    date = new Date(`${value}T12:00:00${BUENOS_AIRES_OFFSET}`);
  } else {
    const hasZone = Boolean(dateTime?.[7]);
    date = new Date(hasZone ? value : `${value}${BUENOS_AIRES_OFFSET}`);
  }

  if (Number.isNaN(date.getTime())) {
    throw invalid('date', 'no es una fecha válida', 'is not a valid date');
  }

  const oneYearAhead = now.getTime() + 366 * 24 * 60 * 60 * 1000;

  if (date.getUTCFullYear() < 2000 || date.getTime() > oneYearAhead) {
    throw invalid('date', 'está fuera de rango', 'is out of range');
  }

  return date;
};

/**
 * Busca a una persona SOLO entre los miembros del grupo, por id o por email (sin distinguir
 * mayúsculas). Si no es miembro es un 400: nunca se puede asignar a alguien de afuera.
 */
export const resolveMember = <T extends Pick<User, 'id' | 'email'>>(
  ref: PersonRef,
  members: T[],
  field: string,
): T => {
  const text = String(ref).trim();
  const asId = 'number' === typeof ref ? ref : /^\d+$/.test(text) ? Number(text) : undefined;

  const member =
    undefined !== asId
      ? members.find((m) => m.id === asId)
      : members.find((m) => m.email?.toLowerCase() === text.toLowerCase());

  if (!member) {
    throw invalid(
      field,
      `"${String(ref)}" no es miembro de este grupo`,
      `"${String(ref)}" is not a member of this group`,
      'not_a_member',
    );
  }

  return member;
};

export interface ExternalGroupContext<TMember extends User = User> {
  groupId: number;
  defaultCurrency: string | null;
  members: TMember[];
}

export interface ParsedExternalEntry<TMember extends User = User> {
  kind: 'expense' | 'transfer';
  input: CreateExpense & { expenseDate: Date };
  createdBy: TMember;
  notes?: string;
  idempotencyKey?: string;
}

const resolveCurrency = (value: string | undefined, groupCurrency: string | null) => {
  const currency = (value ?? groupCurrency ?? '').toUpperCase();

  if (!currency) {
    throw invalid(
      'currency',
      'es obligatoria: el grupo no tiene moneda por defecto',
      'is required: the group has no default currency',
    );
  }

  if (!isCurrencyCode(currency)) {
    throw invalid(
      'currency',
      `"${currency}" no es una moneda válida`,
      `"${currency}" is not a valid currency code`,
    );
  }

  return currency;
};

const decimalsOf = (currency: CurrencyCode) => CURRENCIES[currency].decimalDigits;

const assertNoDuplicates = (members: { id: number }[], field: string) => {
  const ids = members.map((m) => m.id);
  if (new Set(ids).size !== ids.length) {
    throw invalid(field, 'hay una persona repetida', 'contains the same person twice');
  }
};

/** Body de un POST → payload de `createExpense`, validado contra los miembros del grupo. */
export const parseExternalEntry = <TMember extends User>(
  rawBody: unknown,
  group: ExternalGroupContext<TMember>,
  now: Date = new Date(),
): ParsedExternalEntry<TMember> => {
  if (!rawBody || 'object' !== typeof rawBody || Array.isArray(rawBody)) {
    throw invalid('body', 'debe ser un objeto JSON', 'must be a JSON object');
  }

  if ('type' in rawBody && 'transfer' === rawBody.type) {
    const parsed = transferBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw zodErrorToExternal(parsed.error);
    }
    return parseTransfer(parsed.data, group, now);
  }

  const parsed = expenseBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    throw zodErrorToExternal(parsed.error);
  }
  return parseExpense(parsed.data, group, now);
};

const parseTransfer = <TMember extends User>(
  body: z.infer<typeof transferBodySchema>,
  group: ExternalGroupContext<TMember>,
  now: Date,
): ParsedExternalEntry<TMember> => {
  const currency = resolveCurrency(body.currency, group.defaultCurrency);
  const amount = parseAmountToMinorUnits(body.amount, decimalsOf(currency));
  const sender = resolveMember(body.from, group.members, 'from');
  const receiver = resolveMember(body.to, group.members, 'to');

  if (sender.id === receiver.id) {
    throw invalid(
      'to',
      'no puede ser la misma persona que "from"',
      'cannot be the same person as "from"',
    );
  }

  const createdBy = body.createdBy
    ? resolveMember(body.createdBy, group.members, 'createdBy')
    : sender;
  const expenseDate = parseExpenseDate(body.date, now);

  const input = buildSettlementInput({
    sender,
    receiver,
    amount,
    currency,
    groupId: group.groupId,
    name: body.description ?? EXTERNAL_SETTLEMENT_NAME,
    expenseDate,
  });

  return {
    kind: 'transfer',
    input: { ...input, expenseDate },
    createdBy,
    notes: body.notes || undefined,
    idempotencyKey: body.idempotencyKey,
  };
};

const parseExpense = <TMember extends User>(
  body: z.infer<typeof expenseBodySchema>,
  group: ExternalGroupContext<TMember>,
  now: Date,
): ParsedExternalEntry<TMember> => {
  const currency = resolveCurrency(body.currency, group.defaultCurrency);
  const decimals = decimalsOf(currency);
  const amount = parseAmountToMinorUnits(body.amount, decimals);
  const paidBy = resolveMember(body.paidBy, group.members, 'paidBy');
  const createdBy = body.createdBy
    ? resolveMember(body.createdBy, group.members, 'createdBy')
    : paidBy;
  const category = body.category ?? DEFAULT_CATEGORY;

  if (!isKnownCategory(category)) {
    throw invalid(
      'category',
      `"${category}" no es una categoría conocida`,
      `"${category}" is not a known category`,
      'unknown_category',
    );
  }

  const expenseDate = parseExpenseDate(body.date, now);

  let splitType: SplitType = SplitType.EQUAL;
  let involved: TMember[];
  const shares = new Map<number, bigint>();

  if (!body.split) {
    // Por defecto: partes iguales entre TODOS los miembros del grupo, como /add en un grupo.
    involved = group.members;
    involved.forEach((m) => shares.set(m.id, 1n));
  } else if ('EQUAL' === body.split.type) {
    const chosen = body.split.participants.map((ref, i) =>
      resolveMember(ref, group.members, `split.participants.${i}`),
    );
    assertNoDuplicates(chosen, 'split.participants');
    involved = chosen;
    chosen.forEach((m) => shares.set(m.id, 1n));
  } else {
    splitType = SplitType.EXACT;
    const entries = Object.entries(body.split.shares);

    if (0 === entries.length) {
      throw invalid('split.shares', 'no puede estar vacío', 'cannot be empty');
    }

    involved = entries.map(([ref]) => resolveMember(ref, group.members, `split.shares.${ref}`));
    assertNoDuplicates(involved, 'split.shares');
    entries.forEach(([ref, value], i) =>
      shares.set(
        involved[i]!.id,
        parseAmountToMinorUnits(value, decimals, `split.shares.${ref}`, { allowZero: true }),
      ),
    );

    const total = [...shares.values()].reduce((acc, v) => acc + v, 0n);

    if (total !== amount) {
      throw invalid(
        'split.shares',
        `las partes suman ${formatMinor(total, decimals)} y el total es ${formatMinor(amount, decimals)}`,
        `shares add up to ${formatMinor(total, decimals)} but amount is ${formatMinor(amount, decimals)}`,
        'split_mismatch',
      );
    }
  }

  // Quien pagó siempre participa (con parte 0 si no le toca nada), igual que en /add.
  const participants = involved.some((m) => m.id === paidBy.id) ? involved : [...involved, paidBy];

  const splitShares: SplitShares = Object.fromEntries(
    participants.map((m) => {
      const byType = initSplitShares() as Record<SplitType, bigint | undefined>;
      byType[splitType] = shares.get(m.id) ?? 0n;
      return [m.id, byType];
    }),
  );

  const result = calculateParticipantSplit({
    amount,
    participants,
    splitType,
    splitShares,
    paidBy,
    expenseDate,
    isNegative: false,
  });

  if (!result.canSplitScreenClosed) {
    throw invalid('split', 'el reparto no cierra', 'the split does not add up', 'split_mismatch');
  }

  return {
    kind: 'expense',
    input: {
      name: body.description,
      currency,
      amount,
      splitType,
      category,
      groupId: group.groupId,
      paidBy: paidBy.id,
      participants: result.participants.map((p) => ({ userId: p.id, amount: p.amount ?? 0n })),
      expenseDate,
    },
    createdBy,
    notes: body.notes || undefined,
    idempotencyKey: body.idempotencyKey,
  };
};

/** Centavos → número en unidades (22500.5). Suficiente para importes reales (< 2^53). */
export const minorToUnits = (value: bigint, currency: string): number => {
  const decimals = isCurrencyCode(currency) ? decimalsOf(currency) : 2;
  return Number(value) / 10 ** decimals;
};

const formatMinor = (value: bigint, decimals: number) => {
  const multiplier = 10n ** BigInt(decimals);
  const integer = value / multiplier;
  const fraction = (value % multiplier).toString().padStart(decimals, '0');
  return 0 < decimals ? `${integer}.${fraction}` : `${integer}`;
};

/** Límite del listado de gastos: 10 por defecto, entre 1 y 50. */
export const parseListLimit = (value: string | undefined): number => {
  if (undefined === value || '' === value) {
    return 10;
  }

  if (!/^\d+$/.test(value) || 1 > Number(value) || 50 < Number(value)) {
    throw invalid(
      'limit',
      'debe ser un entero entre 1 y 50',
      'must be an integer between 1 and 50',
    );
  }

  return Number(value);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | undefined): value is string =>
  undefined !== value && UUID.test(value);
