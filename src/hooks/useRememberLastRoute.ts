import { useRouter } from 'next/router';
import { useEffect } from 'react';

import {
  LAST_ROUTE_COOKIE,
  LAST_ROUTE_COOKIE_MAX_AGE_SECONDS,
  LAST_ROUTE_STORAGE_KEY,
  parseRememberedRoute,
  readCookieValue,
  serializeRememberedRoute,
  toRememberedRoute,
} from '~/lib/lastRoute';
import { START_MIRROR_CACHE, START_MIRROR_URL, serializeStartMirror } from '~/lib/startRoute';

/**
 * Lado cliente del "que arranque donde la dejé".
 *
 * Guarda la última pantalla de navegación en el dispositivo: en localStorage
 * (para diagnóstico y para reponer la cookie) y en una cookie NO httpOnly, que
 * es la que lee el servidor cuando se abre "/" y así evita cualquier parpadeo.
 */

const readStorage = (key: string): string | null => {
  try {
    return globalThis.window?.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string | null) => {
  try {
    if (null === value) {
      globalThis.window?.localStorage?.removeItem(key);
    } else {
      globalThis.window?.localStorage?.setItem(key, value);
    }
  } catch {
    // Modo privado o storage bloqueado: la app sigue funcionando igual.
  }
};

const writeCookie = (value: string, maxAgeSeconds: number) => {
  try {
    if (typeof document === 'undefined') {
      return;
    }
    const secure = 'https:' === globalThis.window?.location?.protocol ? '; Secure' : '';

    document.cookie = `${LAST_ROUTE_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
  } catch {
    // Cookies bloqueadas: se pierde el recuerdo, no el funcionamiento.
  }
};

/**
 * Copia del recuerdo para el service worker (que no puede leer cookies), así
 * resuelve el arranque "/" sin ir a la red. Ver `~/lib/startRoute`.
 */
const writeStartMirror = (value: string | null, locale?: string) => {
  try {
    if ('undefined' === typeof caches) {
      return;
    }
    const pending =
      null === value || !locale
        ? caches.open(START_MIRROR_CACHE).then((cache) => cache.delete(START_MIRROR_URL))
        : caches.open(START_MIRROR_CACHE).then((cache) =>
            cache.put(
              START_MIRROR_URL,
              new Response(serializeStartMirror({ route: value, locale }), {
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
          );

    pending.catch(() => undefined);
  } catch {
    // Sin Cache Storage (http, modo privado): el arranque lo resuelve el servidor.
  }
};

/** Guarda la ruta si está en la allowlist; si no, no hace nada. */
export const rememberRoute = (path: string, now: number = Date.now(), locale?: string) => {
  const value = serializeRememberedRoute(path, now);

  if (null === value) {
    return;
  }

  writeStorage(LAST_ROUTE_STORAGE_KEY, value);
  writeCookie(value, LAST_ROUTE_COOKIE_MAX_AGE_SECONDS);
  if (locale) {
    writeStartMirror(value, locale);
  }
};

/** Borra el recuerdo (logout, o pantalla recordada que ya no existe). */
export const clearRememberedRoute = () => {
  writeStorage(LAST_ROUTE_STORAGE_KEY, null);
  writeCookie('', 0);
  writeStartMirror(null);
};

/** Lee el recuerdo vigente: primero la cookie, y si falta, el localStorage. */
export const readRememberedRoute = (now: number = Date.now()): string | null => {
  const fromCookie =
    typeof document === 'undefined'
      ? null
      : parseRememberedRoute(readCookieValue(document.cookie, LAST_ROUTE_COOKIE), now);

  return fromCookie ?? parseRememberedRoute(readStorage(LAST_ROUTE_STORAGE_KEY), now);
};

/**
 * Borra el recuerdo si apunta a esta misma ruta. Se usa cuando la pantalla
 * recordada dejó de existir (grupo borrado, amigo eliminado, sin permiso) para
 * que el próximo arranque caiga en la home por defecto en vez de quedar
 * rebotando contra una pantalla rota.
 */
export const forgetRouteIfRemembered = (path: string) => {
  const current = toRememberedRoute(path);

  if (null === current) {
    return;
  }

  if (readRememberedRoute() === current) {
    clearRememberedRoute();
  }
};

/** Registra cada cambio de ruta. Se engancha una sola vez, en `_app`. */
export const useRememberLastRoute = () => {
  const router = useRouter();
  const { asPath, events, locale } = router;

  useEffect(() => {
    rememberRoute(asPath, Date.now(), locale);
  }, [asPath, locale]);

  useEffect(() => {
    const handleRouteChangeComplete = (url: string) => rememberRoute(url, Date.now(), locale);

    events?.on('routeChangeComplete', handleRouteChangeComplete);

    return () => {
      events?.off('routeChangeComplete', handleRouteChangeComplete);
    };
  }, [events, locale]);
};
