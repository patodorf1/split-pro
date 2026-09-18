import {
  ChartPieIcon,
  ChevronRightIcon,
  ListIcon,
  type LucideIcon,
  RefreshCcwDotIcon,
  ScaleIcon,
  UserCircleIcon,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React from 'react';

import { DashboardCard } from '~/components/dashboard/DashboardCard';
import MainLayout from '~/components/Layout/MainLayout';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { withI18nStaticProps } from '~/utils/i18n/server';

const ENTRIES: { href: string; labelKey: string; Icon: LucideIcon }[] = [
  { href: '/balances', labelKey: 'dashboard.more.balances', Icon: ScaleIcon },
  { href: '/activity', labelKey: 'dashboard.more.activity', Icon: ListIcon },
  { href: '/stats', labelKey: 'dashboard.more.stats', Icon: ChartPieIcon },
  { href: '/recurring', labelKey: 'dashboard.more.recurring', Icon: RefreshCcwDotIcon },
  { href: '/account', labelKey: 'dashboard.more.account', Icon: UserCircleIcon },
];

const MorePage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();

  return (
    <>
      <Head>
        <title>{t('dashboard.more.title')}</title>
      </Head>
      <MainLayout title={t('dashboard.more.title')}>
        <DashboardCard className="px-0 py-1">
          <ul>
            {ENTRIES.map(({ href, labelKey, Icon }) => (
              <li key={href} className="border-border border-b last:border-b-0">
                <Link href={href} className="flex items-center gap-3 px-4 py-4">
                  <Icon className="text-primary size-5 shrink-0" />
                  <span className="text-foreground flex-1 text-sm">{t(labelKey)}</span>
                  <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </DashboardCard>
      </MainLayout>
    </>
  );
};

MorePage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default MorePage;
