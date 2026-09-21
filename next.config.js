import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import i18nConfig from './next-i18next.config.js';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
const jiti = createJiti(fileURLToPath(import.meta.url));
import withSerwistInit from '@serwist/next';

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await jiti.import('./src/env');

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: process.env.DOCKER_OUTPUT ? 'standalone' : undefined,
  transpilePackages: ['@t3-oss/env-nextjs', '@t3-oss/env-core'],
  /**
   * If you are using `appDir` then you must comment the below `i18n` config out.
   *
   * @see https://github.com/vercel/next.js/issues/41980
   */
  i18n: i18nConfig.i18n,
  experimental: {
    /**
     * Casa: el middleware (redirects de idioma) hace que Next copie el cuerpo de cada pedido con
     * un tope de 10 MB y corte lo que sobra, así que las subidas más grandes llegaban truncadas a
     * la API. Los documentos aceptan hasta 25 MB (+ margen del multipart).
     */
    middlewareClientMaxBodySize: '30mb',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
};

const withSerwist = withSerwistInit({
  swSrc: 'worker/index.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development', // Incompatible with Turbopack https://github.com/serwist/serwist/issues/54
});

export default withSerwist(nextConfig);
