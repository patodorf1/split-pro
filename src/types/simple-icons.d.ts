/**
 * Casa: tipos de los íconos de simple-icons importados uno por uno (el paquete trae un `.d.ts` por
 * ícono, pero TypeScript no lo encuentra al importar el `.mjs` por su ruta).
 */
declare module '@icons-pack/react-simple-icons/icons/*.mjs' {
  import type { IconType } from '@icons-pack/react-simple-icons';

  const Icon: IconType;
  export const defaultColor: string;
  export default Icon;
}
