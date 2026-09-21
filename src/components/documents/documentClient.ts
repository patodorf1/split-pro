import { downloadFileName, getDocumentTypeByMime } from '~/lib/documents';

/** Lo mínimo que necesita el cliente para abrir, bajar o compartir un documento. */
export interface DocumentFileRef {
  id: string;
  name: string;
  mimeType: string;
}

export const documentUrl = (id: string, options: { download?: boolean; thumb?: boolean } = {}) => {
  const params = new URLSearchParams();

  if (options.download) {
    params.set('download', '1');
  }
  if (options.thumb) {
    params.set('thumb', '1');
  }

  const query = params.toString();

  return `/api/documents/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
};

/** Descarga con el nombre visible (el servidor además manda `Content-Disposition: attachment`). */
export const downloadDocument = (document: DocumentFileRef) => {
  const link = window.document.createElement('a');
  link.href = documentUrl(document.id, { download: true });
  link.download = downloadFileName(document.name, document.mimeType);
  link.rel = 'noopener';
  window.document.body.appendChild(link);
  link.click();
  link.remove();
};

/**
 * PDF y texto: se abren en el visor del navegador (en el iPhone, la vista de Safari con su botón
 * de compartir). Office: se descarga. Las imágenes las muestra la app (ver `ImageViewer`).
 */
export const openDocumentInBrowser = (document: DocumentFileRef) => {
  const type = getDocumentTypeByMime(document.mimeType);

  if (!type?.inline) {
    downloadDocument(document);
    return;
  }

  // Sin 'noopener' en los features: con él `window.open` devuelve null siempre y no se podría
  // Detectar el bloqueo. Se corta el vínculo a mano.
  const opened = window.open(documentUrl(document.id), '_blank');

  if (opened) {
    opened.opener = null;
  } else {
    // Bloqueador de ventanas (o PWA sin pestañas): se abre en la misma.
    window.location.assign(documentUrl(document.id));
  }
};

/** Baja el archivo como `File` (con su nombre y tipo) para pasárselo a la hoja de compartir. */
export const fetchDocumentFile = async (document: DocumentFileRef): Promise<File> => {
  const response = await fetch(documentUrl(document.id, { download: true }), {
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();

  return new File([blob], downloadFileName(document.name, document.mimeType), {
    type: document.mimeType,
  });
};

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded' | 'needs_retry';

/**
 * Comparte el archivo con la hoja nativa (en el iPhone: WhatsApp, Mail, AirDrop…). Si el
 * navegador no puede compartir archivos, lo descarga.
 *
 * Safari exige que `navigator.share` se llame "pegado" al toque del usuario: por eso el archivo
 * se baja antes (al abrir el menú) y acá llega ya listo. Si igual se perdió el gesto, devuelve
 * `needs_retry` para pedir un segundo toque (que ya sale instantáneo).
 */
export const shareDocumentFile = async (
  document: DocumentFileRef,
  file: File,
): Promise<ShareOutcome> => {
  const shareData: ShareData = { files: [file], title: document.name };

  if ('function' !== typeof navigator.share || !navigator.canShare?.(shareData)) {
    downloadDocument(document);
    return 'downloaded';
  }

  try {
    await navigator.share(shareData);
    return 'shared';
  } catch (error) {
    const name = (error as { name?: string }).name;

    if ('AbortError' === name) {
      return 'cancelled';
    }
    if ('NotAllowedError' === name) {
      return 'needs_retry';
    }

    throw error;
  }
};

/**
 * Tiempo de la animación de cierre de los drawers/diálogos (más un margen).
 *
 * Si la fila que tiene el drawer o el diálogo abierto se desmonta mientras se cierra (por ejemplo
 * al borrar o mover un documento, o al borrar una sección), vaul/Radix dejan
 * `pointer-events: none` pegado en el <body> y la pantalla queda sin responder a los toques.
 * Por eso lo que hace desaparecer la fila (refrescar la lista) va DESPUÉS de que terminó de cerrar.
 */
const CLOSE_ANIMATION_MS = 700;

export const afterOverlayClosed = (callback: () => void) => {
  setTimeout(callback, CLOSE_ANIMATION_MS);
};
