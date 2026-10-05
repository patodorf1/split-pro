import { useEffect, useMemo } from 'react';

import { useTimeZone } from '~/components/dashboard/hooks';
import { formatDay } from '~/lib/agenda';
import { getZonedCalendarDay } from '~/lib/stats';
import { type RouterOutputs, api } from '~/utils/api';

export type TodayEvent = Extract<RouterOutputs['calendar']['range'][number], { kind: 'event' }>;

/** Eventos propios de la Agenda para hoy (turnos, cumpleaños…), en el día del teléfono. */
export const useTodayEvents = (): TodayEvent[] => {
  const timeZone = useTimeZone();
  const today = useMemo(() => formatDay(getZonedCalendarDay(timeZone)), [timeZone]);
  const todayQuery = api.calendar.range.useQuery({ from: today, to: today, timeZone });

  return useMemo(
    () => (todayQuery.data ?? []).filter((item): item is TodayEvent => 'event' === item.kind),
    [todayQuery.data],
  );
};

/**
 * Numerito del ícono de la app (iPhone con la app en la pantalla de inicio y notificaciones
 * permitidas; Android/escritorio instalados): los avisos de hoy, lo mismo que el cuadro de arriba
 * de Inicio (eventos de hoy + documentos por vencer o vencidos que no se pospusieron ni
 * descartaron). Se recalcula al abrir la app y cuando cambian esos datos.
 */
export const useAppBadge = () => {
  const todayEvents = useTodayEvents();
  const expiriesQuery = api.documents.upcomingExpiries.useQuery();
  const count = todayEvents.length + (expiriesQuery.data?.length ?? 0);
  const ready = undefined !== expiriesQuery.data;

  useEffect(() => {
    const nav = globalThis.navigator as
      | (Navigator & {
          setAppBadge?: (count?: number) => Promise<void>;
          clearAppBadge?: () => Promise<void>;
        })
      | undefined;

    if (!ready || !nav?.setAppBadge || !nav.clearAppBadge) {
      return;
    }

    (0 < count ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {
      // Sin permiso de notificaciones el sistema no deja poner el número: no pasa nada.
    });
  }, [count, ready]);
};

/** Montado una vez con la sesión iniciada; no dibuja nada. */
export const AppBadgeSync: React.FC = () => {
  useAppBadge();
  return null;
};
