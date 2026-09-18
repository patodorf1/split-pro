import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

import { isDarkTheme } from '~/lib/themes';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Sonner pinta sus toasts con sus propias variables CSS, que ganan por orden de
 * hoja de estilos a cualquier clase de Tailwind. Por eso el tema se aplica
 * mapeando esas variables a los tokens de la app.
 */
const themeVariables = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius-card, 1rem)',
  '--success-bg': 'var(--popover)',
  '--success-text': 'var(--positive)',
  '--success-border': 'var(--border)',
  '--error-bg': 'var(--popover)',
  '--error-text': 'var(--destructive)',
  '--error-border': 'var(--border)',
  '--info-bg': 'var(--popover)',
  '--info-text': 'var(--popover-foreground)',
  '--info-border': 'var(--border)',
  '--warning-bg': 'var(--popover)',
  '--warning-text': 'var(--negative)',
  '--warning-border': 'var(--border)',
} as React.CSSProperties;

const themedClassNames: NonNullable<ToasterProps['toastOptions']>['classNames'] = {
  description: 'group-[.toast]:text-muted-foreground',
  actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
  cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
};

const Toaster = ({ toastOptions, style, ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      // Sonner sólo entiende light/dark: los temas propios se mapean a uno de los dos.
      theme={isDarkTheme(resolvedTheme) ? 'dark' : 'light'}
      className="toaster group"
      {...props}
      style={{ ...themeVariables, ...style }}
      toastOptions={{
        ...toastOptions,
        classNames: { ...themedClassNames, ...toastOptions?.classNames },
      }}
    />
  );
};

export { Toaster };
