import { type GetServerSideProps } from 'next';

import { env } from '~/env';
import { LAST_ROUTE_COOKIE, readCookieValue, resolveStartDestination } from '~/lib/lastRoute';
import { withLocalePrefix } from '~/lib/startRoute';
import { getServerAuthSession } from '~/server/auth';

export default function Index() {
  return null;
}

/**
 * Arranque de la app ("/" es el `start_url` de la PWA): volvemos a la última
 * pantalla de navegación que usó ESTE dispositivo, leyendo la cookie del
 * recuerdo. Se resuelve en el servidor para que no haya parpadeo.
 *
 * La cookie se valida siempre contra la misma allowlist que la escribe: sólo
 * rutas internas relativas, así que nunca puede sacar al usuario del sitio.
 *
 * Sin sesión el recuerdo se ignora: el login sigue funcionando como siempre y
 * después de entrar se cae en `DEFAULT_HOMEPAGE`.
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const { req, res } = context;

  // La respuesta depende de una cookie del dispositivo: nunca se cachea.
  res.setHeader('Cache-Control', 'no-store, must-revalidate');

  const defaultHomepage = env.DEFAULT_HOMEPAGE ?? '/dashboard';
  const session = await getServerAuthSession(context);

  const destination = session
    ? resolveStartDestination(
        readCookieValue(req.headers.cookie, LAST_ROUTE_COOKIE),
        defaultHomepage,
      )
    : defaultHomepage;

  return {
    redirect: {
      /* Con el idioma adelante: una ruta sin idioma la vuelve a redirigir el
       * middleware, y cada salto es una ida y vuelta más al abrir la app. */
      destination: withLocalePrefix(destination, context.locale),
      /* Nunca `permanent`: un 308 queda cacheado en el navegador y el arranque
       * quedaría clavado en el destino viejo para siempre. */
      permanent: false,
    },
  };
};
