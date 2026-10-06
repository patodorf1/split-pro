import { Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { api } from '~/utils/api';

/** Campo de carga del Stock: como el de Compras, varios separados por coma. */
export const AddStockItem: React.FC<{ groupId: number }> = ({ groupId }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [text, setText] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  const addItems = api.stock.addItems.useMutation({
    onSuccess: ({ created, duplicates }) => {
      if (0 < created.length) {
        toast.success(t('stock.toast.added', { count: created.length }));
      }
      if (0 < duplicates.length) {
        toast(
          t('stock.toast.already_there', { names: duplicates.map((item) => item.name).join(', ') }),
        );
      }
      void utils.stock.getList.invalidate({ groupId });
    },
    onError: () => toast.error(t('stock.toast.error')),
  });

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      setText('');
      addItems.mutate({ groupId, text: trimmed });
      formRef.current?.querySelector('input')?.focus();
    },
    [addItems, groupId, text],
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex items-center gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('stock.add_placeholder')}
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="sentences"
        className="h-12 text-base"
      />
      <Button
        type="submit"
        size="icon"
        className="size-12 shrink-0 rounded-full"
        disabled={!text.trim()}
        aria-label={t('stock.actions.add')}
      >
        <Plus className="size-6" />
      </Button>
    </form>
  );
};
