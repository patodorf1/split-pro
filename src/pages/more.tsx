import Head from 'next/head';
import React, { useCallback, useState } from 'react';

import MainLayout from '~/components/Layout/MainLayout';
import { MoreMenuContent } from '~/components/Layout/MoreMenu';
import { ThemePicker } from '~/components/Theme/ThemePicker';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { withI18nStaticProps } from '~/utils/i18n/server';

/**
 * En el celular, Más es un panel que sube desde la barra de abajo. Esta página queda para quien
 * entre con la dirección directa: muestra el mismo menú.
 */
const MorePage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();
  const [themeOpen, setThemeOpen] = useState(false);
  const openTheme = useCallback(() => setThemeOpen(true), []);

  return (
    <>
      <Head>
        <title>{t('dashboard.more.title')}</title>
      </Head>
      <MainLayout title={t('dashboard.more.title')}>
        <div className="pb-8">
          <MoreMenuContent onOpenTheme={openTheme} />
        </div>
        <ThemePicker open={themeOpen} onOpenChange={setThemeOpen} />
      </MainLayout>
    </>
  );
};

MorePage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default MorePage;
