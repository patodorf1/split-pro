import React from 'react';

import { cn } from '~/lib/utils';

interface BlockProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * Rounded surface used by every block of the home dashboard and the stats page.
 * Colors come from semantic tokens only, so themes can restyle it freely.
 */
export const DashboardCard: React.FC<BlockProps> = ({ className, children }) => (
  <section className={cn('bg-card border-border rounded-2xl border px-4 py-4', className)}>
    {children}
  </section>
);

/** Small uppercase caption with wide tracking, in the accent color. */
export const SectionLabel: React.FC<BlockProps> = ({ className, children }) => (
  <h2 className={cn('text-primary text-xs font-semibold tracking-[0.12em] uppercase', className)}>
    {children}
  </h2>
);

export const CardHeader: React.FC<BlockProps> = ({ className, children }) => (
  <div className={cn('flex items-center justify-between gap-2', className)}>{children}</div>
);
