import Head from 'next/head';
import { useRouter } from 'next/router';
import React, { useCallback, useMemo } from 'react';

import { type KitchenTab, KitchenTabs, isKitchenTab } from '~/components/kitchen/KitchenTabs';
import MainLayout from '~/components/Layout/MainLayout';
import { ShoppingTab } from '~/components/shopping/ShoppingTab';
import { StockTab } from '~/components/stock/StockTab';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const ShoppingPage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const router = useRouter();

  const tab: KitchenTab = isKitchenTab(router.query.tab) ? router.query.tab : 'shopping';
  const onTabChange = useCallback(
    (next: KitchenTab) =>
      void router.replace(
        { pathname: router.pathname, query: 'shopping' === next ? {} : { tab: next } },
        undefined,
        { shallow: true },
      ),
    [router],
  );

  const groupsQuery = api.group.getAllGroups.useQuery();

  const groups = useMemo(
    () =>
      (groupsQuery.data ?? [])
        .filter(({ group }) => !group.archivedAt)
        .map(({ group, pinned, defaultForAdd }) => ({
          id: group.id,
          name: group.name,
          pinned,
          defaultForAdd,
        })),
    [groupsQuery.data],
  );

  /*
   * Una sola lista, la de la casa: el grupo marcado para cargar gastos (Casa), o el fijado, o el
   * primero. Sin selector, para que todo lo que se anota vaya al mismo lugar.
   */
  const groupId = useMemo(() => {
    const preferred =
      groups.find((group) => group.defaultForAdd) ??
      groups.find((group) => group.pinned) ??
      groups[0];

    return preferred?.id ?? null;
  }, [groups]);

  return (
    <>
      <Head>
        <title>{t('kitchen.title')}</title>
      </Head>
      <MainLayout title={t('kitchen.title')} loading={groupsQuery.isPending}>
        {null === groupId ? (
          <p className="text-muted-foreground mt-10 text-center text-sm">
            {t('shopping.empty.no_groups')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <KitchenTabs value={tab} onChange={onTabChange} />
            {'stock' === tab ? (
              <StockTab groupId={groupId} />
            ) : (
              <ShoppingTab groupId={groupId} user={user} />
            )}
          </div>
        )}
      </MainLayout>
    </>
  );
};

ShoppingPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default ShoppingPage;
