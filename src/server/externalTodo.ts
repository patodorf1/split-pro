import { ExternalApiError, isUuid, resolveOptionalMemberId } from '~/lib/externalExpense';
import {
  type ExternalTodoAdd,
  type ExternalTodoPatch,
  type TodoAddOutcome,
  todoAddText,
  todoKey,
  todoListText,
} from '~/lib/externalTodo';
import { db } from '~/server/db';
import { type LoadedGroup, assertGroupWritable } from '~/server/externalExpenses';

/**
 * Lógica con base de la API externa del To Do de la casa (Charly). Mismo supuesto que gastos,
 * Agenda y Stock: la clave es de la familia, pero `addedBy` y `doneBy` tienen que ser miembros del
 * grupo de la URL. Lo pendiente sale en el mismo orden que en la app: lo más viejo primero.
 */

const PERSON = { select: { id: true, name: true, email: true } } as const;

const TODO_ITEM = {
  id: true,
  title: true,
  done: true,
  doneAt: true,
  createdAt: true,
  addedByUser: PERSON,
  doneByUser: PERSON,
} as const;

interface Person {
  id: number;
  name: string | null;
  email: string | null;
}

interface TodoItemView {
  id: string;
  title: string;
  done: boolean;
  doneAt: Date | null;
  createdAt: Date;
  addedByUser: Person | null;
  doneByUser: Person | null;
}

export const serializeTodoItem = (item: TodoItemView) => ({
  id: item.id,
  title: item.title,
  done: item.done,
  doneAt: item.doneAt?.toISOString() ?? null,
  addedBy: item.addedByUser,
  doneBy: item.doneByUser,
  createdAt: item.createdAt.toISOString(),
});

const todoItemNotFound = () =>
  new ExternalApiError(
    404,
    'todo_item_not_found',
    'Esa tarea no está en el To Do de este grupo',
    'Task not found in this group',
  );

/** Id de la URL; si no es un uuid, es como si no existiera. */
export const parseTodoItemId = (raw: string | undefined): string => {
  if (!isUuid(raw)) {
    throw todoItemNotFound();
  }

  return raw;
};

const findGroupTodo = async (group: LoadedGroup, id: string) => {
  const item = await db.todoItem.findFirst({
    where: { id, groupId: group.id },
    select: TODO_ITEM,
  });

  if (!item) {
    throw todoItemNotFound();
  }

  return item;
};

/** Lo pendiente (lo más viejo primero) y las últimas hechas. */
export const listExternalTodo = async (group: LoadedGroup, query: { doneLimit: number }) => {
  const [pending, done, doneTotal] = await Promise.all([
    db.todoItem.findMany({
      where: { groupId: group.id, done: false },
      orderBy: { createdAt: 'asc' },
      select: TODO_ITEM,
    }),
    0 < query.doneLimit
      ? db.todoItem.findMany({
          where: { groupId: group.id, done: true },
          orderBy: [{ doneAt: 'desc' }, { createdAt: 'desc' }],
          take: query.doneLimit,
          select: TODO_ITEM,
        })
      : Promise.resolve([]),
    db.todoItem.count({ where: { groupId: group.id, done: true } }),
  ]);

  return {
    groupId: group.id,
    pending: pending.map(serializeTodoItem),
    done: done.map(serializeTodoItem),
    doneTotal,
    text: todoListText(pending),
  };
};

/**
 * Suma tareas. Si una ya está pendiente con el mismo título (sin importar mayúsculas ni tildes)
 * vuelve esa con `status: "already"`: un reintento del asistente no duplica. Las nuevas se crean
 * todas juntas o ninguna.
 */
export const addExternalTodo = async (group: LoadedGroup, input: ExternalTodoAdd) => {
  assertGroupWritable(group);

  const addedBy = resolveOptionalMemberId(input.addedBy, group.members, 'addedBy');
  const pending = await db.todoItem.findMany({
    where: { groupId: group.id, done: false },
    orderBy: { createdAt: 'asc' },
    select: TODO_ITEM,
  });
  const pendingByKey = new Map<string, TodoItemView>();

  for (const item of pending) {
    const key = todoKey(item.title);

    if (!pendingByKey.has(key)) {
      pendingByKey.set(key, item);
    }
  }

  const toCreate = input.items.filter((title) => !pendingByKey.has(todoKey(title)));
  const created = await db.$transaction(
    toCreate.map((title) =>
      db.todoItem.create({
        data: { groupId: group.id, title, addedBy },
        select: TODO_ITEM,
      }),
    ),
  );
  const items = [
    ...created.map((item) => ({ ...serializeTodoItem(item), status: 'added' as const })),
    ...input.items.flatMap((title) => {
      const existing = pendingByKey.get(todoKey(title));

      return existing ? [{ ...serializeTodoItem(existing), status: 'already' as const }] : [];
    }),
  ] satisfies (TodoAddOutcome & { id: string })[];

  return { groupId: group.id, items, text: todoAddText(items) };
};

/**
 * Cambia el título y/o la marca de hecha. Marcar hecha una que ya lo estaba no le cambia la fecha;
 * desmarcarla borra quién y cuándo, como en la app.
 */
export const updateExternalTodo = async (
  group: LoadedGroup,
  id: string,
  patch: ExternalTodoPatch,
) => {
  assertGroupWritable(group);

  const doneBy = resolveOptionalMemberId(patch.doneBy, group.members, 'doneBy');
  const current = await findGroupTodo(group, id);
  const doneChange =
    undefined === patch.done || patch.done === current.done
      ? {}
      : patch.done
        ? { done: true, doneAt: new Date(), doneBy }
        : { done: false, doneAt: null, doneBy: null };

  const item = await db.todoItem.update({
    where: { id: current.id },
    data: { ...(undefined === patch.title ? {} : { title: patch.title }), ...doneChange },
    select: TODO_ITEM,
  });

  return serializeTodoItem(item);
};

/** Borra la tarea (como la app: no hay papelera). Devuelve lo que se borró. */
export const deleteExternalTodo = async (group: LoadedGroup, id: string) => {
  assertGroupWritable(group);
  const item = await findGroupTodo(group, id);

  await db.todoItem.delete({ where: { id: item.id } });

  return serializeTodoItem(item);
};
