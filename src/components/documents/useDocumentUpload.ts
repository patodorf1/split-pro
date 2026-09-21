import { useCallback, useRef, useState } from 'react';

import { DOCUMENT_MAX_SIZE_BYTES } from '~/lib/documents';

export type UploadErrorCode =
  | 'too_large'
  | 'empty'
  | 'type_not_allowed'
  | 'type_mismatch'
  | 'not_found'
  | 'generic';

export interface UploadFailure {
  fileName: string;
  code: UploadErrorCode;
}

export interface UploadProgress {
  /** Archivo que se está subiendo (1-based). */
  current: number;
  total: number;
  fileName: string;
  /** Porcentaje total (todos los archivos), 0-100. */
  percent: number;
}

const KNOWN_ERRORS: UploadErrorCode[] = [
  'too_large',
  'empty',
  'type_not_allowed',
  'type_mismatch',
  'not_found',
];

const toErrorCode = (status: number, body: string): UploadErrorCode => {
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error && (KNOWN_ERRORS as string[]).includes(parsed.error)) {
      return parsed.error as UploadErrorCode;
    }
  } catch {
    // Respuesta que no es JSON (por ejemplo un proxy cortando por tamaño).
  }

  return 413 === status ? 'too_large' : 'generic';
};

/** Un archivo por pedido, con XHR para tener el progreso de subida (fetch no lo da). */
const uploadOne = (
  folderId: number,
  file: File,
  onProgress: (loaded: number) => void,
): Promise<{ ok: true } | { ok: false; code: UploadErrorCode }> =>
  new Promise((resolve) => {
    const body = new FormData();
    body.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/documents/upload?folderId=${encodeURIComponent(String(folderId))}`);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, code: toErrorCode(xhr.status, xhr.responseText) });
      }
    };
    xhr.onerror = () => resolve({ ok: false, code: 'generic' });
    xhr.send(body);
  });

/**
 * Sube varios archivos, de a uno, a una sección. Los que superan el tope ni se mandan. Devuelve
 * cuántos subieron y cuáles fallaron (con el motivo) para avisar archivo por archivo.
 */
export const useDocumentUpload = (folderId: number | null) => {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const busy = useRef(false);

  const upload = useCallback(
    async (files: File[]): Promise<{ uploaded: number; failures: UploadFailure[] }> => {
      if (null === folderId || busy.current || 0 === files.length) {
        return { uploaded: 0, failures: [] };
      }

      busy.current = true;
      const failures: UploadFailure[] = [];
      const accepted = files.filter((file) => {
        if (file.size > DOCUMENT_MAX_SIZE_BYTES) {
          failures.push({ fileName: file.name, code: 'too_large' });
          return false;
        }
        if (0 === file.size) {
          failures.push({ fileName: file.name, code: 'empty' });
          return false;
        }
        return true;
      });

      const totalBytes = accepted.reduce((sum, file) => sum + file.size, 0) || 1;
      let doneBytes = 0;
      let uploaded = 0;

      try {
        for (const [index, file] of accepted.entries()) {
          setProgress({
            current: index + 1,
            total: accepted.length,
            fileName: file.name,
            percent: (doneBytes / totalBytes) * 100,
          });

          // oxlint-disable-next-line no-await-in-loop -- de a uno a propósito (progreso y memoria)
          const result = await uploadOne(folderId, file, (loaded) =>
            setProgress({
              current: index + 1,
              total: accepted.length,
              fileName: file.name,
              percent: ((doneBytes + Math.min(loaded, file.size)) / totalBytes) * 100,
            }),
          );

          doneBytes += file.size;

          if (result.ok) {
            uploaded += 1;
          } else {
            failures.push({ fileName: file.name, code: result.code });
          }
        }
      } finally {
        busy.current = false;
        setProgress(null);
      }

      return { uploaded, failures };
    },
    [folderId],
  );

  return { upload, progress, isUploading: null !== progress };
};
