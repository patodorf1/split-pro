import React, { useMemo } from 'react';

import { cn } from '~/lib/utils';

/**
 * Thin proportional bar. Purely decorative: the value it represents is always
 * spelled out next to it, so screen readers skip it.
 */
export const ProgressBar: React.FC<{ value: number; className?: string }> = ({
  value,
  className,
}) => {
  const style = useMemo(
    () => ({ width: `${Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))}%` }),
    [value],
  );

  return (
    <div
      aria-hidden="true"
      className={cn('bg-primary/15 h-1.5 w-full overflow-hidden rounded-full', className)}
    >
      <div className="bg-primary h-full rounded-full" style={style} />
    </div>
  );
};
