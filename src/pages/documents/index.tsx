import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderPlusIcon,
  PencilIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DocumentActions } from '~/components/documents/DocumentActions';
import { type DocumentItem, DocumentRow } from '~/components/documents/DocumentRow';
import { FolderEditor } from '~/components/documents/FolderEditor';
import { DocumentViewer } from '~/components/documents/DocumentViewer';
import { downloadDocument, getViewerKind } from '~/components/documents/documentClient';
import { FolderIconBadge } from '~/components/documents/icons';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { isImageMime } from '~/lib/documents';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const SEARCH_DEBOUNCE_MS = 250;

const useDebounced = (value: string, delay: number) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const DocumentsPage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();
  const utils = api.useUtils();
  const overview = api.documents.overview.useQuery();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<DocumentItem | null>(null);
  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);

  const search = api.documents.search.useQuery(
    { query: debouncedQuery },
    { enabled: 0 < debouncedQuery.length },
  );

  const folders = useMemo(() => overview.data?.folders ?? [], [overview.data]);
  const groups = useMemo(() => overview.data?.groups ?? [], [overview.data]);

  /** Grupo al que se agregan secciones nuevas: el que ya tiene secciones (en la práctica, "Casa"). */
  const defaultGroupId = folders[0]?.groupId ?? (1 === groups.length ? groups[0]!.id : null);

  const moveFolder = api.documents.moveFolder.useMutation({
    onSuccess: () => utils.documents.overview.invalidate(),
    onError: () => toast.error(t('documents.errors.generic')),
  });

  // Fotos, PDF y texto se ven en el visor de la app (con X para volver); Office se descarga.
  const onOpen = useCallback((document: DocumentItem) => {
    if (getViewerKind(document.mimeType)) {
      setViewing(document);
    } else {
      downloadDocument(document);
    }
  }, []);

  const searching = 0 < query.trim().length;

  const actions = (
    <div className="flex items-center gap-4">
      {0 < folders.length ? (
        <Button
          variant="ghost"
          size={editing ? 'sm' : 'icon'}
          className={editing ? 'h-9 px-1' : 'size-9'}
          aria-pressed={editing}
          aria-label={t('documents.folder.edit_sections')}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? (
            <span className="text-primary text-sm font-semibold">{t('documents.folder.done')}</span>
          ) : (
            <PencilIcon className="text-primary size-5" />
          )}
        </Button>
      ) : null}
      <FolderEditor
        mode="create"
        groups={groups}
        defaultGroupId={defaultGroupId}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={t('documents.folder.create')}
          >
            <FolderPlusIcon className="text-primary size-6" />
          </Button>
        }
      />
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('documents.title')}</title>
      </Head>
      <MainLayout title={t('documents.title')} actions={actions} loading={overview.isPending}>
        <div className="flex flex-col gap-5 pb-8">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('documents.search_placeholder')}
              aria-label={t('documents.search_placeholder')}
              className="bg-card h-11 rounded-full pl-10"
              rightIcon={
                searching ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label={t('documents.viewer.close')}
                    className="text-muted-foreground flex"
                  >
                    <XIcon className="size-4" />
                  </button>
                ) : null
              }
            />
          </div>

          {searching ? (
            <section className="flex flex-col gap-2">
              {search.data && 0 < search.data.length ? (
                <ul className="card-surface divide-border divide-y px-3">
                  {search.data.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      folderName={document.folder.name}
                      onOpen={onOpen}
                      actions={
                        <DocumentActions
                          document={document}
                          folders={folders.filter((folder) => folder.groupId === document.groupId)}
                        />
                      }
                    />
                  ))}
                </ul>
              ) : null}
              {search.data && 0 === search.data.length && debouncedQuery === query.trim() ? (
                <p className="text-muted-foreground mt-8 text-center text-sm">
                  {t('documents.empty.search', { query: query.trim() })}
                </p>
              ) : null}
            </section>
          ) : (
            <section className="flex flex-col gap-3">
              {0 < folders.length ? <SectionLabel>{t('documents.sections')}</SectionLabel> : null}

              {0 === folders.length ? (
                <div className="mt-16 flex flex-col items-center gap-3 text-center">
                  <FolderIconBadge icon="folder" className="size-14" iconClassName="size-7" />
                  <p className="text-muted-foreground max-w-[280px] text-sm">
                    {t('documents.empty.no_folders')}
                  </p>
                </div>
              ) : null}

              {editing ? (
                <ul className="card-surface divide-border divide-y px-3">
                  {folders.map((folder, index) => (
                    <li key={folder.id} className="flex items-center gap-3 py-2.5">
                      <FolderIconBadge
                        icon={folder.icon}
                        className="size-9"
                        iconClassName="size-4"
                      />
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                        {folder.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-9"
                        disabled={0 === index || moveFolder.isPending}
                        aria-label={t('documents.folder.move_up')}
                        onClick={() => moveFolder.mutate({ folderId: folder.id, direction: 'up' })}
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-9"
                        disabled={folders.length - 1 === index || moveFolder.isPending}
                        aria-label={t('documents.folder.move_down')}
                        onClick={() =>
                          moveFolder.mutate({ folderId: folder.id, direction: 'down' })
                        }
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                      <FolderEditor
                        mode="edit"
                        folder={folder}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-primary size-9"
                            aria-label={`${t('documents.folder.edit')}: ${folder.name}`}
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                        }
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {folders.map((folder) => (
                    <Link key={folder.id} href={`/documents/${folder.id}`} className="block">
                      <Card className="flex h-full flex-col gap-3 p-4 transition-transform active:scale-[0.98]">
                        <FolderIconBadge icon={folder.icon} />
                        <div className="flex min-w-0 flex-col">
                          <span className="text-foreground truncate text-base font-semibold">
                            {folder.name}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {0 === folder.documentCount
                              ? t('documents.count_zero')
                              : t('documents.count', { count: folder.documentCount })}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </MainLayout>
      <DocumentViewer document={viewing} onClose={() => setViewing(null)} />
    </>
  );
};

DocumentsPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default DocumentsPage;
