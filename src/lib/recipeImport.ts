import { z } from 'zod';

import {
  MAX_RECIPE_INGREDIENTS,
  type RecipeKind,
  cleanRecipeIngredients,
  cleanRecipeTitle,
  recipeTitleKey,
} from '~/lib/recipes';
import { normalizeShoppingItemName } from '~/lib/shopping';

/**
 * Carga única de las recetas del cuaderno de Charly (vault) al recetario de Split. Puro: la línea
 * de comandos (`scripts/import-recipes.ts`) lee los archivos, y el SQL que sale de acá se puede
 * correr dos veces sin duplicar (los títulos que ya están se saltean).
 */

/** Los tipos como los escribió la revisión de la familia, y también en inglés. */
const KIND_ALIASES: Record<string, RecipeKind> = {
  PROTEINAS: 'PROTEIN',
  PROTEIN: 'PROTEIN',
  PLATOS: 'MAIN',
  MAIN: 'MAIN',
  ENSALADAS: 'SALAD',
  SALAD: 'SALAD',
  GUARNICIONES: 'SIDE',
  SIDE: 'SIDE',
};

const kindSchema = z.string().transform((value, ctx): RecipeKind => {
  const kind = KIND_ALIASES[normalizeShoppingItemName(value).toUpperCase()];

  if (!kind) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Tipo desconocido: ${value}` });
    return z.NEVER;
  }

  return kind;
});

const reviewedRecipeSchema = z.object({
  title: z.string().trim().min(1),
  kind: kindSchema,
  yield: z.string().trim().min(1).nullable().optional(),
  ingredients: z.array(z.string().min(1)).min(1).max(MAX_RECIPE_INGREDIENTS),
  file: z.string().min(1),
});

export type ReviewedRecipe = z.infer<typeof reviewedRecipeSchema>;

/** El cerco de un bloque de código de Markdown (tres comillas invertidas). */
const FENCE = '`'.repeat(3);
const JSON_BLOCK = new RegExp(`${FENCE}json\\s*\\n([\\s\\S]*?)\\n${FENCE}`);

/** Saca el bloque de código json de la revisión y lo valida; si algo no cierra, dice qué. */
export const parseReviewedRecipes = (markdown: string): ReviewedRecipe[] => {
  const match = JSON_BLOCK.exec(markdown);

  if (!match?.[1]) {
    throw new Error('No encontré el bloque json en la revisión');
  }

  return z.array(reviewedRecipeSchema).min(1).parse(JSON.parse(match[1]));
};

/** Emojis decorativos al principio de una línea ("🔪 ", "👉 ", "🥘 "). */
const LEADING_PICTOGRAPHS = /^(?:[\p{Extended_Pictographic}\u{FE0F}\u{200D}]\s*)+/u;
/** Cualquier emoji suelto en el texto ("… un punto picante 🔥."). */
const ANY_PICTOGRAPH = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
/** "[1 con emoji de tecla] Preparar la base": el dígito, el selector de emoji (opcional) y el cerco de tecla. */
const KEYCAP_STEP = /^(\d{1,2})\u{FE0F}?\u{20E3}\s*(.*)$/u;
/** "Paso 2 — Dorar chorizo y panceta — fuego medio" (ya sin negritas) */
const PASO_STEP = /^paso\s+(\d{1,2})\s*[—–:-]?\s*(.*)$/i;
/** Un paso ya en el formato de la app: "1. Título". */
const CANONICAL_STEP = /^\d{1,2}[.)]\s/;
const BULLET = /^[•·*-]\s+/;
/** Un consejo escrito al final de una oración: "Mezclá bien. Tip: no uses ajo en polvo." */
const INLINE_TIP = /^(.*?\S)\s+(Tip:\s.*)$/;

/** Saca negritas y cursivas de Markdown ("**200°C**", "*Tip: …*"); las viñetas "* " quedan. */
const stripEmphasis = (line: string) =>
  line
    .replace(/\*\*/g, '')
    .replace(/(^|\s)\*(?=\S)/g, '$1')
    .replace(/(\S)\*(?=\s|$|[.,;:)])/g, '$1');

