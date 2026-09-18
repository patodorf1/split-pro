import { type PushMessage } from '~/types';
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// Actual precache manifest. By default, this string is set to
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

/**
 * "/" es el `start_url` de la PWA y su respuesta es un redirect que depende de
 * una cookie del dispositivo. Si se cacheara, el arranque quedaría clavado en
 * un destino viejo (o directamente roto, porque un navigate no puede resolverse
 * con una respuesta redirigida guardada en caché). Por eso va siempre a la red.
 */
const startUrlRoute: RuntimeCaching = {
  matcher: ({ request, sameOrigin, url }) =>
    sameOrigin && 'navigate' === request.mode && '/' === url.pathname,
  handler: new NetworkOnly({
    plugins: [
      {
        handlerDidError: async () =>
          Response.redirect(new URL(OFFLINE_START_FALLBACK, self.location.origin).href, 302),
      },
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [startUrlRoute, ...defaultCache],
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
