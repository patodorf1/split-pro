/**
 * This is the client-side entrypoint for your tRPC API. It is used to create the `api` object which
 * contains the Next.js App-wrapper, as well as your type-safe React Query hooks.
 *
 * We also create a few inference helpers for input and output types.
 */
import { QueryClient } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { createTRPCNext } from '@trpc/next';
import { type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';

import { type AppRouter } from '~/server/api/root';

import { restorePersistedCache } from './persistedQueryCache';

export const getBaseUrl = () => {
  if ('undefined' !== typeof window) {
    return '';
  } // Browser should use relative url
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  } // SSR should use vercel url
  return `http://localhost:${process.env.PORT ?? 3000}`; // Dev SSR should use localhost
};

/**
 * Las consultas quedan un día en memoria aunque ninguna pantalla las use: así
 * el caché que se guarda en el dispositivo conserva todas las pantallas
 * visitadas, no sólo la última.
 */
const QUERY_GC_TIME_MS = 24 * 60 * 60 * 1000;

let browserQueryClient: QueryClient | null = null;

/**
 * En el navegador hay un único QueryClient y, apenas se crea, se le reponen los
 * datos guardados en el dispositivo ("mostrar lo último que vi"). En el
 * servidor (prerender de páginas estáticas) cada render usa uno nuevo y vacío.
 */
export const getQueryClient = () => {
  const create = () =>
    new QueryClient({ defaultOptions: { queries: { gcTime: QUERY_GC_TIME_MS } } });

  if ('undefined' === typeof window) {
    return create();
  }
  if (!browserQueryClient) {
    browserQueryClient = create();
    void restorePersistedCache(browserQueryClient);
  }

  return browserQueryClient;
};

/** A set of type-safe react-query hooks for your tRPC API. */
export const api = createTRPCNext<AppRouter>({
  config() {
    return {
      queryClient: getQueryClient(),
      /**
       * Links used to determine request flow from client to server.
       *
       * @see https://trpc.io/docs/links
       */
      links: [
        loggerLink({
          enabled: (opts) =>
            'development' === process.env.NODE_ENV ||
            ('down' === opts.direction && opts.result instanceof Error),
        }),
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    };
  },
  /**
   * Whether tRPC should await queries when server rendering pages.
   *
   * @see https://trpc.io/docs/nextjs#ssr-boolean-default-false
   */
  ssr: false,
  transformer: superjson,
});

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
