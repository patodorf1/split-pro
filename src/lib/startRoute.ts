/**
 * Arranque rápido de la PWA: resolver "/" sin ir al servidor.
 *
 * Abrir la app pide "/" y el servidor contesta con una cadena de redirects
 * ("/" -> "/es-AR" -> última pantalla). Con ~260 ms por ida y vuelta, cada
 * salto se nota. Por eso:
 *
 * - El servidor ya redirige directo a la pantalla CON el idioma adelante
 *   (`withLocalePrefix`), y no a una ruta sin idioma que el middleware vuelve a
 *   redirigir.
 * - El cliente deja una copia del "último lugar" (cookie de `lastRoute`) más el
 *   idioma en Cache Storage, que el service worker SÍ puede leer (las cookies
 *   no). Con esa copia el service worker resuelve "/" solo, sin red.
 *
 * Puro (sin `window`, sin `caches`): lo usan el cliente, el servidor y el
 * service worker.
 */
import { resolveStartDestination } from './lastRoute';

/** Cache Storage donde el cliente deja la copia para el service worker. */
export const START_MIRROR_CACHE = 'casa-start';

/** "URL" (sólo una clave, nunca se pide a la red) de la copia dentro de ese caché. */
export const START_MIRROR_URL = '/__casa/start-route';

/** Idiomas con forma de locale: "es", "es-AR", "pt-BR". Descarta cualquier otra cosa. */
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/**
 * Antepone el idioma a una ruta interna: `/dashboard` + `es-AR` ->
 * `/es-AR/dashboard`. Con el idioma "default" (o sin idioma) la deja igual.
 */
export const withLocalePrefix = (path: string, locale: string | null | undefined): string => {
  if (!locale || 'default' === locale || !LOCALE_PATTERN.test(locale)) {
    return path;
  }
  if (path === `/${locale}` || path.startsWith(`/${locale}/`)) {
    return path;
  }

  return `/${locale}${'/' === path ? '' : path}`;
};

export interface StartMirror {
  /** Valor crudo del recuerdo, igual al de la cookie (`<timestamp>|<ruta>`). */
  route: string;
  /** Idioma de la última pantalla (el del router: "es-AR", "en"...). */
  locale: string;
}

export const serializeStartMirror = (mirror: StartMirror): string => JSON.stringify(mirror);

const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

/**
 * Destino de arranque según la copia del service worker, o `null` si no hay
 * copia válida (en ese caso el service worker deja que resuelva el servidor).
 *
 * Mismas reglas que el servidor (`resolveStartDestination`): ruta dentro de la
 * allowlist y recuerdo de menos de 7 días; si no, la home por defecto. El
 * idioma tiene que ser uno de los que la app conoce.
 */
export const resolveStartFromMirror = (
  raw: string | null | undefined,
  {
    defaultHomepage,
    locales,
    now = Date.now(),
  }: { defaultHomepage: string; locales: readonly string[]; now?: number },
): string | null => {
  if ('string' !== typeof raw || 0 === raw.length) {
    return null;
  }

  const parsed = safeJsonParse(raw);

  if ('object' !== typeof parsed || null === parsed) {
    return null;
  }

  const route: unknown = 'route' in parsed ? parsed.route : undefined;
  const locale: unknown = 'locale' in parsed ? parsed.locale : undefined;

  if ('string' !== typeof locale || 'default' === locale || !locales.includes(locale)) {
    return null;
  }

  const destination = resolveStartDestination(
    'string' === typeof route ? route : null,
    defaultHomepage,
    now,
  );

  return withLocalePrefix(destination, locale);
};
