import {
  ChartPieIcon,
  FolderOpenIcon,
  ListIcon,
  ListTodoIcon,
  type LucideIcon,
  PaletteIcon,
  RefreshCcwDotIcon,
  ScaleIcon,
  SirenIcon,
  UserCircleIcon,
  UsersIcon,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import React from 'react';

import MainLayout from '~/components/Layout/MainLayout';
import { ThemePicker } from '~/components/Theme/ThemePicker';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type NextPageWithUser } from '~/types';
import { withI18nStaticProps } from '~/utils/i18n/server';

const ENTRIES: { href: string; labelKey: string; Icon: LucideIcon }[] = [
  // Arriba de todo: en una urgencia tiene que estar a un toque.
  { href: '/emergency', labelKey: 'emergency.nav', Icon: SirenIcon },
  // Grupos salió de la barra inferior: va entre los primeros.
  { href: '/groups', labelKey: 'navigation.groups', Icon: UsersIcon },
  { href: '/todo', labelKey: 'todo.title', Icon: ListTodoIcon },
  // Documentos salió de la barra inferior (su lugar lo ocupa la Agenda).
  { href: '/documents', labelKey: 'documents.nav', Icon: FolderOpenIcon },
  { href: '/balances', labelKey: 'dashboard.more.balances', Icon: ScaleIcon },
  { href: '/activity', labelKey: 'dashboard.more.activity', Icon: ListIcon },
  { href: '/stats', labelKey: 'dashboard.more.stats', Icon: ChartPieIcon },
  { href: '/recurring', labelKey: 'dashboard.more.recurring', Icon: RefreshCcwDotIcon },
  { href: '/account', labelKey: 'dashboard.more.account', Icon: UserCircleIcon },
];

/** Botón cuadrado: ícono en un círculo y el nombre abajo. */
const TILE_CLASSES =
  'card-surface flex aspect-square w-full flex-col items-center justify-center gap-2 px-2 text-center transition-transform active:scale-95';

const TileContent: React.FC<{ Icon: LucideIcon; label: string }> = ({ Icon, label }) => (
  <>
    <span className="bg-primary-soft text-primary flex size-11 shrink-0 items-center justify-center rounded-full">
      <Icon className="size-5" />
    </span>
    <span className="text-foreground text-xs leading-tight font-medium">{label}</span>
  </>
);

const MorePage: NextPageWithUser = () => {
  const { t } = useTranslationWithUtils();

  return (
    <>
      <Head>
        <title>{t('dashboard.more.title')}</title>
      </Head>
      <MainLayout title={t('dashboard.more.title')}>
        <div className="grid grid-cols-3 gap-3 pb-8">
          {ENTRIES.map(({ href, labelKey, Icon }) => (
            <Link key={href} href={href} className={TILE_CLASSES}>
              <TileContent Icon={Icon} label={t(labelKey)} />
            </Link>
          ))}
          {/* Atajo al selector de tema, que también vive dentro de Cuenta. */}
          <ThemePicker>
            <button type="button" className={TILE_CLASSES}>
              <TileContent Icon={PaletteIcon} label={t('themes.title')} />
            </button>
          </ThemePicker>
        </div>
      </MainLayout>
    </>
  );
};

MorePage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default MorePage;
