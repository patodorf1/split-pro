import { LAST_ROUTE_TTL_MS } from '~/lib/lastRoute';
import { resolveStartFromMirror, serializeStartMirror, withLocalePrefix } from '~/lib/startRoute';

const NOW = new Date('2026-09-21T12:00:00Z').getTime();
const LOCALES = ['default', 'en', 'es', 'es-AR', 'pt-BR'];
const OPTIONS = { defaultHomepage: '/dashboard', locales: LOCALES, now: NOW };

const remembered = (path: string, at: number = NOW - 1000) => `${at}|${encodeURIComponent(path)}`;

describe('withLocalePrefix', () => {
  it('should prefix the locale', () => {
    expect(withLocalePrefix('/dashboard', 'es-AR')).toBe('/es-AR/dashboard');
    expect(withLocalePrefix('/groups/7', 'pt-BR')).toBe('/pt-BR/groups/7');
  });

  it('should map the root to the bare locale (no trailing slash)', () => {
    expect(withLocalePrefix('/', 'es-AR')).toBe('/es-AR');
  });

  it('should not prefix twice', () => {
    expect(withLocalePrefix('/es-AR/dashboard', 'es-AR')).toBe('/es-AR/dashboard');
    expect(withLocalePrefix('/es-AR', 'es-AR')).toBe('/es-AR');
  });

  it.each([undefined, null, '', 'default', '../x', 'es_AR', 'es-AR/evil', '//evil.com'])(
    'should leave the path alone for locale %p',
    (locale) => {
      expect(withLocalePrefix('/dashboard', locale)).toBe('/dashboard');
    },
  );
});

describe('resolveStartFromMirror', () => {
  it('should resolve the remembered screen with its locale', () => {
    const raw = serializeStartMirror({ route: remembered('/shopping'), locale: 'es-AR' });

    expect(resolveStartFromMirror(raw, OPTIONS)).toBe('/es-AR/shopping');
  });

  it('should fall back to the default homepage when the memory expired', () => {
    const raw = serializeStartMirror({
      route: remembered('/shopping', NOW - LAST_ROUTE_TTL_MS - 1000),
      locale: 'es-AR',
    });

    expect(resolveStartFromMirror(raw, OPTIONS)).toBe('/es-AR/dashboard');
  });

  it('should fall back to the default homepage for routes outside the allowlist', () => {
    const raw = serializeStartMirror({ route: remembered('//evil.com'), locale: 'es-AR' });

    expect(resolveStartFromMirror(raw, OPTIONS)).toBe('/es-AR/dashboard');
  });

  it.each(['fr', 'default', '', 'es-AR/../../x'])(
    'should give up (let the server decide) with unknown locale %p',
    (locale) => {
      const raw = serializeStartMirror({ route: remembered('/groups'), locale });

      expect(resolveStartFromMirror(raw, OPTIONS)).toBeNull();
    },
  );

  it.each([undefined, null, '', 'not json', 'null', '42', '{"route":"x"}'])(
    'should give up with a missing or broken mirror %p',
    (raw) => {
      expect(resolveStartFromMirror(raw, OPTIONS)).toBeNull();
    },
  );
});
