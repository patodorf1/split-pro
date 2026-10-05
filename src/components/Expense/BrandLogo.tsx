import type { IconType } from '@icons-pack/react-simple-icons';
// Cada ícono se importa por separado: traer el paquete entero suma miles de logos al bundle.
import SiAdidas from '@icons-pack/react-simple-icons/icons/SiAdidas.mjs';
import SiAirbnb from '@icons-pack/react-simple-icons/icons/SiAirbnb.mjs';
import SiApple from '@icons-pack/react-simple-icons/icons/SiApple.mjs';
import SiBookingdotcom from '@icons-pack/react-simple-icons/icons/SiBookingdotcom.mjs';
import SiBurgerking from '@icons-pack/react-simple-icons/icons/SiBurgerking.mjs';
import SiCarrefour from '@icons-pack/react-simple-icons/icons/SiCarrefour.mjs';
import SiClaude from '@icons-pack/react-simple-icons/icons/SiClaude.mjs';
import SiGoogle from '@icons-pack/react-simple-icons/icons/SiGoogle.mjs';
import SiHbomax from '@icons-pack/react-simple-icons/icons/SiHbomax.mjs';
import SiIkea from '@icons-pack/react-simple-icons/icons/SiIkea.mjs';
import SiKfc from '@icons-pack/react-simple-icons/icons/SiKfc.mjs';
import SiMcdonalds from '@icons-pack/react-simple-icons/icons/SiMcdonalds.mjs';
import SiMercadopago from '@icons-pack/react-simple-icons/icons/SiMercadopago.mjs';
import SiMovistar from '@icons-pack/react-simple-icons/icons/SiMovistar.mjs';
import SiNetflix from '@icons-pack/react-simple-icons/icons/SiNetflix.mjs';
import SiNike from '@icons-pack/react-simple-icons/icons/SiNike.mjs';
import SiOpenai from '@icons-pack/react-simple-icons/icons/SiOpenai.mjs';
import SiPuma from '@icons-pack/react-simple-icons/icons/SiPuma.mjs';
import SiShell from '@icons-pack/react-simple-icons/icons/SiShell.mjs';
import SiSpotify from '@icons-pack/react-simple-icons/icons/SiSpotify.mjs';
import SiStarbucks from '@icons-pack/react-simple-icons/icons/SiStarbucks.mjs';
import SiTarget from '@icons-pack/react-simple-icons/icons/SiTarget.mjs';
import SiUber from '@icons-pack/react-simple-icons/icons/SiUber.mjs';
import SiUniqlo from '@icons-pack/react-simple-icons/icons/SiUniqlo.mjs';
import SiWalmart from '@icons-pack/react-simple-icons/icons/SiWalmart.mjs';
import SiYoutube from '@icons-pack/react-simple-icons/icons/SiYoutube.mjs';
import SiZara from '@icons-pack/react-simple-icons/icons/SiZara.mjs';
import React, { useMemo } from 'react';

import { type Brand } from '~/lib/brands';
import { cn } from '~/lib/utils';

/** Íconos de simple-icons de las marcas que lo tienen (ver `icon` en `~/lib/brands`). */
const BRAND_ICONS: Record<string, IconType> = {
  netflix: SiNetflix,
  spotify: SiSpotify,
  youtube: SiYoutube,
  hbo: SiHbomax,
  apple: SiApple,
  google: SiGoogle,
  chatgpt: SiOpenai,
  claude: SiClaude,
  uber: SiUber,
  mcdonalds: SiMcdonalds,
  burgerking: SiBurgerking,
  kfc: SiKfc,
  starbucks: SiStarbucks,
  carrefour: SiCarrefour,
  walmart: SiWalmart,
  target: SiTarget,
  ikea: SiIkea,
  shell: SiShell,
  zara: SiZara,
  uniqlo: SiUniqlo,
  adidas: SiAdidas,
  nike: SiNike,
  puma: SiPuma,
  airbnb: SiAirbnb,
  booking: SiBookingdotcom,
  movistar: SiMovistar,
  mercadopago: SiMercadopago,
};

/** Tamaño de letra del logo simple según lo largo del texto, para que entre en el círculo. */
const labelScale = (label: string) => {
  if (2 >= label.length) {
    return 0.42;
  }
  if (3 === label.length) {
    return 0.32;
  }
  if (4 === label.length) {
    return 0.24;
  }
  return 0.19;
};

/**
 * Logo redondo de una marca: el ícono oficial en el color de la marca si está en simple-icons, o
 * un círculo del color de la marca con su nombre o sigla.
 */
export const BrandLogo: React.FC<{ brand: Brand; size?: number; className?: string }> = ({
  brand,
  size = 44,
  className,
}) => {
  const Icon = brand.icon ? BRAND_ICONS[brand.id] : undefined;
  const label = brand.label ?? brand.name.slice(0, 2);
  const circleStyle = useMemo(
    () => ({
      width: size,
      height: size,
      backgroundColor: brand.background,
      color: brand.foreground,
    }),
    [size, brand.background, brand.foreground],
  );
  const labelStyle = useMemo(
    () => ({ fontSize: Math.round(size * labelScale(label)) }),
    [size, label],
  );

  return (
    <span
      role="img"
      aria-label={brand.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/15',
        className,
      )}
      style={circleStyle}
    >
      {Icon ? (
        <Icon aria-hidden="true" title="" color={brand.foreground} size={Math.round(size * 0.52)} />
      ) : (
        <span
          aria-hidden="true"
          // Un poco hacia arriba: abajo a la derecha va la carita de quien pagó.
          className="-translate-y-[8%] leading-none font-extrabold tracking-tight select-none"
          style={labelStyle}
        >
          {label}
        </span>
      )}
    </span>
  );
};
