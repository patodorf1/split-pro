import { ListTodo, Plus, Trash2 } from 'lucide-react';
import Head from 'next/head';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import MainLayout from '~/components/Layout/MainLayout';
import { SimpleConfirmationDialog } from '~/components/SimpleConfirmationDialog';
import { type TodoItem, TodoItemRow } from '~/components/todo/TodoItemRow';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

/** Mismo ritmo que Compras: así lo que anota Belu aparece solo. */
const POLL_INTERVAL_MS = 10_000;

/** To Do de la casa: cosas para hacer, compartidas entre los dos. */
const TodoPage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const utils = api.useUtils();
  const [text, setText] = useState('');
  /** El `Input` compartido no reenvía ref: el foco se busca desde el form. */
  const formRef = useRef<HTMLFormElement>(null);

  const groupsQuery = api.group.getAllGroups.useQuery();

  /*
   * Una sola lista, la de la casa: el grupo marcado para cargar gastos (Casa), o el fijado, o el
   * primero. Igual que Cocina, para que todo lo que se anota vaya al mismo lugar.
   */
  const groupId = useMemo(() => {
    const groups = (groupsQuery.data ?? []).filter(({ group }) => !group.archivedAt);
    const preferred =
      groups.find((entry) => entry.defaultForAdd) ??
      groups.find((entry) => entry.pinned) ??
      groups[0];

    return preferred?.group.id ?? null;
  }, [groupsQuery.data]);

  const listQuery = api.todo.getList.useQuery(
    { groupId: groupId ?? 0 },
    { enabled: null !== groupId, refetchOnWindowFocus: true, refetchInterval: POLL_INTERVAL_MS },
  );

  const refresh = useCallback(() => {
    if (null !== groupId) {
      void utils.todo.getList.invalidate({ groupId });
    }
  }, [groupId, utils]);

  const onError = useCallback(() => toast.error(t('todo.toast.error')), [t]);

  const add = api.todo.add.useMutation({
    onSuccess: ({ created }) => {
      toast.success(t('todo.toast.added', { count: created.length }));
      refresh();
    },
    onError,
  });

  const setDone = api.todo.setDone.useMutation({
    // Update optimista: el tilde tiene que sentirse instantáneo.
    onMutate: async ({ groupId: input, id, done }) => {
      await utils.todo.getList.cancel({ groupId: input });
      const previous = utils.todo.getList.getData({ groupId: input });

      utils.todo.getList.setData({ groupId: input }, (old) => {
        const item = old && (done ? old.pending : old.done).find((entry) => entry.id === id);

        if (!old || !item) {
          return old;
        }

        const moved: TodoItem = {
          ...item,
          done,
          doneAt: done ? new Date() : null,
          doneByUser: done
            ? {
                id: user.id,
                name: user.name ?? null,
                email: user.email ?? null,
                image: user.image ?? null,
              }
            : null,
        };

        return done
          ? {
              pending: old.pending.filter((entry) => entry.id !== id),
              done: [moved, ...old.done],
              doneTotal: old.doneTotal + 1,
            }
          : {
              pending: [...old.pending, moved],
              done: old.done.filter((entry) => entry.id !== id),
              doneTotal: Math.max(0, old.doneTotal - 1),
            };
      });

      return { previous };
    },
    onError: (_error, { groupId: input }, context) => {
      if (context?.previous) {
        utils.todo.getList.setData({ groupId: input }, context.previous);
      }
      onError();
    },
    onSettled: refresh,
  });

  const update = api.todo.update.useMutation({ onSuccess: refresh, onError });
  const remove = api.todo.delete.useMutation({ onSuccess: refresh, onError });
  const clearDone = api.todo.clearDone.useMutation({
    onSuccess: ({ count }) => {
      toast.success(t('todo.toast.cleared', { count }));
      refresh();
    },
    onError,
  });

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();

      if (!trimmed || null === groupId) {
        return;
      }

      setText('');
      add.mutate({ groupId, text: trimmed });
      formRef.current?.querySelector('input')?.focus();
    },
    [add, groupId, text],
  );

  const onTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    [],
  );

  const onToggle = useCallback(
    (item: TodoItem) => {
      if (null !== groupId) {
        setDone.mutate({ groupId, id: item.id, done: !item.done });
      }
    },
    [groupId, setDone],
  );

  const onRename = useCallback(
    (item: TodoItem, title: string) => {
      if (null !== groupId && title && title !== item.title) {
        update.mutate({ groupId, id: item.id, title });
      }
    },
    [groupId, update],
  );

  const onDelete = useCallback(
    (item: TodoItem) => {
      if (null !== groupId) {
        remove.mutate({ groupId, id: item.id });
      }
    },
    [groupId, remove],
  );

  const onClearDone = useCallback(() => {
    if (null !== groupId) {
      clearDone.mutate({ groupId });
    }
  }, [clearDone, groupId]);

  const pending = listQuery.data?.pending ?? [];
  const done = listQuery.data?.done ?? [];
  const doneTotal = listQuery.data?.doneTotal ?? 0;

  const renderRow = (item: TodoItem) => (
    <TodoItemRow
      key={item.id}
      item={item}
      currentUserId={user.id}
      onToggle={onToggle}
      onRename={onRename}
      onDelete={onDelete}
    />
  );

  return (
    <>
      <Head>
        <title>{t('todo.title')}</title>
      </Head>
      <MainLayout title={t('todo.title')} loading={groupsQuery.isPending}>
        {null === groupId ? (
          <p className="text-muted-foreground mt-10 text-center text-sm">
            {t('shopping.empty.no_groups')}
          </p>
        ) : (
          <div className="flex flex-col gap-4 pb-36">
            <div className="bg-background sticky top-0 z-10 py-2">
              <form ref={formRef} onSubmit={onSubmit} className="flex items-center gap-2">
                <Input
                  value={text}
                  onChange={onTextChange}
                  placeholder={t('todo.add_placeholder')}
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
                  aria-label={t('todo.actions.add')}
                >
                  <Plus className="size-6" />
                </Button>
              </form>
            </div>

            {0 === pending.length && 0 === doneTotal && !listQuery.isPending ? (
              <div className="mt-16 flex flex-col items-center gap-3 text-center">
                <ListTodo className="text-primary size-10" />
                <p className="text-base font-medium">{t('todo.empty.title')}</p>
                <p className="text-muted-foreground max-w-[260px] text-sm">
                  {t('todo.empty.subtitle')}
                </p>
              </div>
            ) : null}

            {0 < pending.length ? (
              <section className="flex flex-col gap-2">
                <SectionLabel>
                  {t('todo.pending')} · {pending.length}
                </SectionLabel>
                <ul className="card-surface divide-border divide-y px-3">
                  {pending.map(renderRow)}
                </ul>
              </section>
            ) : null}

            {0 < doneTotal ? (
              <section className="flex flex-col gap-2">
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="done" className="border-none">
                    <AccordionTrigger className="text-primary py-3">
                      <span className="section-label">
                        {t('todo.done')} · {doneTotal}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="card-surface divide-border divide-y px-3">
                        {done.map(renderRow)}
                      </ul>
                      <div className="mt-3 flex justify-end">
                        <SimpleConfirmationDialog
                          title={t('todo.actions.clear_done')}
                          description={t('todo.confirm_clear', { count: doneTotal })}
                          hasPermission
                          loading={clearDone.isPending}
                          onConfirm={onClearDone}
                          variant="destructive"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground gap-2 px-0"
                          >
                            <Trash2 className="size-4" />
                            {t('todo.actions.clear_done')}
                          </Button>
                        </SimpleConfirmationDialog>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </section>
            ) : null}
          </div>
        )}
      </MainLayout>
    </>
  );
};

TodoPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default TodoPage;
