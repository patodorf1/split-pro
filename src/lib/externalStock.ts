import { z } from 'zod';

import { type PersonRef, parseExternalBody, personRefSchema } from '~/lib/externalExpense';
import { cleanShoppingItemName } from '~/lib/shopping';
import { MAX_STOCK_NOTE_LENGTH, STOCK_SECTIONS, type StockSection, stockKey } from '~/lib/stock';

/**
 * Parseo y textos puros (sin base) de la API externa del Stock, pensada para Charly. Las reglas de
 * nombres son las de `src/lib/stock.ts`; acá solo se valida lo que llega y se arma la respuesta.
 * Ver docs/EXTERNAL_API.md, sección "Stock".
 */

/** Hasta 30 productos por pedido: alcanza para descargar una compra grande del súper. */
export const MAX_EXTERNAL_STOCK_BATCH = 30;

/** Cómo se llama cada sección en la app (es-AR). La API devuelve la clave y el nombre. */
export const STOCK_SECTION_LABELS: Record<StockSection, string> = {
  FRIDGE: 'Heladera',
  FREEZER: 'Freezer',
  PANTRY: 'Alacena',
  PRODUCE: 'Frutas y verduras',
  CLEANING: 'Limpieza',
};

/** "fridge", "Fridge" o "FRIDGE" valen lo mismo. */
const sectionSchema = z.preprocess(
  (value) => ('string' === typeof value ? value.trim().toUpperCase() : value),
  z.enum(STOCK_SECTIONS),
);

/** El nombre como se va a ver (sin viñetas ni puntuación de borde); si queda vacío, falta. */
const nameSchema = z.string().max(200).transform(cleanShoppingItemName).pipe(z.string().min(1));

/** `null` borra la nota. */
const noteSchema = z.string().max(MAX_STOCK_NOTE_LENGTH).nullable();

const addSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            name: nameSchema,
            note: noteSchema.optional(),
            section: sectionSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_EXTERNAL_STOCK_BATCH),
    addedBy: personRefSchema.optional(),
  })
  .strict();

const finishSchema = z
  .object({
    items: z.array(nameSchema).min(1).max(MAX_EXTERNAL_STOCK_BATCH),
    addedBy: personRefSchema.optional(),
  })
  .strict();

const patchSchema = z
  .object({
    name: nameSchema.optional(),
    note: noteSchema.optional(),
    section: sectionSchema.optional(),
  })
  .strict()
  .refine((patch) => 0 < Object.keys(patch).length, 'Nothing to change');

export interface ExternalStockAddItem {
  name: string;
  /** Clave del nombre (ver `stockKey`): con ella se busca en Compras y se arma la respuesta. */
  key: string;
  note?: string | null;
  section?: StockSection;
}

export interface ExternalStockAdd {
  items: ExternalStockAddItem[];
  addedBy?: PersonRef;
}

export interface ExternalStockFinish {
  items: string[];
  addedBy?: PersonRef;
}

export type ExternalStockPatch = z.infer<typeof patchSchema>;

/** Se queda con el primero de cada nombre: "tomate" y "Tomates" en el mismo pedido son uno. */
const uniqueByKey = <T>(entries: readonly T[], nameOf: (entry: T) => string) => {
  const seen = new Set<string>();

  return entries.flatMap((entry) => {
    const key = stockKey(nameOf(entry));

    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [{ entry, key }];
  });
};

export const parseExternalStockAdd = (body: unknown): ExternalStockAdd => {
  const parsed = parseExternalBody(addSchema, body);

  return {
    items: uniqueByKey(parsed.items, (item) => item.name).map(({ entry, key }) => ({
      ...entry,
      key,
    })),
    addedBy: parsed.addedBy,
  };
};

export const parseExternalStockFinish = (body: unknown): ExternalStockFinish => {
  const parsed = parseExternalBody(finishSchema, body);

  return {
    items: uniqueByKey(parsed.items, (name) => name).map(({ entry }) => entry),
    addedBy: parsed.addedBy,
  };
};

export const parseExternalStockPatch = (body: unknown): ExternalStockPatch =>
  parseExternalBody(patchSchema, body);

