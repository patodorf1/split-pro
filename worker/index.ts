import i18nConfig from '@/next-i18next.config.js';
import { START_MIRROR_CACHE, START_MIRROR_URL, resolveStartFromMirror } from '~/lib/startRoute';
import { type PushMessage } from '~/types';
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist, StaleWhileRevalidate } from 'serwist';

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// actual precache manifest. By default, this string is set to
// `"self.__SW_MANIFEST"`.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Adónde mandar el arranque cuando no hay red. Offline el service worker no
 * puede leer la cookie del "último lugar visitado", así que caemos a la home,
 * que sí está en caché. Debe coincidir con el default de `DEFAULT_HOMEPAGE`.
 */
const OFFLINE_START_FALLBACK = '/dashboard';

const LOCALES: readonly string[] = i18nConfig.i18n.locales;

/** Serwist exige que el manifiesto aparezca una sola vez en el código del SW. */
const PRECACHE_ENTRIES = self.__SW_MANIFEST;

/**
 * Arranque sin red: el cliente deja en Cache Storage una copia del "último
 * lugar" + idioma (ver `~/lib/startRoute`). Si está, "/" se resuelve acá mismo
 * con las mismas reglas que el servidor y se ahorra la cadena de redirects.
 */
const startFromMirror = async (): Promise<string | null> => {
  try {
    const cache = await caches.open(START_MIRROR_CACHE);
    const stored = await cache.match(START_MIRROR_URL);

    if (!stored) {
      return null;
    }

    return resolveStartFromMirror(await stored.text(), {
      defaultHomepage: OFFLINE_START_FALLBACK,
      locales: LOCALES,
    });
  } catch {
    return null;
  }
};

/**
 * "/" es el `start_url` de la PWA y su respuesta es un redirect que depende de
 * una cookie del dispositivo. Si se cacheara, el arranque quedaría clavado en
 * un destino viejo (o directamente roto, porque un navigate no puede resolverse
 * con una respuesta redirigida guardada en caché). Por eso nunca se guarda: o
 * lo resuelve la copia del "último lugar" (sin red), o va siempre a la red.
 */
const networkStart = new NetworkOnly({
  plugins: [
    {
      handlerDidError: async () =>
        Response.redirect(new URL(OFFLINE_START_FALLBACK, self.location.origin).href, 302),
    },
  ],
});

const startUrlRoute: RuntimeCaching = {
  matcher: ({ request, sameOrigin, url }) =>
    sameOrigin && 'navigate' === request.mode && '/' === url.pathname,
  handler: async (options) => {
    const destination = await startFromMirror();

    if (destination) {
      return Response.redirect(new URL(destination, self.location.origin).href, 302);
    }

    return networkStart.handle(options);
  },
};

/**
 * Build de este service worker, sacado del manifiesto de precache (Next lo
 * publica en `/_next/static/<buildId>/_buildManifest.js`).
 */
const BUILD_ID =
  (PRECACHE_ENTRIES ?? [])
    .map((entry) => ('string' === typeof entry ? entry : entry.url))
    .map((url) => /\/_next\/static\/([^/]+)\/_buildManifest\.js$/.exec(url)?.[1])
    .find(Boolean) ?? null;

const SHELL_CACHE_PREFIX = 'casa-shell-';

/**
 * Pantallas "cáscara": páginas estáticas (getStaticProps) cuyo HTML es igual
 * para todos los usuarios (sólo textos traducidos, ningún dato). Los datos los
 * pinta el cliente desde su caché del dispositivo, que se borra al salir.
 */
const SHELL_PAGES = [
  'activity',
  'balances',
  'dashboard',
  'groups',
  'more',
  'recurring',
  'shopping',
  'stats',
];
const SHELL_PATH = new RegExp(`^/([A-Za-z-]+)/(?:${SHELL_PAGES.join('|')})$`);

/**
 * Esas pantallas se sirven al instante desde el caché y se actualizan de fondo
 * (stale-while-revalidate). El caché lleva el build en el nombre: un HTML de
 * otro build nunca se mezcla con el JS de este.
 */
const shellRoute: RuntimeCaching | null = BUILD_ID
  ? {
      matcher: ({ request, sameOrigin, url }) => {
        const locale = SHELL_PATH.exec(url.pathname)?.[1];

        return (
          sameOrigin &&
          'navigate' === request.mode &&
          '' === url.search &&
          undefined !== locale &&
          'default' !== locale &&
          LOCALES.includes(locale)
        );
      },
      handler: new StaleWhileRevalidate({
        cacheName: `${SHELL_CACHE_PREFIX}${BUILD_ID}`,
        plugins: [
          {
            // Sólo HTML bueno de verdad: ni redirects, ni errores, ni opacos.
            cacheWillUpdate: async ({ response }) =>
              200 === response.status &&
              'basic' === response.type &&
              !response.redirected &&
              (response.headers.get('Content-Type') ?? '').includes('text/html')
                ? response
                : null,
          },
        ],
      }),
    }
  : null;

self.addEventListener('activate', (event) => {
  // Borra las cáscaras de builds anteriores.
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(SHELL_CACHE_PREFIX) && name !== `${SHELL_CACHE_PREFIX}${BUILD_ID}`,
            )
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

const serwist = new Serwist({
  precacheEntries: PRECACHE_ENTRIES,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [startUrlRoute, ...(shellRoute ? [shellRoute] : []), ...defaultCache],
});

self.addEventListener('push', function (event) {
  const { title, message, data } = JSON.parse(event?.data?.text() ?? '{}') as PushMessage;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: message,
      icon: '/icons/android-chrome-192x192.png',
      data,
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const url = (event.notification.data?.url as string) ?? '/';

      const matchingClient = clientList.find((client) => client.focused) ?? clientList[0];

      if (matchingClient) {
        const client = await matchingClient.focus();
        await client.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});

serwist.addEventListeners();
