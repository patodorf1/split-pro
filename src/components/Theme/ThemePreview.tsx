import { Check } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React from 'react';

import { SectionLabel } from '~/components/ui/section-label';
import { cn } from '~/lib/utils';
import { type ThemeId } from '~/lib/themes';

interface ThemePreviewProps {
  theme: ThemeId;
  selected: boolean;
  onSelect: (theme: ThemeId) => void;
}

/**
 * Tarjetita de muestra de un tema. Se renderiza con `data-theme` propio, así que
 * los colores salen de los mismos tokens que usa la app: no hay paleta duplicada
 * en JS.
 */
export const ThemePreview: React.FC<ThemePreviewProps> = ({ theme, selected, onSelect }) => {
  const { t } = useTranslation();
  const onClick = React.useCallback(() => onSelect(theme), [onSelect, theme]);
  const name = t(`themes.names.${theme}`);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={name}
      className={cn(
        'rounded-card focus-visible:ring-ring flex flex-col gap-2 border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
        selected ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-accent',
      )}
    >
      <div
        data-theme={theme}
        className="bg-background rounded-card font-app overflow-hidden p-2"
        aria-hidden
      >
        <div className="card-surface flex flex-col gap-1.5 p-2.5">
          <SectionLabel>{t('themes.preview.label')}</SectionLabel>
          <p className="text-card-foreground text-base font-semibold">
            {t('themes.preview.amount')}
          </p>
          <div className="flex gap-1.5">
            <span className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-[10px] font-medium">
              {t('themes.preview.chip_one')}
            </span>
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
              {t('themes.preview.chip_two')}
            </span>
          </div>
          <div className="bg-primary-soft mt-1 h-1.5 w-full overflow-hidden rounded-full">
            <div className="bg-primary h-full w-3/5 rounded-full" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="truncate text-sm font-medium">{name}</span>
        {selected ? <Check className="text-primary size-4 shrink-0" /> : null}
      </div>
    </button>
  );
};