/** `?q=arroz`: texto a buscar dentro de los nombres, o null. */
export const parseExternalStockQuery = (query: Record<string, string | string[] | undefined>) => {
  const raw = Array.isArray(query.q) ? query.q[0] : query.q;
  const q = cleanShoppingItemName(raw ?? '');

  return { q: stockKey(q) ? q : null };
};

interface NamedInSection {
  name: string;
  note: string | null;
  section: StockSection;
}

/** Las secciones en el orden de la app, sin las vacías; dentro de cada una, orden alfabético. */
export const groupStockBySection = <T extends NamedInSection>(items: readonly T[]) =>
  STOCK_SECTIONS.flatMap((section) => {
    const inSection = items
      .filter((item) => section === item.section)
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

    return 0 < inSection.length
      ? [{ section, label: STOCK_SECTION_LABELS[section], items: inSection }]
      : [];
  });

const withNote = (item: { name: string; note: string | null }) =>
  item.note ? `${item.name} (${item.note})` : item.name;

const withSection = (item: { name: string; section: StockSection }) =>
  `${item.name} (${STOCK_SECTION_LABELS[item.section]})`;

/** Lo que hay, para contestar por WhatsApp tal cual: una línea por sección. */
export const stockListText = (
  sections: readonly { label: string; items: readonly NamedInSection[] }[],
  q: string | null,
): string => {
  const items = sections.flatMap((section) => section.items);

  if (q) {
    return 0 < items.length
      ? `Hay: ${items.map(withSection).join(', ')}.`
      : `No hay "${q}" en el Stock.`;
  }

  if (0 === items.length) {
    return 'El Stock está vacío.';
  }

  return sections
    .map((section) => `${section.label}: ${section.items.map(withNote).join(', ')}.`)
    .join('\n');
};

export interface StockAddOutcome {
  name: string;
  section: StockSection;
  /** `added`: entró ahora; `already`: ya estaba en el Stock. */
  status: 'added' | 'already';
  /** Estaba pendiente en Compras y quedó tildado como comprado. */
  fromShopping: boolean;
}

/** "Sumé al Stock: Pollo (Freezer). Ya estaba: Leche (Heladera). Tildé en Compras: Tomates." */
export const stockAddText = (outcomes: readonly StockAddOutcome[]): string => {
  const added = outcomes.filter((outcome) => 'added' === outcome.status);
  const already = outcomes.filter((outcome) => 'already' === outcome.status);
  const bought = outcomes.filter((outcome) => outcome.fromShopping);
  const parts: string[] = [];

  if (0 < added.length) {
    parts.push(`Sumé al Stock: ${added.map(withSection).join(', ')}.`);
  }
  if (0 < already.length) {
    parts.push(
      `${1 === already.length ? 'Ya estaba' : 'Ya estaban'}: ${already.map(withSection).join(', ')}.`,
    );
  }
  if (0 < bought.length) {
    parts.push(`Tildé en Compras: ${bought.map((outcome) => outcome.name).join(', ')}.`);
  }

  return parts.join(' ');
};

export type StockFinishOutcome =
  | { name: string; status: 'finished' | 'not_in_stock'; addedToShopping: boolean }
  | { name: string; status: 'candidates'; candidates: string[] };

const finishSentence = (outcome: StockFinishOutcome): string => {
  if ('candidates' === outcome.status) {
    return `"${outcome.name}": en el Stock hay ${outcome.candidates.join(', ')}. No saqué nada.`;
  }

  if ('finished' === outcome.status) {
    return outcome.addedToShopping
      ? `${outcome.name} salió del Stock y fue a Compras.`
      : `${outcome.name} salió del Stock (ya estaba en Compras).`;
  }

  return outcome.addedToShopping
    ? `${outcome.name} no estaba en el Stock; fue a Compras.`
    : `${outcome.name} no estaba en el Stock y ya estaba en Compras.`;
};

export const stockFinishText = (outcomes: readonly StockFinishOutcome[]): string =>
  outcomes.map(finishSentence).join(' ');