/** Saca los emojis del medio o del final de una línea y deja la puntuación pegada a la palabra. */
const scrub = (text: string) =>
  text
    .replace(ANY_PICTOGRAPH, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

/**
 * Antes del primer paso, el texto suelto es charla del chat ("Ajusto las cantidades…",
 * "Perfecto 👌…") o un subtítulo que repite el título o el rinde: se queda solo si encabeza una
 * lista ("Ingredientes", "Aderezo:"). Si la receta no tiene pasos, no se saca nada. Al final se
 * sacan las preguntas del chat ("¿Las cocinás hoy?") y las líneas vacías de más.
 */
const tidy = (lines: string[]): string => {
  const firstStep = lines.findIndex((line) => CANONICAL_STEP.test(line));
  const nextContent = (from: number) => lines.slice(from).find(Boolean);

  const kept = lines.filter((line, index) => {
    if (-1 === firstStep || index >= firstStep || !line || line.startsWith('- ')) {
      return true;
    }

    return nextContent(index + 1)?.startsWith('- ') ?? false;
  });

  while (0 < kept.length) {
    const last = kept[kept.length - 1] ?? '';

    if (last && !last.startsWith('¿')) {
      break;
    }

    kept.pop();
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Pasa un archivo del cuaderno (cada uno vino de un chat distinto: "**Paso 1 — …**", "[1 con emoji de tecla] …",
 * "\t1.\t…", "**1.** …", "1. **Título.** …", viñetas "•" o "-") al formato del paso a paso de la
 * app (ver `parseRecipeBody`): "N." para los pasos, "-" para las listas y "Tip:" para los
 * consejos. La primera línea es el título del archivo y se descarta; la línea que repite el rinde
 * también.
 */
export const vaultRecipeToBody = (markdown: string, yieldText?: string | null): string => {
  const lines: string[] = [];
  const yieldKey = yieldText ? normalizeShoppingItemName(yieldText) : null;
  let seenFirst = false;

  const pushLine = (line: string) => {
    const tip = INLINE_TIP.exec(line);

    if (tip && !/^tip:/i.test(line)) {
      lines.push(tip[1] ?? '', tip[2] ?? '');
      return;
    }

    lines.push(line);
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const trimmed = raw.replace(/\s+/g, ' ').trim();

    if (!seenFirst && trimmed) {
      seenFirst = true;

      if (/^#\s/.test(trimmed) || /^\*\*[^*]+\*\*$/.test(trimmed)) {
        continue;
      }
    }

    const line = stripEmphasis(trimmed.replace(LEADING_PICTOGRAPHS, ''))
      .replace(/^#{1,6}\s+/, '')
      .trim();

    // Separadores ("⸻", "---") y líneas que eran solo emojis.
    if (!/[\p{L}\p{N}]/u.test(line)) {
      lines.push('');
      continue;
    }

    if (/^paso a paso:?$/i.test(line)) {
      continue;
    }

    if (yieldKey && normalizeShoppingItemName(line) === yieldKey) {
      continue;
    }

    const step = PASO_STEP.exec(line) ?? KEYCAP_STEP.exec(line);

    if (step) {
      const rest = scrub(step[2] ?? '');

      if (rest) {
        pushLine(`${step[1]}. ${rest}`);
      }
      continue;
    }

    pushLine(scrub(line.replace(BULLET, '- ')));
  }

  return tidy(lines);
};

export interface ImportableRecipe {
  title: string;
  kind: RecipeKind;
  yieldText: string | null;
  body: string;
  ingredients: string[];
}

/** Literal de texto de Postgres (con `standard_conforming_strings` prendido). */
const sql = (value: string | null) =>
  null === value ? 'NULL' : `'${value.replaceAll("'", "''")}'`;

/**
 * Una receta y sus ingredientes en un solo comando: si el título ya está en el grupo, el INSERT de
 * la receta no devuelve nada y tampoco se insertan ingredientes.
 */
const recipeInsertSql = (groupId: number, recipe: ImportableRecipe): string => {
  const title = cleanRecipeTitle(recipe.title);
  const values = cleanRecipeIngredients(recipe.ingredients)
    .map(
      (ingredient) => `(${sql(ingredient.name)}, ${sql(ingredient.key)}, ${ingredient.position})`,
    )
    .join(',\n  ');

  return [
    `-- ${title}`,
    'WITH recipe AS (',
    '  INSERT INTO "public"."Recipe" ("groupId", "title", "titleKey", "kind", "yieldText", "body", "source", "updatedAt")',
    `  VALUES (${groupId}, ${sql(title)}, ${sql(recipeTitleKey(title))}, '${recipe.kind}', ${sql(recipe.yieldText)}, ${sql(recipe.body)}, 'IMPORT', CURRENT_TIMESTAMP)`,
    '  ON CONFLICT ("groupId", "titleKey") DO NOTHING',
    '  RETURNING "id"',
    ')',
    'INSERT INTO "public"."RecipeIngredient" ("recipeId", "name", "key", "position")',
    'SELECT recipe."id", ingredient.name, ingredient.key, ingredient.position',
    `FROM recipe, (VALUES\n  ${values}\n) AS ingredient(name, key, position);`,
  ].join('\n');
};

/** Todo el recetario en una transacción. Se puede correr de nuevo: no duplica. */
export const buildImportSql = (groupId: number, recipes: readonly ImportableRecipe[]): string => {
  if (!Number.isInteger(groupId) || 0 >= groupId) {
    throw new Error(`groupId inválido: ${groupId}`);
  }

  return [
    '-- Recetario inicial de la casa (repetible: los títulos que ya existen se saltean)',
    "SET client_encoding = 'UTF8';",
    'SET standard_conforming_strings = on;',
    // Con `-v ON_ERROR_STOP=1`, si el grupo no es "Casa" esto corta antes del BEGIN y no se escribe nada.
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "public"."Group" WHERE id = ${groupId} AND name = 'Casa') THEN RAISE EXCEPTION 'El grupo ${groupId} no es Casa'; END IF; END $$;`,
    'BEGIN;',
    ...recipes.map((recipe) => recipeInsertSql(groupId, recipe)),
    'COMMIT;',
    '',
  ].join('\n\n');
};
