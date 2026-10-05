import { Trash2Icon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { SegmentedControl } from '~/components/dashboard/SegmentedControl';
import { afterOverlayClosed } from '~/components/documents/documentClient';
import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { Switch } from '~/components/ui/switch';
import {
  EVENT_REPEATS,
  type EventRepeat,
  MAX_EVENT_NOTE_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
  TIME_PATTERN,
  parseDay,
} from '~/lib/agenda';
import { api } from '~/utils/api';

/** Lo que el editor necesita de un evento guardado. */
export interface EditableEvent {
  eventId: number;
  title: string;
  /** Fecha de inicio guardada (no la de la repetición que se tocó). */
  startDate: string;
  time: string | null;
  note: string | null;
  repeat: EventRepeat;
}

type EventEditorProps = {
  trigger: React.ReactNode;
} & (
  | {
      mode: 'create';
      groups: { id: number; name: string }[];
      defaultGroupId: number | null;
      /** Día precargado ("AAAA-MM-DD"): el que estaba seleccionado en la grilla. */
      initialDate: string;
    }
  | { mode: 'edit'; event: EditableEvent }
);

/** 16px en todos los tamaños: en iPhone un input más chico hace zoom al enfocarlo. */
const INPUT_CLASSES = 'text-base md:text-base';

const DEFAULT_TIME = '09:00';

/**
 * Alta y edición de un evento de la Agenda en una hoja desde abajo: qué, fecha, hora (o todo el
 * día), repetición y nota. En edición también se puede borrar, con confirmación dentro de la
 * misma hoja. Editar o borrar un evento repetido afecta a todas sus repeticiones.
 */
export const EventEditor: React.FC<EventEditorProps> = (props) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [repeat, setRepeat] = useState<EventRepeat>('NONE');
  const [note, setNote] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editing = 'edit' === props.mode ? props.event : null;

  useEffect(() => {
    if (!open) {
      return;
    }

    setConfirmDelete(false);

    if ('edit' === props.mode) {
      setTitle(props.event.title);
      setDate(props.event.startDate);
      setAllDay(null === props.event.time);
      setTime(props.event.time ?? DEFAULT_TIME);
      setRepeat(props.event.repeat);
      setNote(props.event.note ?? '');
    } else {
      setTitle('');
      setDate(props.initialDate);
      setAllDay(true);
      setTime(DEFAULT_TIME);
      setRepeat('NONE');
      setNote('');
      setGroupId(props.defaultGroupId ?? props.groups[0]?.id ?? null);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
  }, [open]);

  // Refresca cuando la hoja ya cerró (ver `afterOverlayClosed`): si la fila se desmonta con el
  // Overlay abierto, la pantalla queda bloqueada.
  const invalidate = useCallback(() => {
    afterOverlayClosed(() => {
      void utils.calendar.range.invalidate();
      void utils.calendar.groups.invalidate();
    });
  }, [utils]);

  const onSuccess = useCallback(() => {
    setOpen(false);
    invalidate();
  }, [invalidate]);

  const onError = useCallback(() => toast.error(t('agenda.errors.generic')), [t]);

  const create = api.calendar.create.useMutation({ onSuccess, onError });
  const update = api.calendar.update.useMutation({ onSuccess, onError });
  const remove = api.calendar.delete.useMutation({ onSuccess, onError });

  const repeatOptions = useMemo(
    () =>
      EVENT_REPEATS.map((value) => ({
        value,
        label: t(`agenda.repeat_short.${value}`),
        title: t(`agenda.repeat.${value}`),
      })),
    [t],
  );

  const trimmedTitle = title.trim();
  const dateValid = null !== parseDay(date);
  const timeValid = allDay || TIME_PATTERN.test(time);
  const pending = create.isPending || update.isPending;
  const canSave =
    0 < trimmedTitle.length &&
    dateValid &&
    timeValid &&
    !pending &&
    (null !== editing || null !== groupId);

  const onSave = useCallback(() => {
    if (!canSave) {
      return;
    }

    const fields = { title: trimmedTitle, date, time: allDay ? null : time, note, repeat };

    if (editing) {
      update.mutate({ id: editing.eventId, ...fields });
    } else if (null !== groupId) {
      create.mutate({ groupId, ...fields });
    }
  }, [allDay, canSave, create, date, editing, groupId, note, repeat, time, trimmedTitle, update]);

  const showGroupPicker =
    'create' === props.mode && 1 < props.groups.length && null === props.defaultGroupId;
  const dayOfMonth = parseDay(date)?.day ?? 0;
  // Sólo hace falta explicar el "último día del mes" cuando puede pasar.
  const showRepeatHint =
    ('MONTHLY' === repeat && 28 < dayOfMonth) || ('YEARLY' === repeat && date.endsWith('-02-29'));

  return (
    <AppDrawer
      open={open}
      onOpenChange={setOpen}
      title={editing ? t('agenda.editor.edit') : t('agenda.editor.create')}
      actionTitle={editing ? t('agenda.actions.save') : t('agenda.actions.create')}
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
        {showGroupPicker && 'create' === props.mode ? (
          <label className="flex flex-col gap-1">
            <span className="section-label">{t('agenda.editor.group')}</span>
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
          <span className="section-label">{t('agenda.editor.title')}</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_EVENT_TITLE_LENGTH}
            placeholder={t('agenda.editor.title_placeholder')}
            autoComplete="off"
            className={INPUT_CLASSES}
          />
        </label>

        <div className="flex items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="section-label">{t('agenda.editor.date')}</span>
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
              aria-invalid={!dateValid}
              className={INPUT_CLASSES}
            />
          </label>
          {allDay ? null : (
            <label className="flex w-28 shrink-0 flex-col gap-1">
              <span className="section-label">{t('agenda.editor.time')}</span>
              <Input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-invalid={!timeValid}
                className={INPUT_CLASSES}
              />
            </label>
          )}
        </div>

        <label className="flex items-center justify-between gap-3">
          <span className="text-foreground text-sm">{t('agenda.editor.all_day')}</span>
          <Switch checked={allDay} onCheckedChange={setAllDay} />
        </label>

        <div className="flex flex-col gap-2">
          <span className="section-label">{t('agenda.editor.repeat')}</span>
          <SegmentedControl
            options={repeatOptions}
            value={repeat}
            onChange={setRepeat}
            label={t('agenda.editor.repeat')}
            size="sm"
          />
          {showRepeatHint ? (
            <span className="text-muted-foreground text-xs">{t('agenda.editor.repeat_hint')}</span>
          ) : null}
        </div>

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('agenda.editor.note')}</span>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={MAX_EVENT_NOTE_LENGTH}
            placeholder={t('agenda.editor.note_placeholder')}
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
            {t('agenda.editor.delete')}
          </Button>
        ) : null}

        {editing && confirmDelete ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {'NONE' === editing.repeat
                ? t('agenda.editor.delete_confirm', { title: editing.title })
                : t('agenda.editor.delete_confirm_repeat', { title: editing.title })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirmDelete(false)}
              >
                {t('agenda.actions.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: editing.eventId })}
              >
                {t('agenda.editor.delete')}
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </AppDrawer>
  );
};
