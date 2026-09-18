import * as React from 'react';

import { cn } from '~/lib/utils';

/**
 * Etiqueta de sección del estilo base: chica, en mayúscula, con tracking y en el
 * color de acento del tema. Encabeza las tarjetas y los bloques de las pantallas.
 */
const SectionLabel = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} data-slot="section-label" className={cn('section-label', className)} {...props} />
));
SectionLabel.displayName = 'SectionLabel';

export { SectionLabel };
