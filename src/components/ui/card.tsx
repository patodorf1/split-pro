import * as React from 'react';

import { cn } from '~/lib/utils';

/**
 * Tarjeta del estilo base: superficie del token `card`, borde fino del token
 * `border` y radio generoso (16px). Es la caja que usan todas las pantallas
 * para agrupar contenido.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="card" className={cn('card-surface p-4', className)} {...props} />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn('mb-3 flex items-center justify-between gap-2', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  ),
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardContent };
