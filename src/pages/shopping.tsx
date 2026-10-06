import Head from 'next/head';
import { useRouter } from 'next/router';
import React, { useCallback, useMemo, useRef } from 'react';

import { type KitchenTab, KitchenTabs, isKitchenTab } from '~/components/kitchen/KitchenTabs';
import MainLayout from '~/components/Layout/MainLayout';
import { MealsTab } from '~/components/meals/MealsTab';
import { RecipeScreen } from '~/components/meals/RecipeScreen';
import { ShoppingTab } from '~/components/shopping/ShoppingTab';
import { StockTab } from '~/components/stock/StockTab';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type RecipeKind, isRecipeKind } from '~/lib/recipes';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const ShoppingPage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const router = useRouter();

  const tab: KitchenTab = isKitchenTab(router.query.tab) ? router.query.tab : 'shopping';
  const kind = isRecipeKind(router.query.kind) ? router.query.kind : undefined;
  const recipeId =
    'meals' === tab && 'string' === typeof router.query.recipe ? router.query.recipe : null;

  const onTabChange = useCallback(
    (next: KitchenTab) =>
      void router.replace(
        { pathname: router.pathname, query: 'shopping' === next ? {} : { tab: next } },
        undefined,
        { shallow: true },
      ),
    [router],
  );

  /** El filtro de Comidas va en la dirección: al volver de una receta sigue elegido. */
  const onKindChange = useCallback(
    (next?: RecipeKind) =>
      void router.replace(
        {
          pathname: router.pathname,
          query: next ? { tab: 'meals', kind: next } : { tab: 'meals' },
        },
        undefined,
        { shallow: true },
      ),
    [router],
  );

  /*
   * Si la receta se abrió desde la lista, "Comidas" es volver atrás (como el botón del teléfono).
   * Si se entró directo con la dirección, no hay a dónde volver: va a la lista.
   */
  const openedRecipeHere = useRef(false);

  const onOpenRecipe = useCallback(
    (id: string) => {
      openedRecipeHere.current = true;
      void router.push(
        {
          pathname: router.pathname,
          query: { tab: 'meals', ...(kind ? { kind } : {}), recipe: id },
        },
        undefined,
        { shallow: true },
      );
    },
    [kind, router],
  );

  const onCloseRecipe = useCallback(() => {
    if (openedRecipeHere.current) {
      openedRecipeHere.current = false;
      router.back();
      return;
    }
    void router.replace({ pathname: router.pathname, query: { tab: 'meals' } }, undefined, {
      shallow: true,
    });
  }, [router]);

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
            {'shopping' === tab ? <ShoppingTab groupId={groupId} user={user} /> : null}
            {'stock' === tab ? <StockTab groupId={groupId} /> : null}
            {'meals' === tab && recipeId ? (
              <RecipeScreen
                key={recipeId}
                groupId={groupId}
                recipeId={recipeId}
                onBack={onCloseRecipe}
              />
            ) : null}
            {'meals' === tab && !recipeId ? (
              <MealsTab
                groupId={groupId}
                kind={kind}
                onKindChange={onKindChange}
                onOpenRecipe={onOpenRecipe}
              />
            ) : null}
          </div>
        )}
      </MainLayout>
    </>
  );
};

ShoppingPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default ShoppingPage;
