import { Avatar as AvatarPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '~/lib/utils';
import { toImageSrc } from '~/utils/imageUpload';

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square h-full w-full', className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'bg-muted flex h-full w-full items-center justify-center rounded-full',
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

/**
 * Casa: colores de la inicial cuando la persona (o el grupo) no tiene foto. Tonos medios con letra
 * blanca, que se leen bien en los temas claros y en los oscuros.
 */
const INITIAL_COLORS = ['#7C6BC4', '#2F9E8F', '#D9785A', '#C2577A', '#4C86C6', '#B58A2E'];

/** Siempre el mismo color para la misma persona: sale de su id (o de su mail o nombre). */
export const avatarColor = (key: string | number) => {
  if ('number' === typeof key) {
    return INITIAL_COLORS[Math.abs(key) % INITIAL_COLORS.length]!;
  }

  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  }

  return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length]!;
};

/** Primera letra visible del nombre (o del mail), en mayúscula. */
export const avatarInitial = (label: string) => {
  const first = Array.from(label.trim())[0];

  return first ? first.toLocaleUpperCase() : '?';
};

const EntityAvatar: React.FC<{
  entity?: {
    id?: number | string | null;
    name?: string | null;
    image?: string | null;
    email?: string | null;
  } | null;
  size?: number;
  className?: string;
}> = ({ entity, size, className }) => {
  const pixels = size ?? 40;
  const avatarSize = React.useMemo(
    () => ({
      width: pixels,
      height: pixels,
    }),
    [pixels],
  );

  const label = entity?.name ?? entity?.email ?? '';
  // Personas (tienen mail): por id, así nunca cambia. Grupos: por nombre, en otra "familia" de
  // claves para no repetir siempre el color de la persona con el mismo número.
  const colorKey = entity?.email ? (entity.id ?? entity.email) : `group:${entity?.name ?? ''}`;
  const fallbackStyle = React.useMemo(
    () => ({
      backgroundColor: avatarColor(colorKey),
      fontSize: Math.max(9, Math.round(pixels * 0.44)),
    }),
    [colorKey, pixels],
  );

  return (
    <Avatar style={avatarSize} className={className}>
      <AvatarImage
        src={entity?.image ? toImageSrc(entity.image) : undefined}
        alt={label}
        className="object-cover"
      />
      <AvatarFallback
        className="leading-none font-semibold text-white select-none"
        style={fallbackStyle}
      >
        {avatarInitial(label)}
      </AvatarFallback>
    </Avatar>
  );
};

export { Avatar, AvatarImage, AvatarFallback, EntityAvatar };
