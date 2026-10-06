import React, { useCallback, useRef, useState } from 'react';

/** Cuánto hay que deslizar (px) para que suelte y saque. */
const THRESHOLD = 96;

/**
 * Envuelve una fila: deslizándola a la izquierda aparece la acción y, pasado el umbral, se ejecuta
 * al soltar. El scroll vertical sigue andando (`touch-action: pan-y`) y un deslizamiento no cuenta
 * como toque sobre la fila.
 */
export const SwipeToRemove: React.FC<{
  label: string;
  onRemove: () => void;
  children: React.ReactNode;
}> = ({ label, onRemove, children }) => {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const moved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ('mouse' === e.pointerType && 0 !== e.button) {
      return;
    }
    start.current = { x: e.clientX, y: e.clientY, dragging: false };
    moved.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const origin = start.current;
    if (!origin) {
      return;
    }
    const x = e.clientX - origin.x;
    const y = e.clientY - origin.y;
    if (!origin.dragging) {
      // Recién decide cuando el dedo se movió lo suficiente y más de costado que para abajo.
      if (Math.abs(x) < 8 || Math.abs(x) < Math.abs(y)) {
        if (Math.abs(y) > 8) {
          start.current = null;
        }
        return;
      }
      origin.dragging = true;
      moved.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setDx(Math.min(0, x));
  }, []);

  const onPointerUp = useCallback(() => {
    const passed = -dx > THRESHOLD;
    start.current = null;
    setDx(0);
    if (passed) {
      onRemove();
    }
  }, [dx, onRemove]);

  // Cancelado por el sistema (gesto de iOS, el navegador se queda con el puntero): nunca saca.
  const onPointerCancel = useCallback(() => {
    start.current = null;
    setDx(0);
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = false;
    }
  }, []);

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="bg-destructive text-destructive-foreground absolute inset-0 flex items-center justify-end px-4 text-sm font-medium"
      >
        {label}
      </div>
      <div
        className="bg-card relative touch-pan-y transition-transform duration-150"
        style={{
          transform: `translateX(${dx}px)`,
          transitionDuration: 0 === dx ? undefined : '0ms',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
};
