import { useTheme } from 'next-themes';
import Head from 'next/head';
import React, { useEffect, useState } from 'react';

import { isDarkTheme } from '~/lib/themes';

/** Fondo del tema Lavanda: es lo que se sirve en SSR, antes de leer el real. */
const FALLBACK_THEME_COLOR = 'rgb(240, 234, 223)';

/**
 * Normaliza el valor del token `--background` a un `rgb(...)` que entienda
 * cualquier navegador en `<meta name="theme-color">`.
 */
const readBackgroundColor = (): string | null => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();

  if (!raw) {
    return null;
  }

  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.color = raw;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);

  return resolved || raw;
};

/**
 * Mantiene el color de la barra del sistema (PWA / Chrome mobile) en sintonía
 * con el tema activo, para que no quede una franja negra en los temas claros.
 */
export const ThemeColorMeta: React.FC = () => {
  const { resolvedTheme } = useTheme();
  const [themeColor, setThemeColor] = useState(FALLBACK_THEME_COLOR);

  useEffect(() => {
    const color = readBackgroundColor();
    if (color) {
      setThemeColor(color);
    }
  }, [resolvedTheme]);

  return (
    <Head>
      <meta name="theme-color" content={themeColor} />
      <meta
        name="apple-mobile-web-app-status-bar-style"
        content={isDarkTheme(resolvedTheme) ? 'black' : 'default'}
      />
    </Head>
  );
};
