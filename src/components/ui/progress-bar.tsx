import * as React from 'react';

import { cn } from '~/lib/utils';

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Porcentaje completado, de 0 a 100. */
  value: number;
  /** Color de la barra. Por defecto el acento del tema. */
  tone?: 'primary' | 'positive' | 'negative';
  label?: string;
}

const TONE_CLASSES: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  primary: 'bg-primary',
  positive: 'bg-positive',
  negative: 'bg-negative',
};

const TRACK_CLASSES: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  primary: 'bg-primary-soft',
  positive: 'bg-positive-soft',
  negative: 'bg-negative-soft',
};

/**
 * Barra de progreso fina del estilo base: pista en un tono suave del acento y
 * relleno en el acento pleno.
 */
const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  tone = 'primary',
  label,
  className,
  ...props
}) => {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full', TRACK_CLASSES[tone], className)}
      {...props}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', TONE_CLASSES[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

export { ProgressBar };
