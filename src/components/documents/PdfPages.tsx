import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MinusIcon, PlusIcon } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { LoadingSpinner } from '~/components/ui/spinner';

import { loadPdfJs, pdfAssetUrls } from './pdfjs';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
/** Margen alrededor de las páginas y entre ellas (en px, a zoom 1; crece con el zoom). */
const GAP = 8;
/** Tope de píxeles por página: Safari de iPhone no dibuja canvas más grandes (≈16,7 M). */
const MAX_CANVAS_PIXELS = 8_000_000;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_ZOOM = 2.5;
/** Cuánto agranda/achica cada toque de los botones + y −. */
const ZOOM_STEP = 1.5;

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

interface LoadedPage {
  page: PDFPageProxy;
  /** Alto / ancho de la página. */
  ratio: number;
}

/** Una página: se dibuja sólo cuando está cerca de la pantalla y se libera al alejarse. */
const PdfPage: React.FC<{
  page: PDFPageProxy;
  ratio: number;
  width: number;
  gap: number;
  root: HTMLElement | null;
  label: string;
}> = ({ page, ratio, width, gap, root, label }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const host = hostRef.current;

    if (!host || !root) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { root, rootMargin: '100% 0px' },
    );
    observer.observe(host);

    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host || 0 >= width) {
      return;
    }

    const release = () => {
      for (const child of Array.from(host.children)) {
        if (child instanceof HTMLCanvasElement) {
          // En iOS la memoria de un canvas no se libera hasta achicarlo.
          child.width = 0;
          child.height = 0;
        }
      }
      host.replaceChildren();
    };

    if (!near) {
      release();
      return;
    }

    const base = page.getViewport({ scale: 1 });
    const cssScale = width / base.width;
    let outputScale = Math.min(window.devicePixelRatio || 1, 3);
    const pixels = base.width * base.height * (cssScale * outputScale) ** 2;

    if (pixels > MAX_CANVAS_PIXELS) {
      outputScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    }

    const viewport = page.getViewport({ scale: cssScale * outputScale });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = 'block h-full w-full';

    let cancelled = false;
    // Se dibuja aparte y se cambia al terminar: mientras tanto queda la versión anterior (estirada).
    const task = page.render({ canvas, viewport });
    task.promise
      .then(() => {
        if (cancelled) {
          return;
        }
        release();
        host.appendChild(canvas);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [near, page, width]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      className="shrink-0 bg-white shadow-md"
      style={{ width, height: width * ratio, marginBottom: gap }}
    />
  );
};

/**
 * PDF dentro de la app, con pdf.js: todas las páginas una debajo de la otra, al ancho de la
 * pantalla. Se agranda con dos dedos (o doble toque, o Ctrl + rueda en la compu).
 */
