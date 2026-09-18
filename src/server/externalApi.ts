import { createHash, timingSafeEqual } from 'node:crypto';

import { env } from '~/env';

/**
 * La API externa solo existe si hay una clave configurada. Sin `EXTERNAL_API_KEY` los endpoints
 * responden 404, así una instancia que no la usa no expone superficie extra.
 */
export const isExternalApiEnabled = (): boolean => Boolean(env.EXTERNAL_API_KEY);

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Comparación en tiempo constante. Comparamos los digests SHA-256 (siempre 32 bytes) para que
 * `timingSafeEqual` no explote cuando los largos difieren y para no filtrar el largo de la clave.
 */
export const isValidExternalApiKey = (provided: string | undefined): boolean => {
  const expected = env.EXTERNAL_API_KEY;

  if (!expected || !provided) {
    return false;
  }

  return timingSafeEqual(digest(provided), digest(expected));
};

/** Extrae el token de un header `Authorization: Bearer <clave>`. */
export const getBearerToken = (header: string | string[] | undefined): string | undefined => {
  const value = Array.isArray(header) ? header[0] : header;

  if (!value) {
    return undefined;
  }

  const separatorIndex = value.indexOf(' ');

  if (-1 === separatorIndex) {
    return undefined;
  }

  if ('bearer' !== value.slice(0, separatorIndex).toLowerCase()) {
    return undefined;
  }

  return value.slice(separatorIndex + 1).trim() || undefined;
};
