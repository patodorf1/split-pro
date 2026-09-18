import { MoreVertical, Trash2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import {
  MAX_SHOPPING_ITEM_NAME_LENGTH,
  MAX_SHOPPING_ITEM_NOTE_LENGTH,
  MAX_SHOPPING_ITEM_QUANTITY_LENGTH,
} from '~/lib/shopping';
import { api } from '~/utils/api';

import { type ShoppingItem } from './ShoppingItemRow';

/** Menú por ítem: editar nombre, cantidad y nota, o borrarlo. */
export const ShoppingItemActions: React.FC<{ groupId: number; item: ShoppingItem }> = ({
  groupId,
  item,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity ?? '');
  const [note, setNote] = useState(item.note ?? '');

  const utils = api.useUtils();

  const invalidate = useCallback(
    () => utils.shopping.getList.invalidate({ groupId }),
    [groupId, utils],
  );

  const onError = useCallback(() => toast.error(t('shopping.toast.error')), [t]);

  const updateItem = api.shopping.updateItem.useMutation({ onSuccess: invalidate, onError });
  const deleteItem = api.shopping.deleteItem.useMutation({ onSuccess: invalidate, onError });

  useEffect(() => {
    if (open) {
      setName(item.name);
      setQuantity(item.quantity ?? '');
      setNote(item.note ?? '');
    }
  }, [open, item.name, item.quantity, item.note]);

  const onSave = useCallback(() => {
    const trimmed = name.trim();

    if (!trimmed) {
      return;
    }

    updateItem.mutate({ groupId, id: item.id, name: trimmed, quantity, note });
  }, [groupId, item.id, name, note, quantity, updateItem]);

  const onDelete = useCallback(() => {
    setOpen(false);
    deleteItem.mutate({ groupId, id: item.id });
  }, [deleteItem, groupId, item.id]);

  const onNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
    [],
  );
  const onQuantityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setQuantity(e.target.value),
    [],
  );
  const onNoteChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value),
    [],
  );

  return (
    <AppDrawer
      open={open}
      onOpenChange={setOpen}
      title={t('shopping.edit.title')}
      actionTitle={t('shopping.actions.save')}
      actionOnClick={onSave}
      actionDisabled={!name.trim() || updateItem.isPending}
      shouldCloseOnAction
      className="h-auto"
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-9 shrink-0"
          aria-label={t('shopping.edit.title')}
        >
          <MoreVertical className="size-5" />
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-1 pb-4 text-left">
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('shopping.edit.name')}</span>
          <Input value={name} onChange={onNameChange} maxLength={MAX_SHOPPING_ITEM_NAME_LENGTH} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('shopping.edit.quantity')}</span>
          <Input
            value={quantity}
            onChange={onQuantityChange}
            placeholder={t('shopping.edit.quantity_placeholder')}
            maxLength={MAX_SHOPPING_ITEM_QUANTITY_LENGTH}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('shopping.edit.note')}</span>
          <Input
            value={note}
            onChange={onNoteChange}
            placeholder={t('shopping.edit.note_placeholder')}
            maxLength={MAX_SHOPPING_ITEM_NOTE_LENGTH}
          />
        </label>

        <Button
          variant="ghost"
          className="text-destructive justify-start gap-2 px-0"
          onClick={onDelete}
          disabled={deleteItem.isPending}
        >
          <Trash2 className="size-4" />
          {t('shopping.actions.delete')}
        </Button>
      </div>
    </AppDrawer>
  );
};
