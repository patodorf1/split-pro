/**
 * Códigos de Prisma que aparecen por carreras entre dos teléfonos, compartidos por los routers
 * (Stock y Comidas). Cada router los traduce a la respuesta que ya da su chequeo previo.
 */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';

export const prismaCode = (error: unknown) =>
  'object' === typeof error && null !== error && 'code' in error ? error.code : undefined;

/** "Ese nombre o título ya está": dos escrituras a la vez chocaron en un índice único. */
export const isUniqueViolation = (error: unknown) => PRISMA_UNIQUE_VIOLATION === prismaCode(error);

/** "Ya no existe": otro teléfono lo borró en el medio (o un doble toque). */
export const isRecordNotFound = (error: unknown) => PRISMA_RECORD_NOT_FOUND === prismaCode(error);
