import { type CurrencyCode, parseCurrencyCode } from '~/lib/currency';

/**
 * "Grupo por defecto al agregar gasto": el usuario marca un grupo (por ejemplo "Casa") y al abrir
 * /add sin parámetros ese grupo ya viene elegido, con sus miembros y su moneda.
 *
 * La regla es "como mucho uno por usuario", así que el toggle se resuelve acá (función pura,
 * testeable) y el router solo persiste el resultado.
 */

export interface DefaultForAddRow {
  groupId: number;
  defaultForAdd: boolean;
}

export interface DefaultForAddToggle {
  /** Valor nuevo para el grupo que se tocó. */
  defaultForAdd: boolean;
  /** Grupos a los que hay que apagarles el flag para que quede uno solo. */
  groupIdsToClear: number[];
}

/**
 * Calcula el resultado de togglear `defaultForAdd` en `groupId` sobre los grupos de un usuario.
 * Al activar uno se apagan todos los demás; al desactivarlo no queda ninguno.
 * Devuelve `null` si el usuario no pertenece al grupo.
 */
export const resolveDefaultForAddToggle = (
  rows: DefaultForAddRow[],
  groupId: number,
): DefaultForAddToggle | null => {
  const target = rows.find((row) => row.groupId === groupId);

  if (!target) {
    return null;
  }

  const defaultForAdd = !target.defaultForAdd;

  return {
    defaultForAdd,
    groupIdsToClear: defaultForAdd
      ? rows.filter((row) => row.groupId !== groupId && row.defaultForAdd).map((row) => row.groupId)
      : [],
  };
};

/**
 * Elige el grupo por defecto entre los grupos del usuario. Si por lo que sea quedaran varios
 * marcados (base migrada a mano, por ejemplo), gana el primero y no rompe nada.
 */
export const pickDefaultGroup = <T extends { defaultForAdd: boolean }>(
  rows: T[] | undefined,
): T | undefined => rows?.find((row) => row.defaultForAdd);

export interface AddPageQuery {
  groupId?: string | string[];
  friendId?: string | string[];
  expenseId?: string | string[];
}

/**
 * ¿Hay que preseleccionar el grupo por defecto? Solo cuando /add se abre "en blanco": sin grupo,
 * sin amigo y sin gasto a editar en la URL, y siempre una sola vez por visita (si el usuario saca
 * el grupo, no vuelve solo).
 */
export const shouldPreselectDefaultGroup = ({
  isReady,
  alreadyApplied,
  query,
}: {
  isReady: boolean;
  alreadyApplied: boolean;
  query: AddPageQuery;
}): boolean => isReady && !alreadyApplied && !query.groupId && !query.friendId && !query.expenseId;

/**
 * Misma prioridad que cuando el grupo llega por `?groupId=`: manda la moneda que el usuario viene
 * usando, después la del grupo y por último la preferida del usuario.
 */
export const resolveGroupCurrency = (
  user: { currency?: string | null; defaultCurrency?: string | null },
  group: { defaultCurrency?: string | null },
): CurrencyCode | undefined => {
  const preferred = user.currency ?? group.defaultCurrency ?? user.defaultCurrency;

  return preferred ? parseCurrencyCode(preferred) : undefined;
};
