/* oxlint-disable no-console -- herramienta de línea de comandos: el resumen va por la salida de errores */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseRecipeBody } from '../src/lib/recipeBody';
import { buildImportSql, parseReviewedRecipes, vaultRecipeToBody } from '../src/lib/recipeImport';

/**
 * Pasa las recetas revisadas por la familia (bloque JSON de la revisión) más el paso a paso del
 * cuaderno de Charly a SQL repetible. No toca ninguna base: el SQL sale por la salida estándar y
 * un resumen por la de errores. Uso:
 *
 *   npx tsx scripts/import-recipes.ts --group 1 > recetas.sql
 *   npx tsx scripts/import-recipes.ts --group 1 --preview > recetas.sql   (muestra cada paso a paso)
 *
 * Opcionales: --review <archivo de la revisión> y --vault <carpeta de recetas>.
 */

const DEFAULT_REVIEW = 'docs/superpowers/specs/2026-10-06-recetas-revision.md';
const DEFAULT_VAULT = '/Users/pato/vault-charly/vault/10 Vida/Cocina/Recetas';

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);

  return -1 === index ? undefined : process.argv[index + 1];
};

const groupId = Number(arg('group'));

if (!Number.isInteger(groupId) || groupId <= 0) {
  throw new Error('Falta --group <id del grupo Casa>');
}

const vault = arg('vault') ?? DEFAULT_VAULT;
const preview = process.argv.includes('--preview');

/** Los nombres de archivo pueden venir con tildes compuestas o descompuestas: se prueban las dos. */
const vaultFile = (file: string) => {
  const candidates = [file, file.normalize('NFC'), file.normalize('NFD')].map((name) =>
    path.join(vault, name),
  );

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? file;
};

const recipes = parseReviewedRecipes(readFileSync(arg('review') ?? DEFAULT_REVIEW, 'utf8')).map(
  (recipe) => {
    const yieldText = recipe.yield ?? null;
    const body = vaultRecipeToBody(readFileSync(vaultFile(recipe.file), 'utf8'), yieldText);
    const steps = parseRecipeBody(body).steps.length;

    console.error(
      `${recipe.title} | ${recipe.kind} | ${yieldText ?? '-'} | ${recipe.ingredients.join(', ')} | ${steps} pasos`,
    );

    if (preview) {
      console.error(`${body}\n---`);
    }

    return {
      title: recipe.title,
      kind: recipe.kind,
      yieldText,
      body,
      ingredients: recipe.ingredients,
    };
  },
);

console.error(`${recipes.length} recetas para el grupo ${groupId}`);
process.stdout.write(buildImportSql(groupId, recipes));
