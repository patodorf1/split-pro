import { type GetServerSideProps } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';
import { AddOrEditExpensePage } from '~/components/AddExpense/AddExpensePage';
import MainLayout from '~/components/Layout/MainLayout';
import { env } from '~/env';
import { isKnownCategory } from '~/lib/category';
import { cronFromBackend } from '~/lib/cron';
import { parseCurrencyCode } from '~/lib/currency';
import {
  pickDefaultGroup,
  resolveGroupCurrency,
  shouldPreselectDefaultGroup,
} from '~/lib/defaultGroup';
import { isBankConnectionConfigured } from '~/server/bankTransactionHelper';
import { useAddExpenseStore } from '~/store/addStore';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { customServerSideTranslations } from '~/utils/i18n/server';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { toast } from 'sonner';
import { deserializeDefaultSplit } from '~/lib/defaultSplit';
import { useAppStore } from '~/store/appStore';

const MAX_QUERY_DESCRIPTION_LENGTH = 200;

const AddPage: NextPageWithUser<{
  enableSendingInvites: boolean;
  bankConnectionEnabled: boolean;
  maxUploadFileSizeMB: number;
}> = ({ user, enableSendingInvites, bankConnectionEnabled, maxUploadFileSizeMB }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const {
    setCurrentUser,
    setGroup,
    setParticipants,
    setCurrency,
    setAmount,
    setDescription,
    setPaidBy,
    setAmountStr,
    setExpenseDate,
    setCategory,
    resetState,
    setCronExpression,
    setFileKey,
    applySplitPreset,
    selectGroup,
  } = useAddExpenseStore((s) => s.actions);
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const initializedGroupIdRef = useRef<number | null>(null);
  const initializedFriendIdRef = useRef<number | null>(null);
  const initializedExpenseIdRef = useRef<string | null>(null);
  const prefilledRef = useRef(false);
  const defaultGroupAppliedRef = useRef(false);

  useEffect(
    () => () => {
      resetState();
      initializedExpenseIdRef.current = null;
      initializedGroupIdRef.current = null;
      initializedFriendIdRef.current = null;
      prefilledRef.current = false;
      defaultGroupAppliedRef.current = false;
    },
    [resetState],
  );

  // TODO: Set this globally from env var with app router later
  const { setMaxUploadFileSizeMB } = useAppStore((s) => s.actions);
  setMaxUploadFileSizeMB(maxUploadFileSizeMB);

  const router = useRouter();
  const { friendId, groupId, expenseId, description, category } = router.query;

  /**
   * Prefill por query string: lo usa la lista de compras para abrir el gasto del súper ya titulado
   * y con la categoría puesta. Solo aplica al crear, nunca al editar un gasto existente.
   */
  useEffect(() => {
    if (!router.isReady || prefilledRef.current || expenseId) {
      return;
    }

    prefilledRef.current = true;

    if ('string' === typeof description && description) {
      setDescription(description.slice(0, MAX_QUERY_DESCRIPTION_LENGTH));
    }

    if ('string' === typeof category && isKnownCategory(category)) {
      setCategory(category);
    }
  }, [router.isReady, description, category, expenseId, setDescription, setCategory]);

  useEffect(() => {
    setCurrentUser({
      ...user,
      defaultCurrency: user.defaultCurrency ?? null,
      emailVerified: null,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      obapiProviderId: user.obapiProviderId ?? null,
      bankingId: user.bankingId ?? null,
    });
    if (router.isReady && !groupId) {
      const preferredCurrency = user.currency ?? user.defaultCurrency;
      if (preferredCurrency) {
        setCurrency(parseCurrencyCode(preferredCurrency));
      }
    }
  }, [setCurrentUser, setCurrency, groupId, router.isReady, user]);

  const _groupId = parseInt(groupId as string);
  const _friendId = parseInt(friendId as string);
  const _expenseId = expenseId as string;
  const groupQuery = api.group.getGroupDetails.useQuery(
    { groupId: _groupId },
    {
      enabled: Boolean(_groupId) && !_expenseId,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    },
  );

  const friendQuery = api.user.getFriend.useQuery(
    { friendId: _friendId },
    {
      enabled: Boolean(_friendId) && !_expenseId,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    },
  );

  const expenseQuery = api.expense.getExpenseDetails.useQuery(
    { expenseId: _expenseId },
    {
      enabled: Boolean(_expenseId),
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    },
  );

  /**
   * Grupo por defecto: si /add se abre en blanco (sin grupo, amigo ni gasto en la URL) arrancamos
   * con el grupo que el usuario marcó como "usar por defecto al agregar gasto", igual que si
   * hubiera tocado su botón en el selector. Se aplica una sola vez por visita: si después lo saca,
   * no vuelve solo.
   */
  const defaultGroupQuery = api.group.getAllGroups.useQuery(undefined, {
    enabled: shouldPreselectDefaultGroup({
      isReady: router.isReady,
      alreadyApplied: false,
      query: { groupId, friendId, expenseId },
    }),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (
      !shouldPreselectDefaultGroup({
        isReady: router.isReady,
        alreadyApplied: defaultGroupAppliedRef.current,
        query: { groupId, friendId, expenseId },
      }) ||
      !currentUser
    ) {
      return;
    }

    const defaultGroupUser = pickDefaultGroup(defaultGroupQuery.data);

    if (!defaultGroupUser) {
      return;
    }

    defaultGroupAppliedRef.current = true;
    selectGroup(defaultGroupUser.group, resolveGroupCurrency(currentUser, defaultGroupUser.group));
  }, [
    router.isReady,
    groupId,
    friendId,
    expenseId,
    currentUser,
    defaultGroupQuery.data,
    selectGroup,
  ]);

  useEffect(() => {
    if (!groupId || !_groupId) {
      initializedGroupIdRef.current = null;
      return;
    }

    if (initializedGroupIdRef.current === _groupId) {
      return;
    }

    // Set group
    if (groupId && !groupQuery.isPending && groupQuery.data && currentUser) {
      initializedGroupIdRef.current = _groupId;
      setGroup(groupQuery.data);

      setParticipants([
        currentUser,
        ...groupQuery.data.groupUsers
          .map((gu) => gu.user)
          .filter((groupUser) => groupUser.id !== currentUser.id),
      ]);
      const preferredCurrency =
        currentUser.currency ?? groupQuery.data.defaultCurrency ?? currentUser.defaultCurrency;
      if (preferredCurrency) {
        setCurrency(parseCurrencyCode(preferredCurrency));
      }
      const parsedDefaultSplit = deserializeDefaultSplit(groupQuery.data.defaultSplit);
      if (parsedDefaultSplit) {
        applySplitPreset(parsedDefaultSplit.splitType, parsedDefaultSplit.shares);
      }
      useAddExpenseStore.setState({ showFriends: false });
    }
  }, [
    _groupId,
    groupId,
    groupQuery.isPending,
    groupQuery.data,
    currentUser,
    setGroup,
    setParticipants,
    setCurrency,
    applySplitPreset,
  ]);

  useEffect(() => {
    if (!friendId || !_friendId) {
      initializedFriendIdRef.current = null;
      return;
    }

    if (initializedFriendIdRef.current === _friendId) {
      return;
    }

    if (friendId && currentUser && friendQuery.data) {
      initializedFriendIdRef.current = _friendId;
      setParticipants([currentUser, friendQuery.data]);
      const parsedDefaultSplit = deserializeDefaultSplit(friendQuery.data.defaultSplit);
      if (parsedDefaultSplit) {
        applySplitPreset(parsedDefaultSplit.splitType, parsedDefaultSplit.shares);
      }
      useAddExpenseStore.setState({ showFriends: false });
    }
  }, [
    _friendId,
    friendId,
    friendQuery.isPending,
    friendQuery.data,
    currentUser,
    setParticipants,
    applySplitPreset,
  ]);

  useEffect(() => {
    if (!_expenseId || !expenseQuery.data) {
      initializedExpenseIdRef.current = null;
      return;
    }

    if (initializedExpenseIdRef.current === _expenseId) {
      return;
    }

    initializedExpenseIdRef.current = _expenseId;

    if (expenseQuery.data.group) {
      setGroup(expenseQuery.data.group);
    }
    setPaidBy(expenseQuery.data.paidByUser);
    setCurrency(parseCurrencyCode(expenseQuery.data.currency));
    setAmountStr(
      getCurrencyHelpersCached(expenseQuery.data.currency).toUIString(
        expenseQuery.data.amount,
        true,
        true,
      ),
    );
    setDescription(expenseQuery.data.name);
    setCategory(expenseQuery.data.category);
    setAmount(expenseQuery.data.amount);
    setParticipants(
      expenseQuery.data.expenseParticipants.map((ep) => ({
        ...ep.user,
        amount: ep.amount,
      })),
      expenseQuery.data.splitType,
    );
    useAddExpenseStore.setState({ showFriends: false });
    setExpenseDate(expenseQuery.data.expenseDate);
    if (expenseQuery.data.recurrence) {
      try {
        const cronExpression = cronFromBackend(expenseQuery.data.recurrence.job.schedule);
        setCronExpression(cronExpression);
      } catch {
        toast.error(t('errors.invalid_cron_expression'));
        console.error(
          `Failed to parse cron expression for expense: ${expenseQuery.data.recurrence.job.schedule}`,
        );
      }
    }
    if (expenseQuery.data.fileKey) {
      setFileKey(expenseQuery.data.fileKey);
    }
  }, [
    _expenseId,
    _friendId,
    _groupId,
    friendId,
    expenseQuery.data,
    groupId,
    friendQuery.data,
    friendQuery.isPending,
    groupQuery.data,
    groupQuery.isPending,
    currentUser,
    setAmount,
    setAmountStr,
    setCategory,
    setCurrency,
    setDescription,
    setExpenseDate,
    setGroup,
    setPaidBy,
    setParticipants,
    setCronExpression,
    setFileKey,
    getCurrencyHelpersCached,
    t,
  ]);

  return (
    <>
      <Head>
        <title>{_expenseId ? t('actions.edit_expense') : t('actions.add_expense')}</title>
      </Head>
      <MainLayout hideAppBar>
        {currentUser && (!_expenseId || expenseQuery.data) && (
          <AddOrEditExpensePage
            enableSendingInvites={enableSendingInvites}
            expenseId={_expenseId}
            bankConnectionEnabled={Boolean(bankConnectionEnabled)}
          />
        )}
      </MainLayout>
    </>
  );
};

AddPage.auth = true;

export default AddPage;

export const getServerSideProps: GetServerSideProps = async (context) => ({
  props: {
    enableSendingInvites: Boolean(env.ENABLE_SENDING_INVITES),
    bankConnectionEnabled: isBankConnectionConfigured(),
    maxUploadFileSizeMB: env.UPLOAD_MAX_FILE_SIZE_MB,
    ...(await customServerSideTranslations(context.locale, ['common', 'categories', 'currencies'])),
  },
});
