import { DownloadIcon, Share2Icon, XIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '~/components/ui/dialog';
import { LoadingSpinner } from '~/components/ui/spinner';

import {
  type DocumentFileRef,
  type ViewerKind,
  documentUrl,
  downloadDocument,
  fetchDocumentFile,
  getViewerKind,
  shareDocumentFile,
} from './documentClient';
import { DocumentTypeIcon } from './icons';
import { useCloseOnBack } from './useCloseOnBack';

// pdf.js pesa: el visor de PDF (y la librería) se bajan recién al abrir el primer PDF.
const PdfPages = dynamic(() => import('./PdfPages').then((module) => module.PdfPages), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center bg-neutral-800">
      <LoadingSpinner className="text-white" />
    </div>
  ),
});

const HEADER_BUTTON = 'size-11 shrink-0 text-white hover:bg-white/10 hover:text-white';

/** No se pudo mostrar: ícono del tipo y botón para descargarlo. */
const CannotShow: React.FC<{ document: DocumentFileRef; message?: string }> = ({
  document,
  message,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center text-white">
      <DocumentTypeIcon mimeType={document.mimeType} className="size-12" />
      {message ? <p className="text-sm text-white/80">{message}</p> : null}
      <Button onClick={() => downloadDocument(document)}>
        <DownloadIcon className="mr-2 size-4" />
        {t('documents.actions.download')}
      </Button>
    </div>
  );
};

const TextContent: React.FC<{ file: File; onError: () => void }> = ({ file, onError }) => {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    file
      .text()
      .then((value) => !cancelled && setText(value))
      .catch(() => !cancelled && onError());

    return () => {
      cancelled = true;
    };
  }, [file, onError]);

  if (null === text) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingSpinner className="text-white" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-neutral-800 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
      <pre className="bg-background text-foreground min-h-full rounded-md p-4 font-mono text-sm break-words whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
};

const ImageContent: React.FC<{ document: DocumentFileRef }> = ({ document }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [document.id]);

  if (failed) {
    return <CannotShow document={document} />;
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto pb-[env(safe-area-inset-bottom)]">
      {/* oxlint-disable-next-line next/no-img-element -- archivo privado servido por la API */}
      <img
        src={documentUrl(document.id)}
        alt={document.name}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
};

/**
 * Visor a pantalla completa dentro de la app para fotos, PDF y texto. Siempre tiene una X arriba a
 * la izquierda (respetando el notch) para volver, y el "atrás" del teléfono también lo cierra.
 * Arriba a la derecha: Compartir (hoja nativa: WhatsApp, Archivos…) y Descargar.
 *
 * Office no se puede mostrar: esos se descargan directo sin abrir el visor (`getViewerKind`).
 */
export const DocumentViewer: React.FC<{
  document: DocumentFileRef | null;
  onClose: () => void;
}> = ({ document, onClose }) => {
  const { t } = useTranslation();
  const open = null !== document;
  const kind: ViewerKind | null = document ? getViewerKind(document.mimeType) : null;
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);

  useCloseOnBack(open, onClose);

  // Se baja el archivo una vez: lo usa el visor de PDF/texto y deja Compartir instantáneo
  // (Safari pierde el "toque" si hay que esperar la descarga).
  useEffect(() => {
    setFile(null);
    setFailed(false);

    if (!document) {
      return;
    }

    let cancelled = false;
    fetchDocumentFile(document)
      .then((value) => !cancelled && setFile(value))
      .catch(() => {
        // Para fotos no importa: la imagen se carga sola y Compartir reintenta.
        if (!cancelled && 'image' !== getViewerKind(document.mimeType)) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [document]);

  const onFailed = useCallback(() => setFailed(true), []);

  const onShare = useCallback(async () => {
    if (!document) {
      return;
    }

    setSharing(true);
    try {
      const shared = file ?? (await fetchDocumentFile(document));
      setFile(shared);
      const outcome = await shareDocumentFile(document, shared);

      if ('needs_retry' === outcome) {
        toast(t('documents.share_retry'));
      }
    } catch {
      toast.error(t('documents.errors.share_failed'));
    } finally {
      setSharing(false);
    }
  }, [document, file, t]);

  const pageLabel = useCallback(
    (page: number, total: number) => t('documents.viewer.page', { page, total }),
    [t],
  );

  let content: React.ReactNode = null;

  if (document) {
    if (failed || !kind) {
      content = <CannotShow document={document} message={t('documents.viewer.error')} />;
    } else if ('image' === kind) {
      content = <ImageContent document={document} />;
    } else if (!file) {
      content = (
        <div className="flex flex-1 items-center justify-center bg-neutral-800">
          <LoadingSpinner className="text-white" />
        </div>
      );
    } else if ('pdf' === kind) {
      content = (
        <PdfPages
          file={file}
          onError={onFailed}
          pageLabel={pageLabel}
          zoomInLabel={t('documents.viewer.zoom_in')}
          zoomOutLabel={t('documents.viewer.zoom_out')}
        />
      );
    } else {
      content = <TextContent file={file} onError={onFailed} />;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-1 bg-black pt-[max(env(safe-area-inset-top),0.5rem)] pr-[max(env(safe-area-inset-right),0.25rem)] pb-1 pl-[max(env(safe-area-inset-left),0.25rem)] text-white">
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className={HEADER_BUTTON}
              aria-label={t('documents.viewer.close')}
            >
              <XIcon className="size-7" />
            </Button>
          </DialogClose>
          <DialogTitle className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-white">
            {document?.name}
          </DialogTitle>
          {document ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={HEADER_BUTTON}
                aria-label={t('documents.actions.share')}
                disabled={sharing}
                onClick={onShare}
              >
                <Share2Icon className="size-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={HEADER_BUTTON}
                aria-label={t('documents.actions.download')}
                onClick={() => downloadDocument(document)}
              >
                <DownloadIcon className="size-5" />
              </Button>
            </>
          ) : null}
        </div>
        {content}
      </DialogContent>
    </Dialog>
  );
};
