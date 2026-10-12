import { Check, MoreVertical, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { Button } from '~/components/ui/button';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { MAX_TODO_TITLE_LENGTH } from '~/lib/todo';
import { cn } from '~/lib/utils';
import { type RouterOutputs } from '~/utils/api';

export type TodoItem = RouterOutputs['todo']['getList']['pending'][number];

/** Nombre corto: alcanza con el primer nombre para saber quién la anotó o la hizo. */
const shortName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Una tarea: el círculo la tilda, los tres puntos la editan o la borran. */
export const TodoItemRow: React.FC<{
  item: TodoItem;
  currentUserId: number;
  onToggle: (item: TodoItem) => void;
  onRename: (item: TodoItem, title: string) => void;
  onDelete: (item: TodoItem) => void;
}> = ({ item, currentUserId, onToggle, onRename, onDelete }) => {
  const { t, displayName } = useTranslationWithUtils();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(item.title);

  useEffect(() => {
    if (open) {
      setTitle(item.title);
    }
  }, [open, item.title]);

  const toggle = useCallback(() => onToggle(item), [item, onToggle]);
  const save = useCallback(() => onRename(item, title.trim()), [item, onRename, title]);
  const remove = useCallback(() => {
    setOpen(false);
    onDelete(item);
  }, [item, onDelete]);
  const onTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value),
    [],
  );

  const person = item.done ? item.doneByUser : item.addedByUser;
  const author = person ? shortName(displayName(person, currentUserId)) : null;

  return (
    <li className="flex items-center gap-3 py-1">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={item.done}
        aria-label={item.title}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 active:scale-90',
          item.done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-transparent',
        )}
      >
        <Check className="size-5" strokeWidth={3} />
      </button>

      <button type="button" onClick={toggle} className="min-w-0 flex-1 py-2 text-left">
        <p
          className={cn(
            'text-base break-words transition-all duration-200',
            item.done && 'text-muted-foreground line-through',
          )}
        >
          {item.title}
        </p>
      </button>

      {author ? (
        <span className="text-muted-foreground shrink-0 text-[11px] tracking-wide uppercase">
          {author}
        </span>
      ) : null}

      <AppDrawer
        open={open}
        onOpenChange={setOpen}
        title={t('todo.edit.title')}
        actionTitle={t('todo.actions.save')}
        actionOnClick={save}
        actionDisabled={!title.trim()}
        shouldCloseOnAction
        className="h-auto"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-9 shrink-0"
            aria-label={t('todo.edit.title')}
          >
            <MoreVertical className="size-5" />
          </Button>
        }
      >
        <div className="flex flex-col gap-4 px-1 pb-4 text-left">
          <label className="flex flex-col gap-1">
            <span className="section-label">{t('todo.edit.task')}</span>
            <Input value={title} onChange={onTitleChange} maxLength={MAX_TODO_TITLE_LENGTH} />
          </label>
          <Button
            variant="ghost"
            className="text-destructive justify-start gap-2 px-0"
            onClick={remove}
          >
            <Trash2 className="size-4" />
            {t('todo.actions.delete')}
          </Button>
        </div>
      </AppDrawer>
    </li>
  );
};
