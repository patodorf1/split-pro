import {
  ChartPieIcon,
  EllipsisIcon,
  FolderOpenIcon,
  ListIcon,
  ListTodoIcon,
  type LucideIcon,
  PaletteIcon,
  RefreshCcwDotIcon,
  SirenIcon,
  UserCircleIcon,
  UsersIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import React, { useCallback, useState } from 'react';

import { ThemePicker } from '~/components/Theme/ThemePicker';
import { AppDrawer } from '~/components/ui/drawer';
import { useIsClient } from '~/hooks/useIsClient';

/** En filas de a tres, en este orden. Saldos por persona vive dentro de Estadísticas. */
const MAIN_ENTRIES: { href: string; labelKey: string; Icon: LucideIcon }[] = [
  { href: '/todo', labelKey: 'todo.title', Icon: ListTodoIcon },
  { href: '/documents', labelKey: 'documents.nav', Icon: FolderOpenIcon },
  { href: '/emergency', labelKey: 'emergency.nav', Icon: SirenIcon },
  { href: '/activity', labelKey: 'dashboard.more.activity', Icon: ListIcon },
  { href: '/stats', labelKey: 'dashboard.more.stats', Icon: ChartPieIcon },
  { href: '/recurring', labelKey: 'dashboard.more.recurring', Icon: RefreshCcwDotIcon },
];

/** Botones de sistema: más chicos y en gris, abajo de todo. */
const SYSTEM_ENTRIES: { href: string; labelKey: string; Icon: LucideIcon }[] = [
  { href: '/groups', labelKey: 'navigation.groups', Icon: UsersIcon },
  { href: '/account', labelKey: 'dashboard.more.account', Icon: UserCircleIcon },
];

const TILE_CLASSES =
  'card-surface flex aspect-square w-full flex-col items-center justify-center gap-2 px-2 text-center transition-transform active:scale-95';

const SYSTEM_CLASSES =
  'bg-muted text-muted-foreground flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-medium transition-transform active:scale-95';

/**
 * Lo que hay en Más: seis botones grandes y abajo los de sistema (Grupos, Cuenta, Tema). Lo usan
 * el panel de la barra de abajo y la página /more.
 */
export const MoreMenuContent: React.FC<{
  onNavigate?: () => void;
  onOpenTheme: () => void;
}> = ({ onNavigate, onOpenTheme }) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        {MAIN_ENTRIES.map(({ href, labelKey, Icon }) => (
          <Link key={href} href={href} className={TILE_CLASSES} onClick={onNavigate}>
            <span className="bg-primary-soft text-primary flex size-11 shrink-0 items-center justify-center rounded-full">
              <Icon className="size-5" />
            </span>
            <span className="text-foreground text-xs leading-tight font-medium">{t(labelKey)}</span>
          </Link>
        ))}
      </div>

      <div className="flex gap-2">
        {SYSTEM_ENTRIES.map(({ href, labelKey, Icon }) => (
          <Link key={href} href={href} className={SYSTEM_CLASSES} onClick={onNavigate}>
            <Icon className="size-4 shrink-0" />
            {t(labelKey)}
          </Link>
        ))}
        <button type="button" className={SYSTEM_CLASSES} onClick={onOpenTheme}>
          <PaletteIcon className="size-4 shrink-0" />
          {t('themes.title')}
        </button>
      </div>
    </div>
  );
};

/**
 * "Más" en la barra de abajo: no cambia de pantalla, sube un panel con el menú. Tema cierra el
 * panel y abre los temas, para no apilar dos hojas.
 */
export const MoreMenuNavItem: React.FC<{ title: string; isActive: boolean }> = ({
  title,
  isActive,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const isClient = useIsClient();

  const close = useCallback(() => setOpen(false), []);
  const openTheme = useCallback(() => {
    setOpen(false);
    setThemeOpen(true);
  }, []);

  const highlighted = isActive || open;

  const button = (
    <button
      type="button"
      aria-label={title}
      className="flex min-w-0 flex-1 flex-col items-center justify-start gap-1.5 py-4"
    >
      <EllipsisIcon
        className={clsx('h-6 w-6', highlighted ? 'text-primary' : 'text-muted-foreground')}
      />
      <span
        className={clsx(
          'text-center text-xs leading-tight',
          highlighted ? 'text-primary font-medium' : 'text-muted-foreground',
        )}
      >
        {title}
      </span>
    </button>
  );

  return (
    <>
      {/* El panel recién existe en el navegador: hasta entonces el botón ocupa su lugar igual. */}
      {isClient ? (
        <AppDrawer
          open={open}
          onOpenChange={setOpen}
          title={t('dashboard.more.title')}
          className="h-auto"
          trigger={button}
        >
          <div className="pb-6">
            <MoreMenuContent onNavigate={close} onOpenTheme={openTheme} />
          </div>
        </AppDrawer>
      ) : (
        button
      )}
      <ThemePicker open={themeOpen} onOpenChange={setThemeOpen} />
    </>
  );
};
