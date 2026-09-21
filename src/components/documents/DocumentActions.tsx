import {
  CheckIcon,
  DownloadIcon,
  FolderInputIcon,
  MoreVerticalIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
} from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { MAX_DOCUMENT_NAME_LENGTH } from '~/lib/documents';
import { api } from '~/utils/api';

import { type DocumentItem } from './DocumentRow';
import {
  afterOverlayClosed,
  downloadDocument,
  fetchDocumentFile,
  shareDocumentFile,
} from './documentClient';
import { FolderIconBadge } from './icons';

/** Hasta este tamaño el archivo se baja apenas se abre el menú, para que Compartir sea instantáneo. */
const SHARE_PREFETCH_MAX_BYTES = 10 * 1024 * 1024;

const canShareFiles = () =>
  'undefined' !== typeof navigator && 'function' === typeof navigator.canShare;

type View = 'menu' | 'rename' | 'move' | 'delete';

const MENU_ROW = 'flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-sm';

/**
 * Menú de un documento: Compartir, Descargar, Renombrar, Mover a… y Borrar. Al terminar invalida
 * la sección, el resumen y la búsqueda para que todo quede al día.
 */
export const DocumentActions: React.FC<{
  document: DocumentItem;
  folders: { id: number; name: string; icon: string }[];
}> = ({ document, folders }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [name, setName] = useState(document.name);
  const [sharing, setSharing] = useState(false);
  const prefetched = useRef<Promise<File> | null>(null);
  const latest = useRef(document);
  latest.current = document;

  // Sólo al abrir el menú (no en cada refetch de la lista).
  useEffect(() => {
    if (!open) {
      prefetched.current = null;
      return;
    }

    const current = latest.current;
    setView('menu');
    setName(current.name);

    if (canShareFiles() && current.size <= SHARE_PREFETCH_MAX_BYTES) {
      const promise = fetchDocumentFile(current);
      promise.catch(() => undefined);
      prefetched.current = promise;
    }
  }, [open, document.id]);

  // Refresca la lista cuando el drawer/diálogo ya cerró (ver `afterOverlayClosed`).
  const invalidate = useCallback(() => {
    afterOverlayClosed(() => {
      void utils.documents.getFolder.invalidate();
      void utils.documents.overview.invalidate();
      void utils.documents.search.invalidate();
      void utils.documents.upcomingExpiries.invalidate();
    });
  }, [utils]);

  const onError = useCallback(() => toast.error(t('documents.errors.generic')), [t]);

  const rename = api.documents.renameDocument.useMutation({
    onSuccess: () => {
      toast.success(t('documents.toast.renamed'));
      setOpen(false);
      invalidate();
    },
    onError,
  });

  const move = api.documents.moveDocument.useMutation({
    onSuccess: (_data, variables) => {
      const target = folders.find((folder) => folder.id === variables.folderId);
      toast.success(t('documents.toast.moved', { name: target?.name ?? '' }));
      setOpen(false);
      invalidate();
    },
    onError,
  });

  const remove = api.documents.deleteDocument.useMutation({
    onSuccess: () => {
      toast.success(t('documents.toast.deleted'));
      setOpen(false);
      invalidate();
    },
    onError,
  });

  const onShare = useCallback(async () => {
    setSharing(true);
    try {
      const file = await (prefetched.current ?? fetchDocumentFile(document));
      prefetched.current = Promise.resolve(file);
      const outcome = await shareDocumentFile(document, file);

      if ('needs_retry' === outcome) {
        // Safari perdió el "toque" mientras bajaba el archivo: ahora ya está listo.
        toast(t('documents.share_retry'));
        return;
      }
      if ('shared' === outcome || 'downloaded' === outcome) {
        setOpen(false);
      }
    } catch {
      toast.error(t('documents.errors.share_failed'));
    } finally {
      setSharing(false);
    }
  }, [document, t]);

  const onDownload = useCallback(() => {
    downloadDocument(document);
    setOpen(false);
  }, [document]);

  const onRenameSave = useCallback(() => {
    const trimmed = name.trim();

    if (!trimmed || trimmed === document.name) {
      setOpen(false);
      return;
    }

    rename.mutate({ id: document.id, name: trimmed });
  }, [document.id, document.name, name, rename]);

  const onDelete = useCallback(() => remove.mutate({ id: document.id }), [document.id, remove]);

  const title =
    'rename' === view
      ? t('documents.rename.title')
      : 'move' === view
        ? t('documents.move.title')
        : 'delete' === view
          ? t('documents.confirm_delete.title')
          : document.name;

  return (
    <>
      <AppDrawer
        open={open}
        onOpenChange={setOpen}
        title={title}
        actionTitle={'rename' === view ? t('documents.actions.save') : undefined}
        actionOnClick={'rename' === view ? onRenameSave : undefined}
        actionDisabled={!name.trim() || rename.isPending}
        className="h-auto"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-9 shrink-0"
            aria-label={t('documents.actions.menu', { name: document.name })}
          >
            <MoreVerticalIcon className="size-5" />
          </Button>
        }
      >
        {'menu' === view ? (
          <div className="flex flex-col pb-4">
            <button type="button" className={MENU_ROW} onClick={onShare} disabled={sharing}>
              <Share2Icon className="text-primary size-5" />
              <span className="flex-1">{t('documents.actions.share')}</span>
            </button>
            <button type="button" className={MENU_ROW} onClick={onDownload}>
              <DownloadIcon className="text-primary size-5" />
              <span className="flex-1">{t('documents.actions.download')}</span>
            </button>
            <button type="button" className={MENU_ROW} onClick={() => setView('rename')}>
              <PencilIcon className="text-primary size-5" />
              <span className="flex-1">{t('documents.actions.rename')}</span>
            </button>
            {1 < folders.length ? (
              <button type="button" className={MENU_ROW} onClick={() => setView('move')}>
                <FolderInputIcon className="text-primary size-5" />
                <span className="flex-1">{t('documents.actions.move')}</span>
              </button>
            ) : null}
            <button
              type="button"
              className={`${MENU_ROW} text-destructive`}
              // La confirmación va dentro del mismo drawer: dos overlays encimados (drawer +
              // Diálogo) dejan el <body> con pointer-events: none al cerrarse.
              onClick={() => setView('delete')}
            >
              <Trash2Icon className="size-5" />
              <span className="flex-1">{t('documents.actions.delete')}</span>
            </button>
          </div>
        ) : null}

        {'rename' === view ? (
          <form
            className="flex flex-col gap-2 px-1 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              onRenameSave();
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_DOCUMENT_NAME_LENGTH}
              placeholder={t('documents.rename.placeholder')}
              aria-label={t('documents.rename.placeholder')}
            />
          </form>
        ) : null}

        {'move' === view ? (
          <ul className="divide-border flex flex-col divide-y pb-4">
            {folders.map((folder) => {
              const isCurrent = folder.id === document.folderId;

              return (
                <li key={folder.id}>
                  <button
                    type="button"
                    className={MENU_ROW}
                    disabled={isCurrent || move.isPending}
                    onClick={() => move.mutate({ id: document.id, folderId: folder.id })}
                  >
                    <FolderIconBadge icon={folder.icon} className="size-9" iconClassName="size-4" />
                    <span className="flex-1">{folder.name}</span>
                    {isCurrent ? (
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <CheckIcon className="size-4" />
                        {t('documents.move.current')}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {'delete' === view ? (
          <div className="flex flex-col gap-4 px-1 pb-4">
            <p className="text-muted-foreground text-sm">
              {t('documents.confirm_delete.description', { name: document.name })}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setView('menu')}>
                {t('documents.actions.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={onDelete}
                disabled={remove.isPending}
              >
                {t('documents.actions.delete')}
              </Button>
            </div>
          </div>
        ) : null}
      </AppDrawer>
    </>
  );
};
