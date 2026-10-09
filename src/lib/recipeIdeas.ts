import { z } from 'zod';

import {
  MAX_RECIPE_BODY_LENGTH,
  MAX_RECIPE_INGREDIENTS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_YIELD_LENGTH,
  RECIPE_KINDS,
  type RecipeKind,
  cleanRecipeTitle,
  isRecipeKind,
  splitIngredientText,
} from '~/lib/recipes';
import { STOCK_SECTIONS, type StockSection } from '~/lib/stock';

/**
 * "Ideas con IA" en Comidas: a partir del Stock y del filtro elegido, la IA propone dos recetas
 * con su paso a paso. Acá vive lo que no toca la red (el pedido y la lectura de la respuesta),
 * para poder probarlo sin llamar a nadie.
 */

/** Cuántas ideas por pedido. */
export const IDEAS_PER_REQUEST = 2;

/** Tope de pedidos por grupo y por día: cada pedido cuesta plata. */
export const MAX_IDEA_REQUESTS_PER_DAY = 20;

/** Títulos a evitar ("Pedir otras"): los que ya se mostraron en esta tanda. */
export const MAX_AVOID_TITLES = 20;

/** Modelo de OpenRouter: rápido y barato, alcanza para recetas caseras. */
export const IDEAS_MODEL = 'anthropic/claude-haiku-4.5';

export interface IdeasStockItem {
  name: string;
  note: string | null;
  section: StockSection;
}

export interface RecipeIdea {
  title: string;
  kind: RecipeKind;
  description: string;
  yieldText: string | null;
  ingredients: string[];
  body: string;
}

const KIND_DESCRIPTIONS: Record<RecipeKind, string> = {
  PROTEIN: 'proteínas: una carne, pollo, pescado o huevo como plato, sin guarnición',
  MAIN: 'platos completos: pastas, guisos, tartas, salteados, arroces, legumbres',
  SALAD: 'ensaladas',
  SIDE: 'guarniciones para acompañar una proteína',
};

const SECTION_NAMES: Record<StockSection, string> = {
  FRIDGE: 'Heladera',
  FREEZER: 'Freezer',
  PANTRY: 'Alacena',
  PRODUCE: 'Frutas y verduras',
  CLEANING: 'Limpieza',
};

/** Las reglas de cocina de la casa: vienen del prompt que Pato ya usaba para pedir recetas. */
const SYSTEM_PROMPT = `Sos el cocinero de una casa en Argentina. Proponés recetas caseras con lo que hay en el Stock de la casa.

Reglas:
- Usá solo productos del Stock. No sumes nada que no figure (ni manteca, leche, crema, vino o harina si no están).
- No uses productos que sean de una persona en particular (por ejemplo "Leche de Clari").
- Los condimentos disponibles son los de la Alacena, y son secos o en polvo (no hay hierbas ni jengibre frescos). Agua siempre hay.
- No incluyas guarniciones salvo que te pidan guarniciones.
- Cada idea tiene que ser distinta de las otras y de los títulos que te pido evitar.

Cómo escribir:
- En español de Argentina, con voseo (cortá, calentá, serví). Ni una palabra en inglés.

Cómo escribir el paso a paso (campo "steps"):
- No empieces listando los ingredientes: arrancá directo con el paso 1.
- Cada paso empieza en una línea propia con número y punto: "1. Título corto del paso".
- Abajo del título, las indicaciones en texto.
- Los ingredientes de cada paso van en lista, una línea cada uno empezando con "- ", con su cantidad. Las cantidades chicas siempre en cucharitas, nunca en cucharadas (1 cucharada = 3 cucharitas).
- Indicá el fuego de la hornalla (fuerte, medio, bajo) y los grados del horno.
- La casa tiene termómetro de alimentos: para carnes, indicá la temperatura interna de cada punto (jugoso, a punto, cocido) con el tiempo estimado de cocción de cada uno.
- Si das un consejo, va dentro del paso que corresponde, en una línea propia que empiece con "Tip: ". Nunca al final.

Respondé solo con JSON, sin texto antes ni después, con esta forma:
{"ideas":[{"title":"Nombre corto","kind":"PROTEIN|MAIN|SALAD|SIDE","description":"Una frase que cuente de qué se trata","yield":"Para 2 personas","ingredients":["ingrediente principal tal como figura en el Stock"],"steps":"1. ...\\n..."}]}

En "ingredients" van solo los principales (de 1 a ${MAX_RECIPE_INGREDIENTS}), escritos igual que en el Stock pero sin lo que va entre paréntesis. Sin sal, aceite ni especias.`;

