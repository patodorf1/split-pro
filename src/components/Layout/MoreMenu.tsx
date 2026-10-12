import {
  ChartPieIcon,
  FolderOpenIcon,
  ListIcon,
  ListTodoIcon,
  type LucideIcon,
  MenuIcon,
  PaletteIcon,
  RefreshCcwDotIcon,
  SirenIcon,
  UserCircleIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { ThemePicker } from '~/components/Theme/ThemePicker';
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
 * "Más" en la barra de abajo (☰): no cambia de pantalla, despliega el menú justo arriba de la
 * barra, que sigue a la vista. El mismo botón lo abre y lo cierra; tocar afuera también lo cierra.
 * Tema cierra el menú y abre los temas.
 */
export const MoreMenuNavItem: React.FC<{ title: string; isActive: boolean }> = ({
  title,
  isActive,
}) => {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const isClient = useIsClient();

  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);
  const openTheme = useCallback(() => {
    setOpen(false);
    setThemeOpen(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => 'Escape' === e.key && setOpen(false);
    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const highlighted = isActive || open;
  const Icon = open ? XIcon : MenuIcon;

  return (
    <>
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        onClick={toggle}
        className="flex min-w-0 flex-1 flex-col items-center justify-start gap-1.5 py-4"
      >
        <Icon className={clsx('h-6 w-6', highlighted ? 'text-primary' : 'text-muted-foreground')} />
        <span
          className={clsx(
            'text-center text-xs leading-tight',
            highlighted ? 'text-primary font-medium' : 'text-muted-foreground',
          )}
        >
          {title}
        </span>
      </button>

      {/* Crece desde el botón ☰, abajo a la derecha, justo arriba de la barra. */}
      <div
        inert={!open}
        aria-hidden={!open}
        className={clsx(
          'bg-background border-border absolute right-2 bottom-full mb-2 w-[min(22rem,calc(100vw-1rem))] origin-bottom-right rounded-3xl border p-4 shadow-[0_8px_32px_rgba(0,0,0,0.16)] transition-[transform,opacity] duration-200 ease-out',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-50 opacity-0',
        )}
      >
        <MoreMenuContent onNavigate={close} onOpenTheme={openTheme} />
      </div>

      {/* Fondo oscuro sobre la pantalla, debajo de la barra: tocarlo cierra el menú. */}
      {isClient
        ? createPortal(
            <div
              aria-hidden
              onClick={close}
              className={clsx(
                'fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 lg:hidden',
                open ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            />,
            document.body,
          )
        : null}

      <ThemePicker open={themeOpen} onOpenChange={setThemeOpen} />
    </>
  );
};
