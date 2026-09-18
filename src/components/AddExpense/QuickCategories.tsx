import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';

import { DEFAULT_CATEGORY } from '~/lib/category';
import { getCategoryTranslationKey } from '~/lib/stats';
import { TOP_CATEGORIES_LIMIT } from '~/lib/topCategories';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { CategoryIcon } from '../ui/categoryIcons';
import { Skeleton } from '../ui/skeleton';

/**
 * Alto fijo del renglón: reservado también mientras carga, así no salta el formulario. Da lugar al
 * ícono y a dos líneas de texto, para que a 390 px los nombres largos ("Comestibles",
 * "Electricidad") se lean enteros en vez de quedar cortados.
 */
const ROW_HEIGHT = 'h-[62px]';

const QuickCategoryButton: React.FC<{
  category: string;
  isActive: boolean;
  onPick: (category: string) => void;
}> = ({ category, isActive, onPick }) => {
  const { t } = useTranslation('categories');

  // Tocar la activa vuelve a la categoría general: el botón funciona como interruptor.
  const handleClick = useCallback(
    () => onPick(isActive ? DEFAULT_CATEGORY : category),
    [category, isActive, onPick],
  );

  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={handleClick}
      className={cn(
        'rounded-card focus-visible:ring-ring flex min-w-0 flex-col items-center justify-center gap-1 border px-0.5 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
        ROW_HEIGHT,
        isActive
          ? 'border-primary bg-primary-soft text-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-accent',
      )}
    >
      <CategoryIcon category={category} size={18} className="shrink-0" />
      <span className="line-clamp-2 w-full text-center text-[9px] leading-tight break-words hyphens-auto">
        {t(getCategoryTranslationKey(category))}
      </span>
    </button>
  );
};

/**
 * Renglón de "categorías rápidas": las seis categorías más usadas del grupo elegido, para no tener
 * que abrir el selector completo en el gasto de todos los días. El estado vive en el store del
 * gasto, así que se resalta igual si la categoría llega por el selector o por la URL.
 */
export const QuickCategories: React.FC<{
  groupId?: number | null;
  category: string;
  onCategoryPick: (category: string) => void;
}> = ({ groupId, category, onCategoryPick }) => {
  const { t } = useTranslation('common');

  const { data: topCategories, isPending } = api.stats.topCategories.useQuery(
    { groupId: groupId ?? null },
    {
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      // Al cambiar de grupo se mantiene el renglón anterior hasta que llega el nuevo ranking.
      placeholderData: (previous) => previous,
    },
  );

  if (isPending) {
    return (
      <div className="grid grid-cols-6 gap-1" aria-hidden>
        {Array.from({ length: TOP_CATEGORIES_LIMIT }, (_, index) => (
          <Skeleton key={index} className={cn('rounded-card w-full', ROW_HEIGHT)} />
        ))}
      </div>
    );
  }

  if (!topCategories?.length) {
    return null;
  }

  return (
    <div role="group" aria-label={t('quick_categories.label')} className="grid grid-cols-6 gap-1">
      {topCategories.map((quickCategory) => (
        <QuickCategoryButton
          key={quickCategory}
          category={quickCategory}
          isActive={quickCategory === category}
          onPick={onCategoryPick}
        />
      ))}
    </div>
  );
};
