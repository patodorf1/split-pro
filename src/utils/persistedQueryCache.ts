/**
 * Lado cliente de "mostrar lo último que vi": guarda en IndexedDB las consultas
 * de las pantallas de todos los días y las repone al abrir la app.
 *
 * - Al cargar el JS se lee lo guardado y se mete en el QueryClient ANTES de
 *   pintar. Lo repuesto conserva su fecha original, así que react-query lo ve
 *   viejo (stale) y lo vuelve a pedir apenas se monta cada pantalla.
 * - Mientras hay sesión, cada consulta que llega bien se vuelve a guardar
 *   (agrupado, como mucho una escritura por segundo).
 * - Al cerrar sesión, o si la sesión es de otra persona, se borra todo.
 *
 * Las reglas (qué se guarda, sello de versión, vencimiento) viven en
 * `~/lib/queryPersistence`, que es puro y está testeado.
 */
import { type QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import { type Session } from 'next-auth';
import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';

import {
  PERSISTED_CACHE_KEY,
  type PersistedCache,
  type PersistedOwner,
  buildCacheBuster,
  parsePersistedCache,
  shouldPersistQuery,
} from '~/lib/queryPersistence';

import { deviceStoreDelete, deviceStoreGet, deviceStoreSet } from './deviceStore';

export type SessionUser = Session['user'];
export type PersistedSessionOwner = PersistedOwner<SessionUser>;

/** Cachés del service worker con respuestas de la API: también se borran al salir. */
const SW_API_CACHES = ['apis'];

const SAVE_THROTTLE_MS = 1000;

/** Superjson: los montos son BigInt y las fechas Date; JSON común los rompería. */
const deserialize = (raw: unknown): unknown => {
  if ('string' !== typeof raw || 0 === raw.length) {
    return null;
  }
  try {
    return superjsonParse(raw);
  } catch {
    return null;
  }
};

const currentBuster = () =>
  buildCacheBuster(
    (globalThis as { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__?.buildId ?? null,
  );

type RestoredCache = PersistedCache<SessionUser> | null;

let restorePromise: Promise<RestoredCache> | null = null;
/** Resultado de la restauración, para leerlo sin esperar en el render. */
let restored: { done: boolean; cache: RestoredCache } = { done: false, cache: null };

let stopPersisting: (() => void) | null = null;
let persistingFor: number | null = null;
let persistOwner: PersistedSessionOwner | null = null;
/** Sube con cada borrado: un guardado que arrancó antes de borrar no escribe. */
let generation = 0;

/**
 * Repone el caché guardado en el QueryClient. Se llama una sola vez, lo antes
 * posible (al crear el cliente tRPC); las llamadas siguientes devuelven la
 * misma promesa.
 */
export const restorePersistedCache = (queryClient: QueryClient) => {
  if (restorePromise) {
    return restorePromise;
  }

  restorePromise = (async () => {
    if ('undefined' === typeof window) {
      return null;
    }

    const raw = await deviceStoreGet(PERSISTED_CACHE_KEY);
    const cache = parsePersistedCache(deserialize(raw), { buster: currentBuster() });

    if (!cache) {
      if (undefined !== raw) {
        // Viejo, de otro build o roto: no sirve más.
        await deviceStoreDelete(PERSISTED_CACHE_KEY);
      }
      return null;
    }

    hydrate(queryClient, cache.clientState);

    return cache as PersistedCache<SessionUser>;
  })()
    .catch(() => null)
    .then((cache) => {
      restored = { done: true, cache };
      return cache;
    });

  return restorePromise;
};

/** Lo repuesto, si la restauración ya terminó (si no, `done: false`). */
export const getRestoredCache = () => restored;

const persistNow = async (queryClient: QueryClient, owner: PersistedSessionOwner) => {
  const startedAt = generation;
  const clientState = dehydrate(queryClient, {
    shouldDehydrateQuery: shouldPersistQuery,
    shouldDehydrateMutation: () => false,
  });

  const serialized = superjsonStringify({
    buster: currentBuster(),
    timestamp: Date.now(),
    owner,
    clientState,
  });

  if (startedAt === generation) {
    await deviceStoreSet(PERSISTED_CACHE_KEY, serialized);
  }
};

/**
 * Empieza a guardar el caché para este usuario. Idempotente: si ya se está
 * guardando para el mismo usuario sólo actualiza los datos de la sesión.
 */
export const startPersisting = (queryClient: QueryClient, owner: PersistedSessionOwner) => {
  if ('undefined' === typeof window) {
    return;
  }

  persistOwner = owner;

  if (stopPersisting && persistingFor === owner.user.id) {
    return;
  }

  stopPersisting?.();
  persistingFor = owner.user.id;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (persistOwner) {
      void persistNow(queryClient, persistOwner);
    }
  };

  const schedule = () => {
    if (!timer) {
      timer = setTimeout(flush, SAVE_THROTTLE_MS);
    }
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if ('updated' === event.type && 'success' === event.action.type) {
      if (shouldPersistQuery(event.query)) {
        schedule();
      }
    } else if ('removed' === event.type) {
      schedule();
    }
  });

  // La PWA puede morir en segundo plano sin avisar: se guarda al esconderse.
  const onHidden = () => {
    if ('hidden' === document.visibilityState && timer) {
      flush();
    }
  };

  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);

  // Refresca el sello (sesión, fecha) con lo que ya haya en memoria.
  schedule();

  stopPersisting = () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onHidden);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    stopPersisting = null;
    persistingFor = null;
    persistOwner = null;
  };
};

/**
 * Borra todo lo que el dispositivo recuerda de la cuenta: el caché guardado,
 * lo que hay en memoria y las respuestas de la API que guardó el service worker.
 * Se usa al cerrar sesión y cuando la sesión resulta ser de otra persona.
 */
export const clearPersistedCache = async (queryClient?: QueryClient) => {
  generation += 1;
  stopPersisting?.();
  restored = { done: true, cache: null };
  queryClient?.clear();

  await deviceStoreDelete(PERSISTED_CACHE_KEY);

  try {
    if ('undefined' !== typeof caches) {
      await Promise.all(SW_API_CACHES.map((name) => caches.delete(name)));
    }
  } catch {
    // Sin Cache Storage (http, modo privado): no hay nada que borrar.
  }
};
