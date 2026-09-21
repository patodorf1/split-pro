import { Trash2Icon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import {
  DOCUMENT_FOLDER_ICONS,
  type DocumentFolderIconKey,
  MAX_FOLDER_NAME_LENGTH,
  isDocumentFolderIcon,
} from '~/lib/documents';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { afterOverlayClosed } from './documentClient';
import { FOLDER_ICON_COMPONENTS } from './icons';

interface EditableFolder {
  id: number;
  name: string;
  icon: string;
  documentCount: number;
}

type FolderEditorProps = {
  trigger: React.ReactNode;
  /** Se llama después de borrar la sección (por ejemplo para salir de su pantalla). */
  onDeleted?: () => void;
} & (
  | { mode: 'create'; groups: { id: number; name: string }[]; defaultGroupId: number | null }
  | { mode: 'edit'; folder: EditableFolder }
);

/**
 * Alta y edición de una sección: nombre + ícono de una lista corta. En edición también se puede
 * borrar, sólo si está vacía (el servidor lo vuelve a chequear).
 */
export const FolderEditor: React.FC<FolderEditorProps> = (props) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<DocumentFolderIconKey>('folder');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editing = 'edit' === props.mode ? props.folder : null;

  useEffect(() => {
    if (!open) {
      return;
    }

    setConfirmDelete(false);

    if ('edit' === props.mode) {
      setName(props.folder.name);
      setIcon(isDocumentFolderIcon(props.folder.icon) ? props.folder.icon : 'folder');
    } else {
      setName('');
      setIcon('folder');
      setGroupId(props.defaultGroupId ?? props.groups[0]?.id ?? null);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
  }, [open]);

  // Refresca cuando el drawer/diálogo ya cerró: si no, al borrar la sección la fila se desmonta
  // Con el overlay abierto y la pantalla queda bloqueada (ver `afterOverlayClosed`).
  const invalidate = useCallback(
    (then?: () => void) => {
      afterOverlayClosed(() => {
        void utils.documents.overview.invalidate();
        void utils.documents.getFolder.invalidate();
        then?.();
      });
    },
    [utils],
  );

  const onError = useCallback(
    (error: { message: string }) =>
      toast.error(
        'folder_exists' === error.message
          ? t('documents.folder.exists')
          : 'folder_not_empty' === error.message
            ? t('documents.folder.delete_blocked')
            : t('documents.errors.generic'),
      ),
    [t],
  );

  const create = api.documents.createFolder.useMutation({
    onSuccess: () => {
      setOpen(false);
      invalidate();
    },
    onError,
  });
  const update = api.documents.updateFolder.useMutation({
    onSuccess: () => {
      setOpen(false);
      invalidate();
    },
    onError,
  });
  const remove = api.documents.deleteFolder.useMutation({
    onSuccess: () => {
      setOpen(false);
      invalidate(props.onDeleted);
    },
    onError,
  });

  const trimmed = name.trim();
  const pending = create.isPending || update.isPending;

  const onSave = useCallback(() => {
    if (!trimmed) {
      return;
    }

    if (editing) {
      update.mutate({ folderId: editing.id, name: trimmed, icon });
    } else if (null !== groupId) {
      create.mutate({ groupId, name: trimmed, icon });
    }
  }, [create, editing, groupId, icon, trimmed, update]);

  return (
    <>
      <AppDrawer
        open={open}
        onOpenChange={setOpen}
        title={editing ? t('documents.folder.edit') : t('documents.folder.create')}
        actionTitle={editing ? t('documents.actions.save') : t('documents.actions.create')}
        actionOnClick={onSave}
        actionDisabled={!trimmed || pending || (!editing && null === groupId)}
        className="h-auto"
        trigger={props.trigger}
      >
        <form
          className="flex flex-col gap-4 px-1 pb-4 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          {'create' === props.mode && 1 < props.groups.length && null === props.defaultGroupId ? (
            <label className="flex flex-col gap-1">
              <span className="section-label">{t('documents.folder.group')}</span>
              <NativeSelect
                value={groupId ?? ''}
                onChange={(event) => setGroupId(Number(event.target.value))}
              >
                {props.groups.map((group) => (
                  <NativeSelectOption key={group.id} value={group.id}>
                    {group.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="section-label">{t('documents.folder.name')}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              placeholder={t('documents.folder.name_placeholder')}
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="section-label mb-2">{t('documents.folder.icon')}</legend>
            <div className="grid grid-cols-8 gap-2">
              {DOCUMENT_FOLDER_ICONS.map((key) => {
                const Icon = FOLDER_ICON_COMPONENTS[key];
                const selected = key === icon;

                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    aria-pressed={selected}
                    onClick={() => setIcon(key)}
                    className={cn(
                      'flex aspect-square items-center justify-center rounded-full border transition-colors',
                      selected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-primary-soft text-primary border-transparent',
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          </fieldset>

          {editing && !confirmDelete ? (
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                className="text-destructive justify-start gap-2 px-0"
                disabled={0 < editing.documentCount || remove.isPending}
                // La confirmación va dentro del mismo drawer: un diálogo encima del drawer deja
                // El <body> con pointer-events: none al cerrarse.
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon className="size-4" />
                {t('documents.folder.delete')}
              </Button>
              {0 < editing.documentCount ? (
                <p className="text-muted-foreground text-xs">
                  {t('documents.folder.delete_blocked')}
                </p>
              ) : null}
            </div>
          ) : null}

          {editing && confirmDelete ? (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                {t('documents.folder.delete_confirm', { name: editing.name })}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t('documents.actions.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="flex-1"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ folderId: editing.id })}
                >
                  {t('documents.folder.delete')}
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      </AppDrawer>
    </>
  );
};
