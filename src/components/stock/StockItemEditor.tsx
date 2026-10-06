import { Trash2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { MAX_SHOPPING_ITEM_NAME_LENGTH } from '~/lib/shopping';
import {
  MAX_STOCK_NOTE_LENGTH,
  STOCK_SECTIONS,
  type StockSection,
  isStockSection,
} from '~/lib/stock';
import { type RouterOutputs, api } from '~/utils/api';

export type StockItem = RouterOutputs['stock']['getList'][number];

/** Panel para editar un producto. Cambiar "Dónde va" lo deja aprendido para la próxima. */
export const StockItemEditor: React.FC<{
  groupId: number;
  item: StockItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (item: StockItem) => void;
}> = ({ groupId, item, open, onOpenChange, onRemove }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note ?? '');
  const [section, setSection] = useState<StockSection>(item.section);

  useEffect(() => {
    if (open) {
      setName(item.name);
      setNote(item.note ?? '');
      setSection(item.section);
    }
  }, [open, item.name, item.note, item.section]);

  const updateItem = api.stock.updateItem.useMutation({
    onSuccess: () => void utils.stock.getList.invalidate({ groupId }),
    onError: (error) =>
      toast.error(
        'CONFLICT' === error.data?.code ? t('stock.toast.conflict') : t('stock.toast.error'),
      ),
  });

  const onSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    updateItem.mutate({
      groupId,
      id: item.id,
      name: trimmed === item.name ? undefined : trimmed,
      note: note.trim() === (item.note ?? '') ? undefined : note,
      section: section === item.section ? undefined : section,
    });
  }, [groupId, item, name, note, section, updateItem]);

  const onSectionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isStockSection(e.target.value)) {
      setSection(e.target.value);
    }
  }, []);

  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('stock.edit.title')}
      actionTitle={t('stock.actions.save')}
      actionOnClick={onSave}
      actionDisabled={!name.trim() || updateItem.isPending}
      shouldCloseOnAction
      className="h-auto"
      trigger={null}
    >
      <div className="flex flex-col gap-4 px-1 pb-4 text-left">
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('stock.edit.name')}</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_SHOPPING_ITEM_NAME_LENGTH}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('stock.edit.note')}</span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('stock.edit.note_placeholder')}
            maxLength={MAX_STOCK_NOTE_LENGTH}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">{t('stock.edit.section')}</span>
          <NativeSelect value={section} onChange={onSectionChange} className="w-full">
            {STOCK_SECTIONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`stock.sections.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <Button
          variant="ghost"
          className="text-destructive justify-start gap-2 px-0"
          onClick={() => {
            onOpenChange(false);
            onRemove(item);
          }}
        >
          <Trash2 className="size-4" />
          {t('stock.actions.remove')}
        </Button>
      </div>
    </AppDrawer>
  );
};
