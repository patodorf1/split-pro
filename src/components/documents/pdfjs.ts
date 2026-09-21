/**
 * Carga perezosa de pdf.js: la librería (y su worker) sólo se bajan la primera vez que se abre un
 * PDF, en un chunk aparte, así no pesan en el resto de la app.
 *
 * Se usa el build "legacy" porque trae compatibilidad con Safari de iPhone no tan nuevos. El worker
 * lo empaqueta webpack y se sirve desde nuestro propio dominio.
 */
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let loader: Promise<PdfJs> | null = null;

export const loadPdfJs = (): Promise<PdfJs> => {
  loader ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url),
        { type: 'module' },
      );
    }

    return pdfjs;
  });
  // Si falló (sin conexión), el próximo intento vuelve a probar.
  loader.catch(() => {
    loader = null;
  });

  return loader;
};

/**
 * Datos opcionales de pdf.js (tablas de caracteres asiáticos, fuentes estándar no incrustadas y
 * decodificadores de imágenes JPEG 2000/JBIG2). Sólo se piden si el PDF los necesita; si no hay
 * conexión, pdf.js usa reemplazos y el documento igual se ve.
 */
export const pdfAssetUrls = (version: string) => {
  const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}`;

  return {
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
    wasmUrl: `${base}/wasm/`,
    iccUrl: `${base}/iccs/`,
  };
};
