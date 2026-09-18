import { CheckIcon } from '@heroicons/react/24/outline';
import { UserPlusIcon } from '@heroicons/react/24/solid';
import { type Group, type GroupUser, type User } from '@prisma/client';
import { SendIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import Image from 'next/image';
import React, { useCallback, useEffect, useMemo } from 'react';
import { z } from 'zod';

import { cn } from '~/lib/utils';
import { useAddExpenseStore } from '~/store/addStore';
import { api } from '~/utils/api';

import { EntityAvatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { SectionLabel } from '../ui/section-label';
import { UserInput } from './UserInput';

/**
 * Primer paso de "Agregar gasto": con quién se comparte.
 *
 * El orden es el del caso de uso real (casi siempre se toca un grupo fijado):
 * primero los grupos como botones grandes, después los amigos como listado y
 * al final el buscador. Con `withSearch` el buscador vive acá abajo; cuando el
 * gasto ya tiene participantes el buscador queda arriba (lo renderiza
 * AddOrEditExpensePage) y este componente solo muestra las listas.
 */
export const SelectUserOrGroup: React.FC<{
  enableSendingInvites: boolean;
  withSearch?: boolean;
}> = ({ enableSendingInvites, withSearch }) => {
  const { t } = useTranslation();
  const nameOrEmail = useAddExpenseStore((s) => s.nameOrEmail);
  const participants = useAddExpenseStore((s) => s.participants);
  const group = useAddExpenseStore((s) => s.group);
  const { addOrUpdateParticipant, removeParticipant, setNameOrEmail, setGroup, setParticipants } =
    useAddExpenseStore((s) => s.actions);

  const friendsQuery = api.user.getFriends.useQuery();
  const groupsQuery = api.group.getAllGroups.useQuery();
  const addFriendMutation = api.user.inviteFriend.useMutation();

  const isEmail = z.string().email().safeParse(nameOrEmail);
  const isSearching = '' !== nameOrEmail;

  const filteredGroups = useMemo(
    () =>
      groupsQuery.data
        ?.filter((g) => g.group.name.toLowerCase().includes(nameOrEmail.toLowerCase()))
        // Los grupos fijados van primero: es el que se usa todos los días.
        .toSorted((a, b) => Number(b.pinned) - Number(a.pinned)),
    [groupsQuery.data, nameOrEmail],
  );
  const filteredFriends = friendsQuery.data?.filter((f) =>
    (f.name ?? f.email)?.toLowerCase().includes(nameOrEmail.toLowerCase()),
  );

  /**
   * Al empezar a buscar, el bloque del buscador sube arriba de todo (con `order`,
   * sin desmontar el input, así no se pierde el foco) y la pantalla scrollea al
   * tope. Así los resultados quedan debajo del campo y el teclado del celular
   * no los tapa.
   */
  useEffect(() => {
    if (withSearch && isSearching) {
      document.getElementById('mainlayout')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [withSearch, isSearching]);

  const onAddEmailClick = useCallback(
    (invite = false) => {
      if (isEmail.success) {
        addFriendMutation.mutate(
          { email: nameOrEmail, sendInviteEmail: invite },
          {
            onSuccess: (user) => {
              removeParticipant(-1);
              addOrUpdateParticipant(user);
              setNameOrEmail('');
            },
          },
        );
        addOrUpdateParticipant({
          id: -1,
          name: nameOrEmail,
          email: nameOrEmail,
          emailVerified: new Date(),
          image: null,
          currency: 'USD',
          defaultCurrency: null,
          obapiProviderId: null,
          bankingId: null,
          preferredLanguage: '',
          hiddenFriendIds: [],
        });
        // Add email to split pro
      }
    },
    [
      isEmail.success,
      nameOrEmail,
      addFriendMutation,
      addOrUpdateParticipant,
      setNameOrEmail,
      removeParticipant,
    ],
  );

  const onGroupSelect = useCallback(
    (group: Group & { groupUsers: (GroupUser & { user: User })[] }) => {
      setGroup(group);
      const { currentUser } = useAddExpenseStore.getState();
      if (currentUser) {
        setParticipants([
          currentUser,
          ...group.groupUsers.map((gu) => gu.user).filter((u) => u.id !== currentUser.id),
        ]);
      }
      setNameOrEmail('');
    },
    [setGroup, setParticipants, setNameOrEmail],
  );

  const handleAddEmailClickFalse = useCallback(() => onAddEmailClick(false), [onAddEmailClick]);

  const handleFriendClick = useCallback(
    (f: User) => {
      const isExisting = participants.some((p) => p.id === f.id);

      if (isExisting) {
        removeParticipant(f.id);
      } else {
        addOrUpdateParticipant(f);
      }
      setNameOrEmail('');
    },
    [participants, removeParticipant, addOrUpdateParticipant, setNameOrEmail],
  );

  if (group) {
    return (
      <div className="text-destructive mt-4 text-center">
        {t('expense_details.add_expense_details.select_user_or_group.only_one_group_time')}
      </div>
    );
  }

  const inviteButtons = (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
      {enableSendingInvites && (
        <Button
          className="text-primary hover:text-primary"
          variant="outline"
          disabled={!isEmail.success}
          onClick={handleAddEmailClickFalse}
        >
          <SendIcon className="mr-2 h-4 w-4" />
          {t('expense_details.add_expense_details.select_user_or_group.send_invite')}
        </Button>
      )}
      <Button
        className="text-primary hover:text-primary"
        variant="outline"
        disabled={!isEmail.success}
        onClick={handleAddEmailClickFalse}
      >
        <UserPlusIcon className="mr-2 h-4 w-4" />
        {t('expense_details.add_expense_details.select_user_or_group.add_to_split_pro')}
      </Button>
    </div>
  );

  const inviteHint = enableSendingInvites ? (
    isEmail.success ? (
      <p className="text-negative text-sm">
        {t('expense_details.add_expense_details.select_user_or_group.warning')}
      </p>
    ) : null
  ) : (
    <p className="text-muted-foreground text-sm">
      {t('expense_details.add_expense_details.select_user_or_group.note')}
    </p>
  );

  return (
    <div className="mt-1 flex flex-col gap-6">
      {!withSearch ? (
        <div className="flex flex-col gap-2">
          {inviteHint}
          {inviteButtons}
        </div>
      ) : null}

      {/*Can't select multiple groups or groups with outside ppl */}
      {filteredGroups?.length && 1 === participants.length ? (
        <div>
          <SectionLabel className="mb-2">{t('actors.groups')}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {filteredGroups.map((g) => (
              <button
                key={g.groupId}
                className="card-surface hover:bg-accent flex min-h-[108px] flex-col items-center justify-center gap-2 p-3 text-center transition-colors"
                onClick={() => onGroupSelect(g.group)}
              >
                <EntityAvatar entity={g.group} size={44} />
                <span className="w-full truncate font-medium">{g.group.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filteredFriends?.length ? (
        <div>
          <SectionLabel className="mb-1">{t('actors.friends')}</SectionLabel>
          {filteredFriends.map((f) => (
            <button
              key={f.id}
              className="border-border flex w-full items-center justify-between border-b py-4"
              onClick={() => handleFriendClick(f)}
            >
              <div className="flex min-w-0 items-center gap-4">
                <EntityAvatar entity={f} size={35} />
                <div className="truncate">{f.name ?? f.email}</div>
              </div>
              {participants.some((p) => p.id === f.id) ? (
                <div>
                  <CheckIcon className="text-primary h-4 w-4" />
                </div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {withSearch ? (
        <>
          <div className={cn('flex flex-col gap-2', isSearching && 'order-first')}>
            <SectionLabel>
              {t('expense_details.add_expense_details.select_user_or_group.search_label')}
            </SectionLabel>
            <UserInput className="card-surface mt-0 border-b-0 px-3 py-2" />
          </div>
          {/* Buscando, los botones de correo quedan al final: los resultados van pegados al campo. */}
          <div className="flex flex-col gap-2">
            {inviteHint}
            {inviteButtons}
          </div>
        </>
      ) : null}

      {0 === filteredFriends?.length && 0 === filteredGroups?.length ? (
        <div className="flex flex-col items-center justify-center pt-6 transition-discrete starting:opacity-0">
          <Image alt="empty user image" src="/empty_img.svg" width={200} height={200} />
        </div>
      ) : null}
    </div>
  );
};
