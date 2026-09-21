import { z } from 'zod';

/**
 * Datos rápidos de una sección "persona" (DNI, pasaporte, obra social, fecha de nacimiento): se
 * muestran como botones que copian el valor al portapapeles. Viven en `DocumentFolder.quickFields`
 * (JSON) y sólo se guardan las claves con valor.
 */

export const QUICK_FIELD_KEYS = ['dni', 'pasaporte', 'obraSocial', 'nacimiento'] as const;

export type QuickFieldKey = (typeof QUICK_FIELD_KEYS)[number];

export type QuickFields = Partial<Record<QuickFieldKey, string>>;

export const MAX_QUICK_FIELD_LENGTH = 100;

/**
 * Largo máximo para mostrar el valor debajo de la etiqueta en el botón. Más largo no entra prolijo
 * en un teléfono de 375px (cuatro botones por fila) y se muestra sólo la etiqueta.
 */
export const QUICK_FIELD_PREVIEW_MAX_LENGTH = 10;

const quickFieldValueSchema = z
  .string()
  .trim()
  .max(MAX_QUICK_FIELD_LENGTH)
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * Lo que manda el diálogo: cada dato opcional, recortado y con tope de largo. Vacío = se borra.
 * Reemplaza el conjunto completo (lo que no viene, deja de estar).
 */
export const quickFieldsInputSchema = z
  .object({
    dni: quickFieldValueSchema,
    pasaporte: quickFieldValueSchema,
    obraSocial: quickFieldValueSchema,
    nacimiento: quickFieldValueSchema,
  })
  .strict()
  .transform((fields) => compactQuickFields(fields));

/** Deja sólo las claves conocidas con texto no vacío. */
export const compactQuickFields = (
  fields: Partial<Record<QuickFieldKey, unknown>>,
): QuickFields => {
  const result: QuickFields = {};

  for (const key of QUICK_FIELD_KEYS) {
    const value = fields[key];

    if ('string' === typeof value && value.trim()) {
      result[key] = value.trim();
    }
  }

  return result;
};

/** Lee lo guardado en la base (JSON de forma desconocida) sin confiar en su forma. */
export const parseStoredQuickFields = (raw: unknown): QuickFields =>
  null !== raw && 'object' === typeof raw && !Array.isArray(raw)
    ? compactQuickFields(raw as Record<string, unknown>)
    : {};

/** Valor a mostrar debajo de la etiqueta, o null si no entra prolijo. */
export const quickFieldPreview = (value: string | undefined): string | null =>
  value && value.length <= QUICK_FIELD_PREVIEW_MAX_LENGTH ? value : null;
