/**
 * Lógica pura del To Do de la casa: cosas para hacer (arreglar la canilla, llamar al plomero).
 * Separada del router para testearla sin base de datos.
 */

export const MAX_TODO_TITLE_LENGTH = 200;
export const MAX_TODOS_PER_BATCH = 30;

/** Viñetas, numeraciones y casillas típicas de un texto pegado desde notas o WhatsApp. */
const BULLET_PREFIX = /^\s*(?:[-*•‣·–—]+|\d+[.)]|\[[ xX]?\])\s+/;
const WHITESPACE = /\s+/g;

/**
 * Deja la tarea como la va a ver la persona: sin viñetas y con un solo espacio entre palabras.
 * A diferencia de Compras, respeta la puntuación ("¿Llamar al cerrajero?").
 */
export const cleanTodoTitle = (raw: string): string =>
  raw.replace(BULLET_PREFIX, '').replace(WHITESPACE, ' ').trim().slice(0, MAX_TODO_TITLE_LENGTH);

/**
 * Una tarea por renglón. Las comas no separan: una tarea puede llevarlas ("Pintar, lijar antes").
 * Los renglones repetidos se cargan una sola vez.
 */
export const parseTodoItems = (text: string): string[] => {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const line of text.split(/[\n\r]+/)) {
    const title = cleanTodoTitle(line);
    const key = title.toLowerCase();

    if (!title || seen.has(key)) {
      continue;
    }

    seen.add(key);
    titles.push(title);

    if (titles.length >= MAX_TODOS_PER_BATCH) {
      break;
    }
  }

  return titles;
};
