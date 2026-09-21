import { DownloadIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useEffect, useState } from 'react';

import { Button } from '~/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '~/components/ui/dialog';

import { type DocumentFileRef, documentUrl, downloadDocument } from './documentClient';
import { DocumentTypeIcon } from './icons';

/**
 * Visor de imágenes a pantalla completa dentro de la app. Si el navegador no sabe mostrar el
 * formato (HEIC fuera de Safari), ofrece descargarlo.
 */
export const ImageViewer: React.FC<{
  document: DocumentFileRef | null;
  onClose: () => void;
}> = ({ document, onClose }) => {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [document?.id]);

  return (
    <Dialog open={null !== document} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-black p-0 sm:max-w-none"
      >
        <div className="flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 text-white">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium text-white">
            {document?.name}
          </DialogTitle>
          {document ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-10 text-white hover:text-white/70"
              aria-label={t('documents.actions.download')}
              onClick={() => downloadDocument(document)}
            >
              <DownloadIcon className="size-5" />
            </Button>
          ) : null}
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 text-white hover:text-white/70"
              aria-label={t('documents.viewer.close')}
            >
              <XIcon className="size-6" />
            </Button>
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto pb-[env(safe-area-inset-bottom)]">
          {document && !failed ? (
            // oxlint-disable-next-line next/no-img-element -- archivo privado servido por la API
            <img
              src={documentUrl(document.id)}
              alt={document.name}
              onError={() => setFailed(true)}
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
          {document && failed ? (
            <div className="flex flex-col items-center gap-4 text-white">
              <DocumentTypeIcon mimeType={document.mimeType} className="size-12" />
              <Button onClick={() => downloadDocument(document)}>
                <DownloadIcon className="mr-2 size-4" />
                {t('documents.actions.download')}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
