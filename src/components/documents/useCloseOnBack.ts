import Router from 'next/router';
import { useEffect, useRef } from 'react';

const allowAll = () => true;

type ViewerHistoryState = { __documentViewer?: string } | null;

const currentMarker = () => (window.history.state as ViewerHistoryState)?.__documentViewer;

/**
 * `history.back()` es asíncrono: si el visor se vuelve a abrir antes de que llegue ese popstate
 * (o React monta dos veces en modo estricto), la entrada nueva se agregaría arriba de la vieja y el
 * popstate pendiente la cerraría. Por eso se espera a que termine el "atrás" anterior.
 */
let pendingBack: Promise<void> | null = null;

/**
 * Mientras `open` es true, el gesto/botón "atrás" (Android, navegador) cierra el visor en vez de
 * salir de la pantalla.
 *
 * Al abrir se agrega una entrada al historial (misma URL, copia del estado de Next más una marca).
 * "Atrás" la saca y avisa con `popstate`: ahí se cierra el visor. Mientras tanto `beforePopState`
 * le dice a Next que no vuelva a cargar la página. Si se cierra con la X, se saca la entrada a mano
 * (`history.back()`) para no dejar un "atrás" fantasma.
 *
 * Los listeners de `popstate` propios se registran después que el de Next, así que corren después:
 * por eso son los que restauran `beforePopState` (Next a veces descarta el primer popstate sin
 * consultarlo, y un "ignorar el próximo" quedaría armado para la siguiente navegación real).
 */
export const useCloseOnBack = (open: boolean, onClose: () => void) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || 'undefined' === typeof window) {
      return;
    }

    const marker = `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let active = true;
    let pushed = false;
    let closedByHistory = false;

    const onPopState = () => {
      if (currentMarker() !== marker) {
        closedByHistory = true;
        onCloseRef.current();
      }
    };

    const push = () => {
      if (!active) {
        return;
      }
      const previous = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.pushState({ ...previous, __documentViewer: marker }, '');
      pushed = true;
      // Mientras el visor está abierto, cualquier "atrás" es para cerrarlo: Next no hace nada.
      Router.beforePopState(() => false);
      window.addEventListener('popstate', onPopState);
    };

    if (pendingBack) {
      void pendingBack.then(push);
    } else {
      push();
    }

    return () => {
      active = false;

      if (!pushed) {
        return;
      }
      window.removeEventListener('popstate', onPopState);

      if (!closedByHistory && currentMarker() === marker) {
        // Cerrado con la X: se saca la entrada; Next ignora ese único popstate.
        Router.beforePopState(() => false);
        pendingBack = new Promise((resolve) => {
          const restore = () => {
            window.removeEventListener('popstate', restore);
            Router.beforePopState(allowAll);
            pendingBack = null;
            resolve();
          };
          window.addEventListener('popstate', restore);
        });
        window.history.back();
      } else {
        Router.beforePopState(allowAll);
      }
    };
  }, [open]);
};
