import { clsx } from 'clsx';
import {
  ChartPieIcon,
  EllipsisIcon,
  FolderOpenIcon,
  HouseIcon,
  ListIcon,
  type LucideIcon,
  PlusIcon,
  RefreshCcwDotIcon,
  ScaleIcon,
  ShoppingCartIcon,
  SirenIcon,
  UserCircleIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { LoadingSpinner } from '../ui/spinner';

interface MainLayoutProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  header?: React.ReactNode;
  loading?: boolean;
  hideAppBar?: boolean;
}

const HOME_LINK = '/dashboard';
const DOCUMENTS_LINK = '/documents';
/** Contactos de emergencia: en el celular vive dentro de "Más". */
const EMERGENCY_LINK = '/emergency';
/** "Grupos" (lista de grupos y saldos): vive dentro de "Más" en el celular. */
const GROUPS_LINK = '/groups';
const ADD_LINK = '/add';
const SHOPPING_LINK = '/shopping';
const MORE_LINK = '/more';

/** Pages reachable from the "More" sheet keep that tab highlighted. */
const MORE_SECTION_LINKS = [
  MORE_LINK,
  GROUPS_LINK,
  EMERGENCY_LINK,
  '/balances',
  '/activity',
  '/stats',
  '/recurring',
  '/account',
];

const isActiveLink = (currentPath: string | undefined, link: string) => {
  if (!currentPath) {
    return false;
  }
  if (MORE_LINK === link) {
    return MORE_SECTION_LINKS.some((section) => currentPath.startsWith(section));
  }

  return currentPath === link || currentPath.startsWith(`${link}/`);
};

const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  actions,
  hideAppBar,
  title,
  loading,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const currentPath = router.pathname;

  return (
    <div className="bg-background h-full w-full">
      <div
        vaul-drawer-wrapper=""
        className={clsx(
          'bg-background mx-auto flex h-full w-full flex-col lg:max-w-3xl lg:flex-row',
          hideAppBar ? '' : '',
        )}
      >
        <nav className="item-center -ml-[170px] hidden w-[170px] px-4 py-4 lg:flex lg:flex-col lg:gap-2">
          <Link href={HOME_LINK} className="mb-8 flex items-center gap-2">
            <span className="text-xl font-medium">{t?.('meta.application_name') ?? 'Split'}</span>
          </Link>
          <NavItemDesktop
            title={t?.('dashboard.nav.home') ?? 'Home'}
            Icon={HouseIcon}
            link={HOME_LINK}
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('documents.nav') ?? 'Documents'}
            Icon={FolderOpenIcon}
            link={DOCUMENTS_LINK}
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('emergency.nav') ?? 'Emergencies'}
            Icon={SirenIcon}
            link={EMERGENCY_LINK}
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.groups') ?? 'Groups'}
            Icon={UsersIcon}
            link={GROUPS_LINK}
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.add_expense') ?? 'Add Expense'}
            Icon={PlusIcon}
            link={ADD_LINK}
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('dashboard.nav.shopping') ?? 'Shopping'}
            Icon={ShoppingCartIcon}
            link={SHOPPING_LINK}
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('dashboard.more.balances') ?? 'Balances'}
            Icon={ScaleIcon}
            link="/balances"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('dashboard.more.activity') ?? 'Activity'}
            Icon={ListIcon}
            link="/activity"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('dashboard.more.stats') ?? 'Stats'}
            Icon={ChartPieIcon}
            link="/stats"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('dashboard.more.recurring') ?? 'Recurring'}
            Icon={RefreshCcwDotIcon}
            link="/recurring"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('dashboard.more.account') ?? 'Account'}
            Icon={UserCircleIcon}
            link="/account"
            currentPath={currentPath}
          />
        </nav>
        <div className="lg:border-border w-full overflow-auto lg:border-x lg:px-6" id="mainlayout">
          {title ? (
            <div className="mb-2 flex items-center justify-between px-4 py-4">
              <div className="text-foreground text-3xl font-bold">{title}</div>
              {actions}
            </div>
          ) : null}
          <div className="px-4">
            {loading ? (
              <div className="mt-10 flex justify-center">
                <LoadingSpinner className="text-primary" />
              </div>
            ) : (
              children
            )}
          </div>
          <div className="h-28 lg:h-0" />
        </div>
      </div>

      <nav className="bg-background/80 border-border fixed bottom-0 flex w-full items-start justify-between border-t px-2 pb-4 shadow-xs backdrop-blur-lg lg:hidden">
        <NavItem
          title={t?.('dashboard.nav.home') ?? 'Home'}
          Icon={HouseIcon}
          link={HOME_LINK}
          currentPath={currentPath}
        />
        <NavItem
          title={t?.('documents.nav') ?? 'Documents'}
          Icon={FolderOpenIcon}
          link={DOCUMENTS_LINK}
          currentPath={currentPath}
        />
        <AddExpenseNavItem title={t?.('navigation.add') ?? 'Add'} link={ADD_LINK} />
        <NavItem
          title={t?.('dashboard.nav.shopping') ?? 'Shopping'}
          Icon={ShoppingCartIcon}
          link={SHOPPING_LINK}
          currentPath={currentPath}
        />
        <NavItem
          title={t?.('dashboard.nav.more') ?? 'More'}
          Icon={EllipsisIcon}
          link={MORE_LINK}
          currentPath={currentPath}
        />
      </nav>
    </div>
  );
};

interface NavItemProps {
  title: string;
  Icon: LucideIcon;
  link: string;
  currentPath?: string;
}

const NavItem: React.FC<NavItemProps> = ({ title, Icon, link, currentPath }) => {
  const isActive = isActiveLink(currentPath, link);

  return (
    <Link
      href={link}
      aria-current={isActive ? 'page' : undefined}
      className="flex min-w-0 flex-1 flex-col items-center justify-start gap-1.5 py-4"
    >
      <Icon className={clsx('h-6 w-6', isActive ? 'text-primary' : 'text-muted-foreground')} />
      {/* Arriba y centrado: si una etiqueta pasa a dos renglones, los íconos siguen alineados. */}
      <span
        className={clsx(
          'text-center text-xs leading-tight',
          isActive ? 'text-primary font-medium' : 'text-muted-foreground',
        )}
      >
        {title}
      </span>
    </Link>
  );
};

/** Center action of the bottom bar: a raised circular button. */
const AddExpenseNavItem: React.FC<{ title: string; link: string }> = ({ title, link }) => (
  <Link href={link} aria-label={title} className="flex flex-1 flex-col items-center py-4">
    <span className="bg-primary text-primary-foreground flex size-13 items-center justify-center rounded-full shadow-lg">
      <PlusIcon className="size-7" />
    </span>
  </Link>
);

const NavItemDesktop: React.FC<NavItemProps> = ({ title, Icon, link, currentPath }) => {
  const isActive = isActiveLink(currentPath, link);

  return (
    <Link
      href={link}
      aria-current={isActive ? 'page' : undefined}
      className={clsx('flex w-[150px] items-center gap-2 py-3')}
    >
      <Icon className={clsx('h-6 w-6', isActive ? 'text-primary' : 'text-muted-foreground')} />
      <span
        className={clsx(
          'capitalize',
          isActive ? 'text-primary font-medium' : 'text-muted-foreground',
        )}
      >
        {title}
      </span>
    </Link>
  );
};
export default MainLayout;
