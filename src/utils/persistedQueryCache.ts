/**
 * Lado cliente de "mostrar lo último que vi": guarda en IndexedDB las consultas
 * de las pantallas de todos los días y las repone al abrir la app.
 *
 * - Al cargar el JS se lee el índice y las consultas chicas, y se meten en el
 *   QueryClient ANTES de pintar. Las grandes (historiales completos) se leen
 *   cuando una pantalla las pide, en paralelo con la red. Lo repuesto conserva
 *   su fecha original, así que react-query lo ve viejo (stale) y lo vuelve a
 *   pedir apenas se monta cada pantalla.
 * - Mientras hay sesión, cada consulta que llega bien se vuelve a guardar
 *   (agrupado, como mucho una escritura por segundo, y sólo lo que cambió).
 * - Al cerrar sesión, o si la sesión es de otra persona, se borra todo.
 *
 * Las reglas (qué se guarda, sello de versión, vencimiento, qué se repone al
 * abrir) viven en `~/lib/queryPersistence`, que es puro y está testeado.
 */
import { type Query, type QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import { type Session } from 'next-auth';
import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';

import {
  PERSISTED_CACHE_KEY,
  type PersistedMeta,
  type PersistedOwner,
  buildCacheBuster,
  entryKey,
  parsePersistedEntry,
  parsePersistedMeta,
  shouldPersistQuery,
  splitEntriesForRestore,
} from '~/lib/queryPersistence';

import {
  deviceStoreClear,
  deviceStoreGet,
  deviceStoreGetMany,
  deviceStoreWriteMany,
} from './deviceStore';

export type SessionUser = Session['user'];
export type PersistedSessionOwner = PersistedOwner<SessionUser>;
type RestoredMeta = PersistedMeta<SessionUser> | null;

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

let restorePromise: Promise<RestoredMeta> | null = null;
/** Resultado de la restauración, para leerlo sin esperar en el render. */
let restored: { done: boolean; meta: RestoredMeta } = { done: false, meta: null };
/** Índice vigente (lo que hay guardado), para escribir sólo lo que cambió. */
let currentEntries: PersistedMeta['entries'] = {};
/** Consultas grandes guardadas que todavía no se repusieron. */
const pendingLazy = new Set<string>();
let stopLazyRestore: (() => void) | null = null;

let stopPersisting: (() => void) | null = null;
let persistingFor: number | null = null;
let persistOwner: PersistedSessionOwner | null = null;
/** Sube con cada borrado: un guardado o una lectura que arrancó antes no aplica. */
let generation = 0;

const hydrateEntries = (queryClient: QueryClient, raws: unknown[]) => {
  for (const raw of raws) {
    const state = parsePersistedEntry(deserialize(raw));

    if (state) {
      hydrate(queryClient, state);
    }
  }
};

/** Repone una consulta grande cuando aparece en el caché (una pantalla la pidió). */
const restoreLazily = (queryClient: QueryClient, query: Query) => {
  if (!pendingLazy.has(query.queryHash)) {
    return;
  }

  pendingLazy.delete(query.queryHash);
  const startedAt = generation;

  void deviceStoreGet(entryKey(query.queryHash)).then((raw) => {
    // Si la red ganó, `hydrate` no pisa datos más nuevos.
    if (startedAt === generation) {
      hydrateEntries(queryClient, [raw]);
    }
  });
};

const watchLazyEntries = (queryClient: QueryClient) => {
  if (0 === pendingLazy.size) {
    return;
  }

  for (const query of queryClient.getQueryCache().getAll()) {
    restoreLazily(queryClient, query);
  }

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if ('added' === event.type) {
      restoreLazily(queryClient, event.query);
    }
    if (0 === pendingLazy.size) {
      stopLazyRestore?.();
    }
  });

  stopLazyRestore = () => {
    unsubscribe();
    stopLazyRestore = null;
  };
};

/**
 * Repone el caché guardado en el QueryClient. Se llama una sola vez, lo antes
 * posible (al crear el cliente tRPC); las llamadas siguientes devuelven la
 * misma promesa.
 */
