import { z } from 'zod';

import { normalizeSearch } from '~/lib/externalCalendar';
import {
  type PersonRef,
  parseExternalBody,
  personRefSchema,
  readSingleQueryParam,
} from '~/lib/externalExpense';
import { MAX_TODOS_PER_BATCH, MAX_TODO_TITLE_LENGTH, cleanTodoTitle } from '~/lib/todo';

/**
 * Parseo y textos puros (sin base) de la API externa del To Do de la casa, pensada para Charly.
 * Las reglas del título son las de `src/lib/todo.ts`, las mismas que la app.
 * Ver docs/EXTERNAL_API.md, sección "To Do".
 */

/** Cuántas hechas se devuelven si no se pide otra cosa, y el máximo que se puede pedir. */
export const DEFAULT_EXTERNAL_TODO_DONE = 10;
export const MAX_EXTERNAL_TODO_DONE = 50;

/** El título como se va a ver (sin viñetas ni espacios de más); si queda vacío, falta. */
const titleSchema = z
  .string()
  .max(MAX_TODO_TITLE_LENGTH)
  .transform(cleanTodoTitle)
  .pipe(z.string().min(1));

const addSchema = z
  .object({
    items: z.array(titleSchema).min(1).max(MAX_TODOS_PER_BATCH),
    addedBy: personRefSchema.optional(),
  })
  .strict();

const patchSchema = z
  .object({
    title: titleSchema.optional(),
    done: z.boolean().optional(),
    doneBy: personRefSchema.optional(),
  })
  .strict()
  .refine((patch) => undefined !== patch.title || undefined !== patch.done, 'Nothing to change');

export interface ExternalTodoAdd {
  items: string[];
  addedBy?: PersonRef;
}

export type ExternalTodoPatch = z.infer<typeof patchSchema>;

/** Minúsculas y sin tildes: "Arreglar la canilla" y "arreglar la cánilla" son la misma tarea. */
export const todoKey = (title: string): string => normalizeSearch(title);

/** Los títulos repetidos en el mismo pedido cuentan una vez (se queda el primero). */
export const parseExternalTodoAdd = (body: unknown): ExternalTodoAdd => {
  const parsed = parseExternalBody(addSchema, body);
  const seen = new Set<string>();
  const items = parsed.items.filter((title) => {
    const key = todoKey(title);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return { items, addedBy: parsed.addedBy };
};

export const parseExternalTodoPatch = (body: unknown): ExternalTodoPatch =>
  parseExternalBody(patchSchema, body);

/** `?done=N`: cuántas hechas traer (las más recientes). Un valor raro vuelve al default. */
export const parseExternalTodoQuery = (query: Record<string, string | string[] | undefined>) => {
  const raw = Number(readSingleQueryParam(query.done));
  const doneLimit =
    Number.isInteger(raw) && 0 <= raw
      ? Math.min(raw, MAX_EXTERNAL_TODO_DONE)
      : DEFAULT_EXTERNAL_TODO_DONE;

  return { doneLimit };
};

/** Lo pendiente, para contestar por WhatsApp tal cual. */
export const todoListText = (pending: readonly { title: string }[]): string =>
  0 === pending.length
    ? 'No hay nada pendiente en el To Do de la casa.'
    : `Para hacer en la casa (${pending.length}): ${pending.map((item) => item.title).join(', ')}.`;

export interface TodoAddOutcome {
  title: string;
  /** `added`: entró ahora; `already`: ya estaba pendiente y no se repitió. */
  status: 'added' | 'already';
}

/** "Sumé al To Do: Cambiar el foco. Ya estaba: Pintar la reja." */
export const todoAddText = (outcomes: readonly TodoAddOutcome[]): string => {
  const added = outcomes.filter((outcome) => 'added' === outcome.status);
  const already = outcomes.filter((outcome) => 'already' === outcome.status);
  const parts: string[] = [];

  if (0 < added.length) {
    parts.push(`Sumé al To Do: ${added.map((outcome) => outcome.title).join(', ')}.`);
  }
  if (0 < already.length) {
    parts.push(
      `${1 === already.length ? 'Ya estaba' : 'Ya estaban'}: ${already.map((outcome) => outcome.title).join(', ')}.`,
    );
  }

  return parts.join(' ');
};
