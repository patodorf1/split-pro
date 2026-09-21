/**
 * "Que arranque donde la dejé": recuerdo de la última pantalla visitada.
 *
 * El recuerdo vive en el dispositivo (localStorage + una cookie legible por el
 * servidor), nunca en la base: cada teléfono recuerda lo suyo.
 *
 * Este módulo es puro (sin `window`, sin `document`) para poder testearlo y para
 * poder usarlo tanto en el cliente como en `getServerSideProps`.
 */

/** Clave de localStorage (espejo del valor de la cookie, por si la cookie se pierde). */
export const LAST_ROUTE_STORAGE_KEY = 'casa.lastRoute';

/** Cookie NO httpOnly: la escribe el cliente y la lee el `getServerSideProps` de "/". */
export const LAST_ROUTE_COOKIE = 'casa.lastRoute';

/** Un año: la cookie no debería vencer antes que el recuerdo. */
export const LAST_ROUTE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Si la última visita fue hace más de 7 días, arrancamos en la home por defecto. */
export const LAST_ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rutas "de estar": pantallas de navegación a las que tiene sentido volver.
 * Se acepta el prefijo exacto o cualquier sub-ruta suya (`/groups/12`).
 *
 * Queda afuera todo lo que sea formulario (`/add`), edición, autenticación,
 * API, landing (`/home`, `/`), legales y páginas de error.
 */
const REMEMBERABLE_PREFIXES = [
  '/account',
  '/activity',
  '/balances',
  '/dashboard',
  '/documents',
  '/groups',
  '/more',
  '/recurring',
  '/shopping',
  '/stats',
] as const;

/**
 * Sub-rutas que caen dentro de un prefijo permitido pero NO queremos recordar
 * (formularios de edición colgando de una pantalla que sí se recuerda).
 */
const BLOCKED_SEGMENTS = ['/edit', '/new'];

/**
 * ¿Es una ruta interna relativa y segura? Evita el open redirect: nada de
 * esquemas, nada de `//host`, nada de saltos de línea ni backslashes.
 */
export const isInternalPath = (path: string): boolean => {
  if ('string' !== typeof path || 0 === path.length) {
    return false;
  }
  if (!path.startsWith('/')) {
    return false;
  }
  // "//evil.com" y "/\evil.com" son redirects protocol-relative.
  if (path.startsWith('//') || path.startsWith('/\\')) {
    return false;
  }
  // Control chars (incluye \r y \n: header splitting), espacios y DEL.
  if ([...path].some((char) => char.charCodeAt(0) <= 0x20 || 0x7f === char.charCodeAt(0))) {
    return false;
  }
  // "/javascript:..." no matchea, pero por las dudas cortamos cualquier esquema.
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(path)) {
    return false;
  }

  return true;
};

/** Saca query string y hash: guardamos sólo el camino, nunca parámetros. */
export const stripQueryAndHash = (path: string): string => {
  const withoutHash = path.split('#')[0] ?? '';

  return withoutHash.split('?')[0] ?? '';
};

/** Normaliza barras finales: `/groups/` y `/groups` son la misma pantalla. */
const normalizePath = (path: string): string => {
  if ('/' !== path && path.endsWith('/')) {
    return path.slice(0, -1);
  }

  return path;
};

/**
 * ¿Vale la pena recordar esta ruta? Allowlist por prefijo: si no está en la
 * lista, no se recuerda.
 */
export const isRememberableRoute = (path: string): boolean => {
  if (!isInternalPath(path)) {
    return false;
  }

  const clean = normalizePath(stripQueryAndHash(path));

  if (!isInternalPath(clean)) {
    return false;
  }

  if (
    BLOCKED_SEGMENTS.some((segment) => clean.endsWith(segment) || clean.includes(`${segment}/`))
  ) {
    return false;
  }

  return REMEMBERABLE_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
};

/**
 * Deja la ruta lista para guardar: sin query, sin hash, sin barra final.
 * Devuelve `null` si no es una ruta que corresponda recordar.
 */
export const toRememberedRoute = (path: string): string | null => {
  if (!isRememberableRoute(path)) {
    return null;
  }

  return normalizePath(stripQueryAndHash(path));
};

/** Valor serializado: `<timestamp>|<ruta url-encodeada>`. */
export const serializeRememberedRoute = (path: string, timestamp: number): string | null => {
  const route = toRememberedRoute(path);

  if (null === route || !Number.isFinite(timestamp)) {
    return null;
  }

  return `${Math.floor(timestamp)}|${encodeURIComponent(route)}`;
};

/** `decodeURIComponent` sin explotar con valores manipulados (`%E0%A4%A`). */
const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

/**
 * Lee un valor guardado (cookie o localStorage) y devuelve la ruta sólo si
 * sigue siendo válida: bien formada, dentro de la allowlist y no vencida.
 */
export const parseRememberedRoute = (
  raw: string | null | undefined,
  now: number = Date.now(),
): string | null => {
  if ('string' !== typeof raw || 0 === raw.length) {
    return null;
  }

  const separator = raw.indexOf('|');

  if (-1 === separator) {
    return null;
  }

  const timestamp = Number(raw.slice(0, separator));

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  // Vencido (o con fecha del futuro, que sólo puede venir de un valor manipulado).
  if (now - timestamp > LAST_ROUTE_TTL_MS || timestamp > now + LAST_ROUTE_TTL_MS) {
    return null;
  }

  return toRememberedRoute(safeDecode(raw.slice(separator + 1)));
};

/** Busca una cookie por nombre dentro de un header `Cookie` crudo. */
export const readCookieValue = (
  cookieHeader: string | null | undefined,
  name: string,
): string | null => {
  if ('string' !== typeof cookieHeader || 0 === cookieHeader.length) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');

    if (-1 !== index && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }

  return null;
};

/** Header `Set-Cookie` para borrar el recuerdo desde el servidor. */
export const CLEAR_LAST_ROUTE_COOKIE = `${LAST_ROUTE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;

/**
 * ¿El recuerdo guardado apunta a esta ruta? Se usa para borrarlo cuando la
 * pantalla recordada dejó de existir.
 */
export const isRememberedRoute = (
  rawRemembered: string | null | undefined,
  path: string,
  now: number = Date.now(),
): boolean => {
  const remembered = parseRememberedRoute(rawRemembered, now);

  return null !== remembered && remembered === toRememberedRoute(path);
};

/**
 * Destino de arranque para "/": la última ruta recordada si sigue siendo
 * válida, si no la home por defecto.
 */
export const resolveStartDestination = (
  rawRemembered: string | null | undefined,
  defaultHomepage: string,
  now: number = Date.now(),
): string => {
  const fallback = isInternalPath(defaultHomepage) ? defaultHomepage : '/dashboard';

  return parseRememberedRoute(rawRemembered, now) ?? fallback;
};