export const restorePersistedCache = (queryClient: QueryClient) => {
  if (restorePromise) {
    return restorePromise;
  }

  restorePromise = (async (): Promise<RestoredMeta> => {
    if ('undefined' === typeof window) {
      return null;
    }

    const raw = await deviceStoreGet(PERSISTED_CACHE_KEY);
    const meta = parsePersistedMeta(deserialize(raw), { buster: currentBuster() });

    if (!meta) {
      if (undefined !== raw) {
        // Viejo, de otro build o roto: no sirve más.
        await deviceStoreClear();
      }
      return null;
    }

    const { eager, lazy } = splitEntriesForRestore(meta.entries);

    hydrateEntries(queryClient, await deviceStoreGetMany(eager.map(entryKey)));
    currentEntries = meta.entries;
    lazy.forEach((hash) => pendingLazy.add(hash));
    watchLazyEntries(queryClient);

    return meta as PersistedMeta<SessionUser>;
  })()
    .catch(() => null)
    .then((meta) => {
      restored = { done: true, meta };
      return meta;
    });

  return restorePromise;
};

/** Lo repuesto, si la restauración ya terminó (si no, `done: false`). */
export const getRestoredCache = () => restored;

/** Guarda las consultas que cambiaron y el índice, en una sola transacción. */
const persistNow = async (
  queryClient: QueryClient,
  owner: PersistedSessionOwner,
  dirty: Set<string>,
) => {
  const startedAt = generation;
  const now = Date.now();
  const puts: [string, string][] = [];
  const deletes: string[] = [];
  const entries = { ...currentEntries };

  for (const hash of dirty) {
    const query = queryClient.getQueryCache().get(hash);

    if (query && shouldPersistQuery(query)) {
      const serialized = superjsonStringify(
        dehydrate(queryClient, {
          shouldDehydrateQuery: (candidate) => candidate.queryHash === hash,
          shouldDehydrateMutation: () => false,
        }),
      );

      puts.push([entryKey(hash), serialized]);
      entries[hash] = { size: serialized.length, savedAt: now };
    } else if (entries[hash]) {
      deletes.push(entryKey(hash));
      delete entries[hash];
    }
  }

  const meta: PersistedMeta<SessionUser> = {
    buster: currentBuster(),
    timestamp: now,
    owner,
    entries,
  };

  puts.push([PERSISTED_CACHE_KEY, superjsonStringify(meta)]);

  if (startedAt === generation) {
    currentEntries = entries;
    await deviceStoreWriteMany(puts, deletes);
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

  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (persistOwner) {
      const batch = new Set(dirty);

      dirty.clear();
      void persistNow(queryClient, persistOwner, batch);
    }
  };

  const schedule = (hash?: string) => {
    if (hash) {
      dirty.add(hash);
    }
    if (!timer) {
      timer = setTimeout(flush, SAVE_THROTTLE_MS);
    }
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if ('updated' === event.type && 'success' === event.action.type) {
      if (shouldPersistQuery(event.query)) {
        schedule(event.query.queryHash);
      }
    } else if ('removed' === event.type && currentEntries[event.query.queryHash]) {
      schedule(event.query.queryHash);
    }
  });

  // Lo que llegó antes de confirmar la sesión (y no vino del disco) también se guarda.
  for (const query of queryClient.getQueryCache().getAll()) {
    const saved = currentEntries[query.queryHash];

    if (shouldPersistQuery(query) && (!saved || saved.savedAt < query.state.dataUpdatedAt)) {
      dirty.add(query.queryHash);
    }
  }

  // La PWA puede morir en segundo plano sin avisar: se guarda al esconderse.
  const onHidden = () => {
    if ('hidden' === document.visibilityState && timer) {
      flush();
    }
  };

  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);

  // Refresca el índice (sesión, fecha) aunque no haya nada nuevo.
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
  stopLazyRestore?.();
  pendingLazy.clear();
  currentEntries = {};
  restored = { done: true, meta: null };
  queryClient?.clear();

  await deviceStoreClear();

  try {
    if ('undefined' !== typeof caches) {
      await Promise.all(SW_API_CACHES.map((name) => caches.delete(name)));
    }
  } catch {
    // Sin Cache Storage (http, modo privado): no hay nada que borrar.
  }
};
