import { Trash2Icon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { afterOverlayClosed } from '~/components/documents/documentClient';
import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import {
  EMERGENCY_PHONE_PATTERN,
  MAX_EMERGENCY_NAME_LENGTH,
  MAX_EMERGENCY_NOTE_LENGTH,
  MAX_EMERGENCY_PHONE_LENGTH,
} from '~/lib/emergency';
import { api } from '~/utils/api';

export interface EmergencyContactItem {
  id: number;
  groupId: number;
  name: string;
  phone: string;
  whatsapp: string | null;
  note: string | null;
}

type ContactEditorProps = {
  trigger: React.ReactNode;
} & (
  | { mode: 'create'; groups: { id: number; name: string }[]; defaultGroupId: number | null }
  | { mode: 'edit'; contact: EmergencyContactItem }
);

/** 16px en todos los tamaños: en iPhone un input más chico hace zoom al enfocarlo. */
const INPUT_CLASSES = 'text-base md:text-base';

/**
 * Alta y edición de un contacto de emergencia en una hoja desde abajo: nombre, teléfono,
 * WhatsApp (opcional) y nota (opcional). En edición también se puede borrar, con confirmación
 * dentro de la misma hoja.
 */
export const ContactEditor: React.FC<ContactEditorProps> = (props) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [note, setNote] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editing = 'edit' === props.mode ? props.contact : null;

  useEffect(() => {
    if (!open) {
      return;
    }

    setConfirmDelete(false);

    if ('edit' === props.mode) {
      setName(props.contact.name);
      setPhone(props.contact.phone);
      setWhatsapp(props.contact.whatsapp ?? '');
      setNote(props.contact.note ?? '');
    } else {
      setName('');
      setPhone('');
      setWhatsapp('');
      setNote('');
      setGroupId(props.defaultGroupId ?? props.groups[0]?.id ?? null);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
  }, [open]);

  // Refresca cuando la hoja ya cerró (ver `afterOverlayClosed`): si la tarjeta se desmonta con
  // El overlay abierto, la pantalla queda bloqueada.
  const invalidate = useCallback(() => {
    afterOverlayClosed(() => {
      void utils.emergency.list.invalidate();
    });
  }, [utils]);

  const onSuccess = useCallback(() => {
    setOpen(false);
    invalidate();
  }, [invalidate]);

  const onError = useCallback(() => toast.error(t('emergency.errors.generic')), [t]);

  const create = api.emergency.create.useMutation({ onSuccess, onError });
  const update = api.emergency.update.useMutation({ onSuccess, onError });
  const remove = api.emergency.delete.useMutation({ onSuccess, onError });

  const trimmedName = name.trim();
  const phoneValid = EMERGENCY_PHONE_PATTERN.test(phone);
  const whatsappValid = EMERGENCY_PHONE_PATTERN.test(whatsapp);
  const pending = create.isPending || update.isPending;
  const canSave =
    0 < trimmedName.length &&
    phoneValid &&
    whatsappValid &&
    !pending &&
    (null !== editing || null !== groupId);

  const onSave = useCallback(() => {
    if (!canSave) {
      return;
    }

    const fields = { name: trimmedName, phone, whatsapp, note };

    if (editing) {
      update.mutate({ id: editing.id, ...fields });
    } else if (null !== groupId) {
      create.mutate({ groupId, ...fields });
    }
  }, [canSave, create, editing, groupId, note, phone, trimmedName, update, whatsapp]);

  return (
    <AppDrawer
      open={open}
      onOpenChange={setOpen}
      title={editing ? t('emergency.editor.edit') : t('emergency.editor.create')}
      actionTitle={editing ? t('emergency.actions.save') : t('emergency.actions.create')}
      actionOnClick={onSave}
      actionDisabled={!canSave}
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
            <span className="section-label">{t('emergency.editor.group')}</span>
            <NativeSelect
              value={groupId ?? ''}
              onChange={(event) => setGroupId(Number(event.target.value))}
              className={INPUT_CLASSES}
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
          <span className="section-label">{t('emergency.editor.name')}</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_EMERGENCY_NAME_LENGTH}
            placeholder={t('emergency.editor.name_placeholder')}
            autoComplete="off"
            className={INPUT_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('emergency.editor.phone')}</span>
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={MAX_EMERGENCY_PHONE_LENGTH}
            placeholder={t('emergency.editor.phone_placeholder')}
            autoComplete="off"
            aria-invalid={!phoneValid}
            className={INPUT_CLASSES}
          />
          {phoneValid ? null : (
            <span className="text-destructive text-xs">{t('emergency.editor.invalid_phone')}</span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('emergency.editor.whatsapp')}</span>
          <Input
            type="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={(event) => setWhatsapp(event.target.value)}
            maxLength={MAX_EMERGENCY_PHONE_LENGTH}
            placeholder={t('emergency.editor.whatsapp_placeholder')}
            autoComplete="off"
            aria-invalid={!whatsappValid}
            className={INPUT_CLASSES}
          />
          {whatsappValid ? null : (
            <span className="text-destructive text-xs">{t('emergency.editor.invalid_phone')}</span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('emergency.editor.note')}</span>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={MAX_EMERGENCY_NOTE_LENGTH}
            placeholder={t('emergency.editor.note_placeholder')}
            autoComplete="off"
            className={INPUT_CLASSES}
          />
        </label>

        {/* Enter en el teclado guarda. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />

        {editing && !confirmDelete ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive justify-start gap-2 px-0"
            disabled={remove.isPending}
            // La confirmación va dentro de la misma hoja: un diálogo encima deja el <body> con
            // Pointer-events: none al cerrarse.
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2Icon className="size-4" />
            {t('emergency.editor.delete')}
          </Button>
        ) : null}

        {editing && confirmDelete ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {t('emergency.editor.delete_confirm', { name: editing.name })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirmDelete(false)}
              >
                {t('emergency.actions.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: editing.id })}
              >
                {t('emergency.editor.delete')}
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </AppDrawer>
  );
};
