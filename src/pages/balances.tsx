import { ArrowUpOnSquareIcon } from '@heroicons/react/24/outline';
import { Download, PlusIcon } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback } from 'react';
import { DownloadAppDrawer } from '~/components/Account/DownloadAppDrawer';
import { BalancesSection } from '~/components/Expense/BalancesSection';
import MainLayout from '~/components/Layout/MainLayout';
import { NotificationModal } from '~/components/NotificationModal';
import { Button } from '~/components/ui/button';
import { useIsPwa } from '~/hooks/useIsPwa';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';

const BalancePage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const isPwa = useIsPwa();
  const cumulatedQuery = api.expense.getCumulatedBalances.useQuery();

  const shareWithFriends = useCallback(() => {
    if (navigator.share) {
      navigator
        .share({
          title: t('meta.application_name'),
          text: t('ui.share_text'),
          url: window.location.origin,
        })
        .then(() => console.info('Successful share'))
        .catch((error) => console.error('Error sharing', error));
    }
  }, [t]);

  return (
    <>
      <Head>
        <title>{t('meta.title')}</title>
      </Head>
      <MainLayout
        title={t('navigation.balances')}
        actions={
          'undefined' !== typeof window && 'share' in window.navigator ? (
            <Button variant="ghost" onClick={shareWithFriends}>
              <ArrowUpOnSquareIcon className="h-6 w-6" />
            </Button>
          ) : (
            <div className="h-6 w-10" />
          )
        }
        loading={cumulatedQuery.isPending}
      >
        <NotificationModal />
        <BalancesSection defaultCurrency={user.defaultCurrency} className="mx-4 pb-36">
          {({ isEmpty }) =>
            isEmpty ? (
              <div className="mt-[40vh] flex -translate-y-[130%] flex-col items-center justify-center gap-6">
                <DownloadAppDrawer>
                  <Button className="w-62.5">
                    <Download className="mr-2 h-5 w-5" />
                    {t('account.download_app')}
                  </Button>
                </DownloadAppDrawer>
                {!isPwa && <p>{t('ui.or')}</p>}
                <Link href="/add">
                  <Button className="w-62.5">
                    <PlusIcon className="mr-2 h-5 w-5" />
                    {t('actions.add_expense')}
                  </Button>
                </Link>
              </div>
            ) : null
          }
        </BalancesSection>
      </MainLayout>
    </>
  );
};

BalancePage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default BalancePage;