const describeStock = (stock: readonly IdeasStockItem[]) => {
  const lines = STOCK_SECTIONS.filter((section) => 'CLEANING' !== section)
    .map((section) => {
      const names = stock
        .filter((item) => item.section === section)
        .map((item) => (item.note ? `${item.name} (${item.note})` : item.name));

      return 0 < names.length ? `${SECTION_NAMES[section]}: ${names.join(', ')}.` : null;
    })
    .filter(Boolean);

  return 0 < lines.length ? lines.join('\n') : 'El Stock está vacío.';
};

/** Los mensajes para la IA: reglas fijas arriba, lo de hoy (Stock, filtro, a evitar) abajo. */
export const buildIdeasMessages = (input: {
  kind?: RecipeKind;
  stock: readonly IdeasStockItem[];
  avoidTitles: readonly string[];
}) => {
  const what = input.kind
    ? `Las ${IDEAS_PER_REQUEST} ideas tienen que ser de tipo ${input.kind} (${KIND_DESCRIPTIONS[input.kind]}).`
    : `Las ${IDEAS_PER_REQUEST} ideas, de tipos distintos entre sí. Tipos: ${RECIPE_KINDS.map((kind) => `${kind} = ${KIND_DESCRIPTIONS[kind]}`).join('; ')}.`;
  const avoid =
    0 < input.avoidTitles.length
      ? `\n\nNo repitas ni propongas variantes de estas recetas: ${input.avoidTitles.join(', ')}.`
      : '';

  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `Stock de hoy:\n${describeStock(input.stock)}\n\nProponeme ${IDEAS_PER_REQUEST} recetas. ${what}${avoid}`,
    },
  ];
};

const ideaSchema = z.object({
  title: z.string(),
  kind: z.string().optional(),
  description: z.string().optional(),
  yield: z.string().nullable().optional(),
  ingredients: z.union([z.array(z.string()), z.string()]),
  steps: z.string(),
});

/** El JSON de la respuesta: a veces viene envuelto en ```json … ``` o con texto alrededor. */
const extractJson = (text: string): unknown => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (-1 === start || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

/**
 * Las ideas de la respuesta, limpias y con los límites del recetario (para poder guardarlas tal
 * cual). Con filtro, el tipo es el del filtro aunque la IA diga otro. Las que no se pueden leer se
 * descartan; si no queda ninguna, lista vacía.
 */
export const parseIdeasResponse = (text: string, kind?: RecipeKind): RecipeIdea[] => {
  const json = extractJson(text);
  const rawIdeas =
    json && 'object' === typeof json && 'ideas' in json && Array.isArray(json.ideas)
      ? json.ideas
      : [];

  const ideas: RecipeIdea[] = [];

  for (const raw of rawIdeas) {
    const parsed = ideaSchema.safeParse(raw);

    if (!parsed.success) {
      continue;
    }

    const idea = parsed.data;
    const title = cleanRecipeTitle(idea.title).slice(0, MAX_RECIPE_TITLE_LENGTH);
    const ingredients = (
      Array.isArray(idea.ingredients) ? idea.ingredients : splitIngredientText(idea.ingredients)
    )
      // "Lentejas (1 paquete)": la cantidad del Stock no es parte del nombre del ingrediente.
      .map((name) => name.replace(/\s*\([^)]*\)\s*$/, '').trim())
      .filter(Boolean)
      .slice(0, MAX_RECIPE_INGREDIENTS);
    const body = idea.steps.replace(/\r\n?/g, '\n').trim().slice(0, MAX_RECIPE_BODY_LENGTH);
    const ideaKind = isRecipeKind(idea.kind) ? idea.kind : 'MAIN';

    if (!title || 0 === ingredients.length || !body) {
      continue;
    }

    if (ideas.some((other) => other.title.toLowerCase() === title.toLowerCase())) {
      continue;
    }

    ideas.push({
      title,
      kind: kind ?? ideaKind,
      description: (idea.description ?? '').trim(),
      yieldText: idea.yield?.trim().slice(0, MAX_RECIPE_YIELD_LENGTH) || null,
      ingredients,
      body,
    });
  }

  return ideas.slice(0, IDEAS_PER_REQUEST);
};

/**
 * Cuenta pedidos por grupo y por día (hora de Argentina). Vive en memoria: si la app se reinicia
 * el contador vuelve a cero, que para un tope de gasto diario alcanza.
 */
export class DailyLimiter {
  private readonly counts = new Map<number, { day: string; count: number }>();

  constructor(private readonly max: number) {}

  /** Suma un pedido si queda cupo; devuelve false si ya se llegó al tope de hoy. */
  take(groupId: number, now: Date = new Date()): boolean {
    const day = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const current = this.counts.get(groupId);
    const count = current?.day === day ? current.count : 0;

    if (count >= this.max) {
      return false;
    }

    this.counts.set(groupId, { day, count: count + 1 });

    return true;
  }
}
