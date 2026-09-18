import { Plus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { normalizeShoppingItemName } from '~/lib/shopping';
import { api } from '~/utils/api';

const SUGGESTION_DEBOUNCE_MS = 200;
const MIN_SUGGESTION_LENGTH = 2;

/**
 * Campo de carga: siempre arriba, acepta varios ítems separados por coma y deja el foco puesto
 * para seguir cargando sin volver a tocar la pantalla.
 */
export const AddShoppingItem: React.FC<{ groupId: number; pendingNames: string[] }> = ({
  groupId,
  pendingNames,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  /**
   * El `Input` compartido no reenvía ref, así que buscamos el campo desde el form para poder
   * devolverle el foco después de agregar y seguir cargando de corrido.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const focusInput = useCallback(() => formRef.current?.querySelector('input')?.focus(), []);
  const utils = api.useUtils();

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedText(text.trim()), SUGGESTION_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [text]);

  const addItems = api.shopping.addItems.useMutation({
    onSuccess: ({ created, duplicates }) => {
      if (0 < created.length) {
        toast.success(t('shopping.toast.added', { count: created.length }));
      }
      if (0 < duplicates.length) {
        toast(
          t('shopping.toast.already_there', {
            names: duplicates.map((item) => item.name).join(', '),
          }),
        );
      }
      void utils.shopping.getList.invalidate({ groupId });
      void utils.shopping.suggestions.invalidate({ groupId });
    },
    onError: () => toast.error(t('shopping.toast.error')),
  });

  const suggestionsQuery = api.shopping.suggestions.useQuery(
    { groupId, query: debouncedText, limit: 6 },
    {
      enabled: MIN_SUGGESTION_LENGTH <= debouncedText.length && !debouncedText.includes(','),
      staleTime: 60_000,
    },
  );

  const pendingKeys = useMemo(
    () => new Set(pendingNames.map(normalizeShoppingItemName)),
    [pendingNames],
  );

  const suggestions = useMemo(() => {
    const typedKey = normalizeShoppingItemName(debouncedText);

    return (suggestionsQuery.data ?? []).filter((suggestion) => {
      const key = normalizeShoppingItemName(suggestion.name);

      return key !== typedKey && !pendingKeys.has(key);
    });
  }, [debouncedText, pendingKeys, suggestionsQuery.data]);

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();

      if (!trimmed) {
        return;
      }

      setText('');
      setDebouncedText('');
      addItems.mutate({ groupId, text: trimmed });
      focusInput();
    },
    [addItems, focusInput, groupId],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submit(text);
    },
    [submit, text],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    [],
  );

  return (
    <div className="flex flex-col gap-2">
      <form ref={formRef} onSubmit={onSubmit} className="flex items-center gap-2">
        <Input
          value={text}
          onChange={onChange}
          placeholder={t('shopping.add_placeholder')}
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
          aria-label={t('shopping.actions.add')}
        >
          <Plus className="size-6" />
        </Button>
      </form>

      {0 < suggestions.length ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {suggestions.map((suggestion) => (
            <SuggestionChip key={suggestion.name} name={suggestion.name} onPick={submit} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const SuggestionChip: React.FC<{ name: string; onPick: (name: string) => void }> = ({
  name,
  onPick,
}) => {
  const onClick = useCallback(() => onPick(name), [name, onPick]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border text-muted-foreground hover:text-foreground shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors"
    >
      {name}
    </button>
  );
};
