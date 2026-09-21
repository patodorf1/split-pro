import { ChevronLeftIcon, PencilIcon, UploadIcon } from 'lucide-react';
import { type GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { DocumentActions } from '~/components/documents/DocumentActions';
import { type DocumentItem, DocumentRow } from '~/components/documents/DocumentRow';
import { FolderEditor } from '~/components/documents/FolderEditor';
import { ImageViewer } from '~/components/documents/ImageViewer';
import { openDocumentInBrowser } from '~/components/documents/documentClient';
import { FolderIconBadge } from '~/components/documents/icons';
import { useDocumentUpload } from '~/components/documents/useDocumentUpload';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ProgressBar } from '~/components/ui/progress-bar';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { DOCUMENT_ACCEPT_ATTRIBUTE, DOCUMENT_MAX_SIZE_MB, isImageMime } from '~/lib/documents';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { customServerSideTranslations } from '~/utils/i18n/server';

const DocumentFolderPage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();
  const router = useRouter();
  const utils = api.useUtils();
  const folderId = Number(router.query.folderId);
  const validId = Number.isSafeInteger(folderId) && 0 < folderId;

  const folderQuery = api.documents.getFolder.useQuery(
    { folderId },
    { enabled: validId, retry: (count, error) => 'NOT_FOUND' !== error.data?.code && count < 2 },
  );
  const overview = api.documents.overview.useQuery();

  const inputRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<DocumentItem | null>(null);
  const { upload, progress, isUploading } = useDocumentUpload(validId ? folderId : null);

  const folder = folderQuery.data?.folder;
  const documents = folderQuery.data?.documents ?? [];
  const siblings = folderQuery.data?.siblings ?? [];
  const documentCount =
    overview.data?.folders.find((entry) => entry.id === folderId)?.documentCount ??
    documents.length;

  const onFilesChosen = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Se limpia ya: así se puede volver a elegir el mismo archivo.
      event.target.value = '';

      const { uploaded, failures } = await upload(files);

      for (const failure of failures) {
        toast.error(
          'generic' === failure.code
            ? t('documents.errors.generic')
            : t(`documents.errors.${failure.code}`, {
                name: failure.fileName,
                max: DOCUMENT_MAX_SIZE_MB,
              }),
        );
      }
      if (0 < uploaded) {
        toast.success(t('documents.toast.uploaded', { count: uploaded }));
      }

      await Promise.all([
        utils.documents.getFolder.invalidate({ folderId }),
        utils.documents.overview.invalidate(),
        utils.documents.search.invalidate(),
      ]);
    },
    [folderId, t, upload, utils],
  );

  const onOpen = useCallback((document: DocumentItem) => {
    if (isImageMime(document.mimeType)) {
      setViewing(document);
    } else {
      openDocumentInBrowser(document);
    }
  }, []);

  const notFound = !validId || 'NOT_FOUND' === folderQuery.error?.data?.code;

  const title = (
    <div className="flex min-w-0 items-center gap-2">
      <Link href="/documents" aria-label={t('actions.back')}>
        <Button variant="ghost" className="p-0">
          <ChevronLeftIcon className="mr-1 h-6 w-6" />
        </Button>
      </Link>
      {folder ? (
        <>
          <FolderIconBadge icon={folder.icon} className="size-9" iconClassName="size-4" />
          <span className="truncate text-2xl font-bold">{folder.name}</span>
        </>
      ) : null}
    </div>
  );

  const actions = folder ? (
    <FolderEditor
      mode="edit"
      folder={{ ...folder, documentCount }}
      onDeleted={() => void router.replace('/documents')}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label={t('documents.folder.edit')}
        >
          <PencilIcon className="text-primary size-5" />
        </Button>
      }
    />
  ) : null;

  return (
    <>
      <Head>
        <title>{folder?.name ?? t('documents.title')}</title>
      </Head>
      <MainLayout title={title} actions={actions} loading={validId && folderQuery.isPending}>
        {notFound ? (
          <p className="text-muted-foreground mt-16 text-center text-sm">
            {t('documents.errors.not_found')}
          </p>
        ) : folder ? (
          <div className="flex flex-col gap-4 pb-8">
            {/* Sin `capture`: en el iPhone el selector ofrece Fototeca, Cámara y Archivos. */}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={DOCUMENT_ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={onFilesChosen}
              data-testid="document-file-input"
            />
            <Button
              size="lg"
              className="h-12 w-full gap-2 rounded-full text-base"
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
            >
              <UploadIcon className="size-5" />
              {t('documents.upload.button')}
            </Button>

            {progress ? (
              <Card className="flex flex-col gap-2" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-foreground min-w-0 truncate font-medium">
                    {progress.fileName}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {t('documents.upload.progress', {
                      current: progress.current,
                      total: progress.total,
                    })}
                  </span>
                </div>
                <ProgressBar value={progress.percent} label={progress.fileName} />
              </Card>
            ) : (
              <p className="text-muted-foreground -mt-1 text-center text-xs">
                {t('documents.upload.hint', { max: DOCUMENT_MAX_SIZE_MB })}
              </p>
            )}

            {0 < documents.length ? (
              <ul className="card-surface divide-border divide-y px-3">
                {documents.map((document) => (
                  <DocumentRow
                    key={document.id}
                    document={document}
                    onOpen={onOpen}
                    actions={<DocumentActions document={document} folders={siblings} />}
                  />
                ))}
              </ul>
            ) : (
              <div className="mt-10 flex flex-col items-center gap-3 text-center">
                <FolderIconBadge icon={folder.icon} className="size-14" iconClassName="size-7" />
                <p className="text-foreground text-base font-medium">
                  {t('documents.empty.title', { name: folder.name })}
                </p>
                <p className="text-muted-foreground max-w-[280px] text-sm">
                  {t('documents.empty.subtitle')}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </MainLayout>
      <ImageViewer document={viewing} onClose={() => setViewing(null)} />
    </>
  );
};

DocumentFolderPage.auth = true;

export const getServerSideProps: GetServerSideProps = async (context) => ({
  props: {
    ...(await customServerSideTranslations(context.locale, ['common'])),
  },
});

export default DocumentFolderPage;
