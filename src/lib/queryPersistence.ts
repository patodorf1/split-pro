/**
 * "Mostrar lo último que vi": reglas del caché de consultas guardado en el
 * dispositivo.
 *
 * Al abrir la app se pintan al instante los datos de la última visita (guardados
 * en IndexedDB) y se refrescan en segundo plano. Este módulo es puro (sin
 * `window`, sin IndexedDB, sin React) para poder testearlo: decide QUÉ se guarda,
 * con qué "sello" de versión y cuándo un guardado viejo deja de servir.
 */
import { type DehydratedState } from '@tanstack/react-query';

/** Clave dentro del almacén de IndexedDB. */
export const PERSISTED_CACHE_KEY = 'casa.queryCache';

/** Más viejo que esto, no se muestra: mejor esperar a la red que mostrar algo de hace semanas. */
export const PERSISTED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Versión del formato guardado. Subirla invalida todo lo guardado en todos los
 * dispositivos (además del build, que ya invalida en cada deploy).
 */
export const PERSISTED_CACHE_FORMAT = 1;

/**
 * Sello del caché: formato + build. Un deploy nuevo puede cambiar la forma de
 * los datos que devuelve el servidor; con otro build, lo guardado se descarta
 * para que ninguna pantalla reciba datos con una forma que no espera.
 */
export const buildCacheBuster = (buildId: string | null | undefined): string =>
  `v${PERSISTED_CACHE_FORMAT}:${buildId && 0 < buildId.length ? buildId : 'dev'}`;

/**
 * Routers de tRPC cuyos datos se guardan: son las pantallas de todos los días
 * (Inicio, grupos, detalle de grupo, gastos, compras, actividad).
 */
const PERSISTABLE_ROUTERS: ReadonlySet<string> = new Set(['stats', 'group', 'expense', 'shopping']);

/**
 * Del router `user` sólo lo que las pantallas necesitan para pintarse. Todo lo
 * demás (detalle de cuenta, claves de notificaciones, descargas) no se guarda.
 */
const PERSISTABLE_USER_PROCEDURES: ReadonlySet<string> = new Set([
  'user.me',
  'user.getFriends',
  'user.getFriend',
  'user.getBalancesWithFriend',
  'user.getOwnExpenses',
]);

/** Efímeros: cotizaciones que cambian y no sirven de un día para el otro. */
const NEVER_PERSIST: ReadonlySet<string> = new Set([
  'expense.getCurrencyRate',
  'expense.getBatchCurrencyRates',
]);

const isPathSegment = (segment: unknown): segment is string =>
  'string' === typeof segment && 0 < segment.length;

/**
 * Camino tRPC ("router.procedimiento") a partir de la clave de react-query.
 * tRPC v11 arma las claves como `[['router', 'proc'], { input, type }]`.
 */
export const getTrpcPath = (queryKey: unknown): string | null => {
  if (!Array.isArray(queryKey)) {
    return null;
  }

  const path: unknown = queryKey[0];

  if (!Array.isArray(path) || 0 === path.length || !path.every(isPathSegment)) {
    return null;
  }

  return path.join('.');
};

/**
 * ¿Este procedimiento se puede guardar en el dispositivo? Allowlist: lo nuevo
 * (routers que se agreguen más adelante, auth, bancos) queda afuera por defecto.
 */
export const isPersistablePath = (path: string | null): boolean => {
  if (null === path || NEVER_PERSIST.has(path)) {
    return false;
  }

  const [router] = path.split('.');

  if (undefined === router) {
    return false;
  }
  if (PERSISTABLE_ROUTERS.has(router)) {
    return true;
  }

  return PERSISTABLE_USER_PROCEDURES.has(path);
};

/** Lo mínimo de una query de react-query que hace falta para decidir. */
interface QueryLike {
  queryKey: unknown;
  state: { status: string; data?: unknown };
}

/**
 * ¿Se guarda esta consulta? Sólo las que terminaron bien y tienen datos. Nunca
 * las que están cargando o con error (no hay nada útil que mostrar).
 */
export const shouldPersistQuery = (query: QueryLike): boolean =>
  'success' === query.state.status &&
  undefined !== query.state.data &&
  isPersistablePath(getTrpcPath(query.queryKey));

/**
 * Dueño del caché: el usuario de la sesión con la que se guardó. Sirve para
 * pintar la app antes de que vuelva la respuesta de la sesión y para descartar
 * todo si la sesión resulta ser de otra persona.
 */
export interface PersistedOwner<TUser extends { id: number } = { id: number }> {
  user: TUser;
  expires: string;
}

export interface PersistedCache<TUser extends { id: number } = { id: number }> {
  buster: string;
  timestamp: number;
  owner: PersistedOwner<TUser>;
  clientState: DehydratedState;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  'object' === typeof value && null !== value;

/**
 * Valida lo guardado (ya deserializado con superjson, que conserva BigInt y
 * Date) y devuelve el caché sólo si sigue sirviendo: bien formado, del mismo
 * build y de menos de 7 días. Cualquier otra cosa (manipulado, de otra
 * versión, vencido) devuelve `null` y se ignora.
 */
export const parsePersistedCache = (
  parsed: unknown,
  { buster, now = Date.now() }: { buster: string; now?: number },
): PersistedCache | null => {
  if (!isObject(parsed)) {
    return null;
  }

  const { owner, clientState, timestamp } = parsed;

  if (parsed.buster !== buster) {
    return null;
  }
  if ('number' !== typeof timestamp || !Number.isFinite(timestamp)) {
    return null;
  }
  // Vencido, o con fecha del futuro (reloj manipulado o valor corrupto).
  if (now - timestamp > PERSISTED_CACHE_MAX_AGE_MS || timestamp > now + 60_000) {
    return null;
  }
  if (!isObject(owner) || !isObject(owner.user) || 'number' !== typeof owner.user.id) {
    return null;
  }
  if (!isObject(clientState) || !Array.isArray(clientState.queries)) {
    return null;
  }

  return parsed as unknown as PersistedCache;
};

/**
 * ¿Se puede pintar la app con este caché antes de que conteste la sesión? Sólo
 * si la sesión con la que se guardó todavía no venció: con una sesión vencida
 * el servidor va a mandar al login, así que no se muestra nada.
 */
export const getOptimisticOwner = <TUser extends { id: number }>(
  cache: PersistedCache<TUser> | null,
  now: number = Date.now(),
): PersistedOwner<TUser> | null => {
  if (null === cache) {
    return null;
  }

  const expires = Date.parse(cache.owner.expires);

  if (!Number.isFinite(expires) || expires <= now) {
    return null;
  }

  return cache.owner;
};

/** ¿El caché guardado es de este usuario? */
export const isOwnedBy = (cache: PersistedCache | null, userId: number | null | undefined) =>
  null !== cache && 'number' === typeof userId && cache.owner.user.id === userId;