export const PdfPages: React.FC<{
  file: File;
  onError: () => void;
  pageLabel: (page: number, total: number) => string;
  zoomInLabel: string;
  zoomOutLabel: string;
}> = ({ file, onError, pageLabel, zoomInLabel, zoomOutLabel }) => {
  const [pages, setPages] = useState<LoadedPage[] | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** Dónde tiene que quedar el scroll después de aplicar un zoom (para que no "salte"). */
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Abre el PDF y lee el tamaño de cada página.
  useEffect(() => {
    let cancelled = false;
    let pdf: PDFDocumentProxy | null = null;
    let destroy: (() => Promise<void>) | null = null;

    setPages(null);
    setZoom(1);

    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await file.arrayBuffer());

        if (cancelled) {
          return;
        }

        const task = pdfjs.getDocument({ data, ...pdfAssetUrls(pdfjs.version) });
        destroy = () => task.destroy();
        pdf = await task.promise;

        const loaded: LoadedPage[] = [];
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number);
          const { width, height } = page.getViewport({ scale: 1 });
          loaded.push({ page, ratio: height / width });

          if (cancelled) {
            return;
          }
        }

        setPages(loaded);
      } catch {
        if (!cancelled) {
          onErrorRef.current();
        }
      }
    })();

    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [file]);

  useEffect(() => {
    if (!scroller) {
      return;
    }

    const measure = () => setContainerWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);

    return () => observer.disconnect();
  }, [scroller]);

  useLayoutEffect(() => {
    if (scroller && pendingScroll.current) {
      scroller.scrollLeft = pendingScroll.current.x;
      scroller.scrollTop = pendingScroll.current.y;
      pendingScroll.current = null;
    }
  }, [zoom, scroller]);

  /** Aplica un zoom nuevo dejando quieto el punto (x, y) de la pantalla (relativo al visor). */
  const zoomAround = useCallback(
    (next: number, x: number, y: number) => {
      if (!scroller) {
        return;
      }

      const current = zoomRef.current;
      const target = clampZoom(next);
      const factor = target / current;

      if (target === current) {
        return;
      }

      // Todo (páginas, márgenes) escala con el zoom, así el punto bajo los dedos sigue ahí.
      pendingScroll.current = {
        x: (scroller.scrollLeft + x) * factor - x,
        y: (scroller.scrollTop + y) * factor - y,
      };
      setZoom(target);
    },
    [scroller],
  );

  // Gestos: pellizco con dos dedos, doble toque y Ctrl + rueda (pellizco del trackpad).
  useEffect(() => {
    const content = contentRef.current;

    if (!scroller || !content) {
      return;
    }

    let pinch: {
      distance: number;
      startZoom: number;
      x: number;
      y: number;
      factor: number;
    } | null = null;
    let lastTap: { time: number; x: number; y: number } | null = null;
    let tapStart: { x: number; y: number; moved: boolean } | null = null;

    const point = (touch: Touch) => {
      const rect = scroller.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    };

    const onTouchStart = (event: TouchEvent) => {
      if (2 === event.touches.length) {
        const a = point(event.touches[0]!);
        const b = point(event.touches[1]!);
        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          startZoom: zoomRef.current,
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          factor: 1,
        };
        tapStart = null;
        lastTap = null;
        // El punto de origen del "estirado" provisorio, en coordenadas del contenido.
        content.style.transformOrigin = `${scroller.scrollLeft + pinch.x}px ${scroller.scrollTop + pinch.y}px`;
      } else if (1 === event.touches.length) {
        const p = point(event.touches[0]!);
        tapStart = { ...p, moved: false };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (pinch && 2 <= event.touches.length) {
        event.preventDefault();
        const a = point(event.touches[0]!);
        const b = point(event.touches[1]!);
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const target = clampZoom((pinch.startZoom * distance) / pinch.distance);
        pinch.factor = target / pinch.startZoom;
        content.style.transform = `scale(${pinch.factor})`;
      } else if (tapStart && 1 === event.touches.length) {
        const p = point(event.touches[0]!);
        if (10 < Math.hypot(p.x - tapStart.x, p.y - tapStart.y)) {
          tapStart.moved = true;
        }
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (pinch && 2 > event.touches.length) {
        const { startZoom, factor, x, y } = pinch;
        pinch = null;
        content.style.transform = '';
        content.style.transformOrigin = '';

        if (1 !== factor) {
          zoomAround(startZoom * factor, x, y);
        }
        return;
      }

      if (tapStart && !tapStart.moved && 0 === event.touches.length) {
        const now = Date.now();
        const { x, y } = tapStart;

        if (
          lastTap &&
          now - lastTap.time < DOUBLE_TAP_MS &&
          30 > Math.hypot(x - lastTap.x, y - lastTap.y)
        ) {
          event.preventDefault();
          zoomAround(1 < zoomRef.current ? 1 : DOUBLE_TAP_ZOOM, x, y);
          lastTap = null;
        } else {
          lastTap = { time: now, x, y };
        }
      }
      tapStart = null;
    };

    // Safari: sin esto, el pellizco agranda toda la página (encabezado incluido).
    const preventGesture = (event: Event) => event.preventDefault();

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const rect = scroller.getBoundingClientRect();
      zoomAround(
        zoomRef.current * Math.exp(-event.deltaY / 100),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd, { passive: false });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: false });
    scroller.addEventListener('gesturestart', preventGesture, { passive: false });
    scroller.addEventListener('gesturechange', preventGesture, { passive: false });
    scroller.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      scroller.removeEventListener('gesturestart', preventGesture);
      scroller.removeEventListener('gesturechange', preventGesture);
      scroller.removeEventListener('wheel', onWheel);
    };
  }, [scroller, zoomAround, pages]);

  const gap = GAP * zoom;
  const pageWidth = Math.max(0, containerWidth - 2 * GAP) * zoom;

  // Botones + y −: la página de la app no se puede agrandar (viewport sin zoom), así que el
  // documento tiene su propio zoom, siempre a mano aunque el pellizco no ande.
  const zoomByStep = (direction: 1 | -1) => {
    if (scroller) {
      zoomAround(
        zoomRef.current * ZOOM_STEP ** direction,
        scroller.clientWidth / 2,
        scroller.clientHeight / 2,
      );
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={setScroller}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-neutral-800"
        style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}
        data-testid="pdf-viewer"
      >
        {pages ? (
          <div
            ref={contentRef}
            className="flex flex-col items-center"
            style={{
              width: containerWidth * zoom,
              minWidth: '100%',
              paddingTop: gap,
              paddingBottom: `calc(${gap}px + env(safe-area-inset-bottom))`,
            }}
          >
            {pages.map(({ page, ratio }, index) => (
              <PdfPage
                key={index}
                page={page}
                ratio={ratio}
                width={pageWidth}
                gap={gap}
                root={scroller}
                label={pageLabel(index + 1, pages.length)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner className="text-white" />
          </div>
        )}
      </div>
      {pages ? (
        <div className="absolute right-[max(env(safe-area-inset-right),0.75rem)] bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] flex flex-col overflow-hidden rounded-full bg-black/70 text-white shadow-lg backdrop-blur">
          <button
            type="button"
            className="flex size-11 items-center justify-center disabled:opacity-40"
            aria-label={zoomInLabel}
            disabled={MAX_ZOOM <= zoom}
            onClick={() => zoomByStep(1)}
          >
            <PlusIcon className="size-5" />
          </button>
          <button
            type="button"
            className="flex size-11 items-center justify-center border-t border-white/20 disabled:opacity-40"
            aria-label={zoomOutLabel}
            disabled={MIN_ZOOM >= zoom}
            onClick={() => zoomByStep(-1)}
          >
            <MinusIcon className="size-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
};
