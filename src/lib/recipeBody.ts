/**
 * Paso a paso de una receta en texto simple, pensado para escribirse desde el teléfono o
 * dictárselo a Charly:
 *
 *   1. Condimentar la carne
 *   Sobre las milanesas crudas espolvoreá:
 *   - 3 cucharitas de sal
 *   Tip: pisar el ajo con sal ayuda a que se pegue.
 *
 * Una línea que empieza con número y punto (o paréntesis) abre un paso; "-" o "•" es un ítem de
 * lista; "Tip:" o "Consejo:" es un consejo; el resto es texto. Lo que va antes del primer paso
 * queda como introducción (por ejemplo, la lista de ingredientes o el aderezo). Se interpreta a
 * estructura y la pantalla la dibuja con elementos de React: nunca se inserta HTML.
 */

export type RecipeBlock =
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'tip'; text: string };

export interface RecipeStep {
  /** Número correlativo en pantalla (1, 2, 3…), aunque el texto se saltee números. */
  number: number;
  /** Vacío cuando la línea del paso era una instrucción larga: va como texto del paso. */
  title: string;
  blocks: RecipeBlock[];
}

export interface ParsedRecipeBody {
  intro: RecipeBlock[];
  steps: RecipeStep[];
}

/** Un título de paso más largo que esto es en realidad una instrucción completa. */
const MAX_STEP_TITLE_LENGTH = 60;

const STEP = /^\d{1,2}[.)]\s+(.+)$/;
const BULLET = /^[-•*·]\s+(.+)$/;
const TIP = /^(?:tip|consejo)\s*:\s*(.+)$/i;

export const parseRecipeBody = (body: string): ParsedRecipeBody => {
  const intro: RecipeBlock[] = [];
  const steps: RecipeStep[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();

    if (!line) {
      continue;
    }

    const step = STEP.exec(line);

    if (step) {
      const text = step[1] ?? '';
      const title = text.replace(/:$/, '').trim();
      const isLong = title.length > MAX_STEP_TITLE_LENGTH;

      steps.push({
        number: steps.length + 1,
        title: isLong ? '' : title,
        blocks: isLong ? [{ type: 'text', text }] : [],
      });
      continue;
    }

    const blocks = steps.at(-1)?.blocks ?? intro;
    const bullet = BULLET.exec(line);

    if (bullet) {
      const last = blocks.at(-1);
      const item = bullet[1] ?? '';

      if ('list' === last?.type) {
        last.items.push(item);
      } else {
        blocks.push({ type: 'list', items: [item] });
      }
      continue;
    }

    const tip = TIP.exec(line);

    blocks.push(tip ? { type: 'tip', text: tip[1] ?? '' } : { type: 'text', text: line });
  }

  return { intro, steps };
};
