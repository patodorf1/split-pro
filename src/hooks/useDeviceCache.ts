import { useQueryClient } from '@tanstack/react-query';
import { type Session } from 'next-auth';
import { useCallback, useEffect, useState } from 'react';

import { getOptimisticOwner, isOwnedBy } from '~/lib/queryPersistence';
import {
  clearPersistedCache,
  getRestoredCache,
  restorePersistedCache,
  startPersisting,
} from '~/utils/persistedQueryCache';

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

/**
 * ¿La sesión se cerró de verdad, o sólo falló la red? next-auth trata un error
 * de red igual que "sin sesión"; antes de borrar lo guardado se confirma con
 * una respuesta real del servidor.
 */
const confirmSignedOut = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });

    if (!response.ok) {
      return false;
    }

    const body: unknown = await response.json();

    // Sin sesión, next-auth contesta `{}` (o `null`).
    return 'object' !== typeof body || null === body || !('user' in body) || !body.user;
  } catch {
    return false;
  }
};

const redirectToSignIn = () => {
  window.location.href = `/api/auth/signin?${new URLSearchParams({
    error: 'SessionRequired',
    callbackUrl: window.location.href,
  }).toString()}`;
};

/**
 * Conecta la sesión con el caché guardado en el dispositivo:
 *
 * - Mientras la sesión todavía no contestó, devuelve el usuario con el que se
 *   guardó el caché (si la sesión guardada no venció), para pintar la pantalla
 *   con los datos de la última visita sin esperar a la red.
 * - Con sesión confirmada, sigue guardando. Si la sesión es de OTRA persona,
 *   borra todo antes de pintar, para que nadie vea datos ajenos.
 * - Sin sesión (confirmada con el servidor), borra todo y manda al login.
 */
export const useDeviceCache = (status: SessionStatus, session: Session | null) => {
  const queryClient = useQueryClient();
  const [restored, setRestored] = useState(getRestoredCache);

  useEffect(() => {
    if (restored.done) {
      return;
    }

    let cancelled = false;

    void restorePersistedCache(queryClient).then(() => {
      if (!cancelled) {
        setRestored(getRestoredCache());
      }
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient, restored.done]);

  const user = session?.user;
  const expires = session?.expires;

  /* El caché repuesto es de otra persona (otra cuenta en el mismo navegador):
   * no se pinta nada hasta haberlo borrado. */
  const foreignCache =
    'authenticated' === status &&
    undefined !== user &&
    null !== restored.cache &&
    !isOwnedBy(restored.cache, user.id);

  useEffect(() => {
    if ('authenticated' !== status || !user || !expires || !restored.done) {
      return;
    }

    if (foreignCache) {
      void clearPersistedCache(queryClient).then(() => setRestored(getRestoredCache()));
      return;
    }

    startPersisting(queryClient, { user, expires });
  }, [status, user, expires, restored.done, foreignCache, queryClient]);

  const optimisticOwner =
    'loading' === status && restored.done ? getOptimisticOwner(restored.cache) : null;

  return {
    /** Ya se sabe si hay algo guardado (la lectura de IndexedDB terminó). */
    restoreDone: restored.done,
    /** Hay datos de otra cuenta en memoria: todavía no se puede pintar. */
    foreignCache,
    /** Usuario con el que pintar antes de que conteste la sesión, o `null`. */
    optimisticUser: optimisticOwner?.user ?? null,
  };
};

/**
 * Qué hacer cuando next-auth dice "sin sesión" en una pantalla que la exige.
 * Va separado de `useDeviceCache` porque `useSession` lo necesita antes de
 * que exista el estado de la sesión.
 */
export const useUnauthenticatedHandler = () => {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void confirmSignedOut().then((signedOut) => {
      if (signedOut) {
        void clearPersistedCache(queryClient).then(redirectToSignIn);
      } else if (!getOptimisticOwner(getRestoredCache().cache)) {
        // Sin red y sin nada guardado: como siempre, al login.
        redirectToSignIn();
      }
      // Sin red pero con datos guardados: se sigue mostrando lo último visto.
    });
  }, [queryClient]);
};
