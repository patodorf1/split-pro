import { PencilIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import {
  MAX_QUICK_FIELD_LENGTH,
  QUICK_FIELD_KEYS,
  type QuickFieldKey,
  type QuickFields,
  quickFieldPreview,
} from '~/lib/documentQuickFields';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';
import { copyText } from '~/utils/clipboard';

const EMPTY_DRAFT: Record<QuickFieldKey, string> = {
  dni: '',
  pasaporte: '',
  obraSocial: '',
  nacimiento: '',
};

interface QuickFieldsRowProps {
  folderId: number;
  folderName: string;
  quickFields: QuickFields;
}

/**
 * Datos rápidos de una sección persona: cuatro botones (DNI, Pasaporte, OS, Nacimiento) en dos
 * filas, que copian el valor al tocarlos, y un lápiz al costado para cargar, cambiar o borrar los
 * datos. Un botón sin valor se ve apagado con un "+" y abre la edición. Van de a dos por fila para
 * que la letra sea grande: en una sola fila "Nacimiento" se corta en 375px.
 */
export const QuickFieldsRow: React.FC<QuickFieldsRowProps> = ({
  folderId,
  folderName,
  quickFields,
}) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY_DRAFT, ...quickFields });
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
  }, [open]);

  const save = api.documents.updateQuickFields.useMutation({
    onSuccess: (result) => {
      // Se escribe en el cache (que además se persiste): los botones se actualizan ya, sin esperar
      // La recarga.
      utils.documents.getFolder.setData({ folderId }, (previous) =>
        previous
          ? { ...previous, folder: { ...previous.folder, quickFields: result.quickFields } }
          : previous,
      );
      utils.documents.overview.setData(undefined, (previous) =>
        previous
          ? {
              ...previous,
              folders: previous.folders.map((folder) =>
                folder.id === folderId ? { ...folder, quickFields: result.quickFields } : folder,
              ),
            }
          : previous,
      );
      void utils.documents.getFolder.invalidate({ folderId });
      void utils.documents.overview.invalidate();
      setOpen(false);
      toast.success(t('documents.quick.saved'));
    },
    onError: () => toast.error(t('documents.errors.generic')),
  });

  const onSave = useCallback(() => {
    save.mutate({ folderId, fields: draft });
  }, [draft, folderId, save]);

  const onChipClick = useCallback(
    async (key: QuickFieldKey) => {
      const value = quickFields[key];

      if (!value) {
        setOpen(true);
        return;
      }

      if (await copyText(value)) {
        toast.success(t(`documents.quick.copied.${key}`), { duration: 1500 });
      } else {
        toast.error(t('documents.quick.copy_failed'));
      }
    },
    [quickFields, t],
  );

  return (
    <div className="flex items-stretch gap-1" data-testid="quick-fields-row">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
        {QUICK_FIELD_KEYS.map((key) => {
          const value = quickFields[key];
          const label = t(`documents.quick.labels.${key}`);
          const fullLabel = t(`documents.quick.fields.${key}`);
          const preview = quickFieldPreview(value);

          return (
            <button
              key={key}
              type="button"
              onClick={() => void onChipClick(key)}
              aria-label={
                value
                  ? `${t('documents.quick.copy', { label: fullLabel })}: ${value}`
                  : t('documents.quick.missing', { label: fullLabel })
              }
              className={cn(
                'relative flex h-14 min-w-0 flex-col items-center justify-center rounded-xl px-2 leading-tight transition-colors active:scale-[0.97]',
                value
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted-foreground border-border border border-dashed opacity-70',
              )}
            >
              {/* El "+" va en la esquina, como marca de "falta cargar". */}
              {value ? null : (
                <PlusIcon
                  className="absolute top-1.5 right-1.5 size-3"
                  strokeWidth={3}
                  aria-hidden
                />
              )}
              <span className="max-w-full truncate text-[15px] font-semibold">{label}</span>
              {preview ? (
                <span className="text-muted-foreground max-w-full truncate text-sm tabular-nums">
                  {preview}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <AppDrawer
        open={open}
        onOpenChange={setOpen}
        title={t('documents.quick.title', { name: folderName })}
        actionTitle={t('documents.actions.save')}
        actionOnClick={onSave}
        actionDisabled={save.isPending}
        className="h-auto"
        trigger={
          <button
            type="button"
            aria-label={t('documents.quick.edit')}
            className="text-primary hover:bg-primary-soft flex w-9 shrink-0 items-center justify-center self-stretch rounded-xl"
          >
            <PencilIcon className="size-5" />
          </button>
        }
      >
        <form
          className="flex flex-col gap-4 px-1 pb-4 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          {QUICK_FIELD_KEYS.map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="section-label">{t(`documents.quick.fields.${key}`)}</span>
              <Input
                value={draft[key]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [key]: event.target.value }))
                }
                maxLength={MAX_QUICK_FIELD_LENGTH}
                autoComplete="off"
                placeholder={
                  'nacimiento' === key ? t('documents.quick.nacimiento_placeholder') : undefined
                }
              />
            </label>
          ))}
          <p className="text-muted-foreground text-xs">{t('documents.quick.hint')}</p>
          {/* Enter en el teclado guarda. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </AppDrawer>
    </div>
  );
};
