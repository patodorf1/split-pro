/**
 * Catálogo de temas de la app.
 *
 * Las paletas viven en `src/styles/globals.css` (bloques `[data-theme='...']`).
 * Acá sólo está el índice: qué temas existen, en qué orden se muestran y cuáles
 * son oscuros. Los colores nunca se duplican en JS: las previews de la grilla
 * renderizan con `data-theme` y el color de la barra del sistema se lee del CSS
 * computado.
 *
 * El modo "Automático" es el valor `system` de next-themes, que resuelve a
 * `light` o `dark`. En el CSS esos dos valores son alias de Lavanda y Noche.
 */

export const THEME_IDS = ['lavanda', 'matcha', 'cafe', 'rosa', 'noche', 'terminal'] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/** Valor especial de next-themes: sigue el esquema del sistema. */
export const SYSTEM_THEME = 'system';

export const DEFAULT_THEME: ThemeId = 'lavanda';

/**
 * Lista completa que recibe next-themes. `light` y `dark` son los valores a los
 * que resuelve el modo automático y tienen alias en el CSS.
 */
export const NEXT_THEMES_LIST = [...THEME_IDS, 'light', 'dark'];

/** Incluye `dark` porque es lo que devuelve `resolvedTheme` en modo automático. */
const DARK_THEMES: ReadonlySet<string> = new Set(['noche', 'terminal', 'dark']);

export const isDarkTheme = (theme?: string | null): boolean => DARK_THEMES.has(theme ?? '');

/** Clave i18n con el nombre visible del tema. */
export const themeNameKey = (id: ThemeId) => `themes.names.${id}`;
