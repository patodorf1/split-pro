import { useTheme } from 'next-themes';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useState } from 'react';

import { AppDrawer } from '~/components/ui/drawer';
import { SectionLabel } from '~/components/ui/section-label';
import { Switch } from '~/components/ui/switch';
import { SYSTEM_THEME, THEME_IDS, type ThemeId } from '~/lib/themes';

import { ThemePreview } from './ThemePreview';

/**
 * Grilla de temas: una preview por tema más el modo Automático, que sigue el
 * esquema claro/oscuro del sistema. La preferencia la guarda next-themes en
 * localStorage, así que es por dispositivo.
 */
export const ThemePicker: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const isSystem = theme === SYSTEM_THEME;
  // En modo automático se marca el tema al que resolvió (Lavanda o Noche).
  const activeTheme = isSystem ? resolvedTheme : theme;

  const onSelectTheme = useCallback(
    (nextTheme: ThemeId) => {
      setTheme(nextTheme);
    },
    [setTheme],
  );

  const onToggleSystem = useCallback(
    (checked: boolean) => {
      setTheme(checked ? SYSTEM_THEME : (resolvedTheme ?? THEME_IDS[0]));
    },
    [resolvedTheme, setTheme],
  );

  const isSelected = useCallback(
    (id: ThemeId) => {
      if (isSystem) {
        // `resolvedTheme` puede ser el alias light/dark del modo automático.
        return (
          activeTheme === id ||
          (activeTheme === 'dark' && 'noche' === id) ||
          (activeTheme === 'light' && 'lavanda' === id)
        );
      }
      return theme === id;
    },
    [activeTheme, isSystem, theme],
  );

  return (
    <AppDrawer
      trigger={children}
      title={t('themes.title')}
      open={open}
      onOpenChange={setOpen}
      className="h-[85vh]"
    >
      <div className="flex flex-col gap-4 pb-4">
        <label className="card-surface flex cursor-pointer items-center justify-between gap-4 p-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t('themes.system.title')}</span>
            <span className="text-muted-foreground text-xs">{t('themes.system.description')}</span>
          </span>
          <Switch checked={isSystem} onCheckedChange={onToggleSystem} />
        </label>

        <div>
          <SectionLabel className="mb-2">{t('themes.section_label')}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {THEME_IDS.map((id) => (
              <ThemePreview
                key={id}
                theme={id}
                selected={isSelected(id)}
                onSelect={onSelectTheme}
              />
            ))}
          </div>
        </div>
      </div>
    </AppDrawer>
  );
};
