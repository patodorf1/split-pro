import { type Query, useIsFetching } from '@tanstack/react-query';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

/** Si el refresco es más rápido que esto, no se muestra nada (evita parpadeos). */
const SHOW_AFTER_MS = 400;

/**
 * Refrescando algo que YA está en pantalla: hay datos (viejos) visibles y se
 * están pidiendo los nuevos. Las cargas desde cero ya tienen su propio spinner.
 */
const isRefreshingVisibleData = (query: Query) =>
  undefined !== query.state.data && 0 < query.getObserversCount();

/**
 * Indicador mínimo de "actualizando": una línea fina arriba de todo mientras se
 * refrescan datos que ya se están mostrando (por ejemplo, los de la última
 * visita al abrir la app). Es `fixed`, así que no mueve nada del layout.
 */
export const RefreshingIndicator: React.FC = () => {
  const { t } = useTranslation();
  const fetching = 0 < useIsFetching({ predicate: isRefreshingVisibleData });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!fetching) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);

    return () => clearTimeout(timer);
  }, [fetching]);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-50 h-0.5"
    >
      <div className="bg-primary/60 h-full w-full animate-pulse" />
      <span className="sr-only">{t('sync.refreshing')}</span>
    </div>
  );
};
