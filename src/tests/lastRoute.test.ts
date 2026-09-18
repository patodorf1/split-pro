import {
  CLEAR_LAST_ROUTE_COOKIE,
  LAST_ROUTE_COOKIE,
  LAST_ROUTE_TTL_MS,
  isInternalPath,
  isRememberableRoute,
  isRememberedRoute,
  parseRememberedRoute,
  readCookieValue,
  resolveStartDestination,
  serializeRememberedRoute,
  toRememberedRoute,
} from '~/lib/lastRoute';

const NOW = new Date('2026-09-18T12:00:00Z').getTime();

describe('isRememberableRoute', () => {
  it.each([
    '/dashboard',
    '/balances',
    '/balances/12',
    '/balances/12/expenses/34',
    '/groups',
    '/groups/7',
    '/activity',
    '/shopping',
    '/stats',
    '/more',
    '/account',
    '/recurring',
  ])('should remember the navigation screen %s', (path) => {
    expect(isRememberableRoute(path)).toBe(true);
  });

  it.each([
    '/add',
    '/add?groupId=3',
    '/',
    '/home',
    '/auth/signin',
    '/auth/signin?callbackUrl=/dashboard',
    '/api/trpc/user.me',
    '/expenses/42',
    '/import-splitwise',
    '/join-group',
    '/privacy',
    '/terms',
    '/404',
    '/dashboards-fake',
    '/groups/7/edit',
    '/groups/7/edit/split',
  ])('should not remember %s', (path) => {
    expect(isRememberableRoute(path)).toBe(false);
  });

  it('should ignore query string and hash when deciding', () => {
    expect(isRememberableRoute('/groups/7?tab=expenses#top')).toBe(true);
    expect(toRememberedRoute('/groups/7?tab=expenses#top')).toBe('/groups/7');
  });

  it('should treat a trailing slash as the same screen', () => {
    expect(toRememberedRoute('/groups/')).toBe('/groups');
  });
});

describe('isInternalPath (anti open-redirect)', () => {
  it.each([
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    'https://evil.com',
    'http://evil.com/dashboard',
    '//evil.com/dashboard',
    // oxlint-disable-next-line no-script-url -- es justamente el caso a rechazar
    'javascript:alert(1)',
    '/dashboard\nLocation: https://evil.com',
    '/dashboard\r\nSet-Cookie: a=b',
    'dashboard',
    '',
  ])('should reject %j', (path) => {
    expect(isInternalPath(path)).toBe(false);
    expect(isRememberableRoute(path)).toBe(false);
  });

  it('should accept plain internal paths', () => {
    expect(isInternalPath('/dashboard')).toBe(true);
    expect(isInternalPath('/groups/7')).toBe(true);
  });
});

describe('serializeRememberedRoute / parseRememberedRoute', () => {
  it('should round-trip an allowed route', () => {
    const value = serializeRememberedRoute('/groups/7', NOW);

    expect(value).toBe(`${NOW}|%2Fgroups%2F7`);
    expect(parseRememberedRoute(value, NOW)).toBe('/groups/7');
  });

  it('should refuse to serialize a route outside the allowlist', () => {
    expect(serializeRememberedRoute('/add', NOW)).toBeNull();
    expect(serializeRememberedRoute('https://evil.com', NOW)).toBeNull();
  });

  it('should still be valid just under the 7 day limit', () => {
    const value = serializeRememberedRoute('/shopping', NOW)!;

    expect(parseRememberedRoute(value, NOW + LAST_ROUTE_TTL_MS - 1000)).toBe('/shopping');
  });

  it('should expire after 7 days', () => {
    const value = serializeRememberedRoute('/shopping', NOW)!;

    expect(parseRememberedRoute(value, NOW + LAST_ROUTE_TTL_MS + 1000)).toBeNull();
  });

  it('should reject a timestamp far in the future', () => {
    expect(parseRememberedRoute(`${NOW + LAST_ROUTE_TTL_MS * 2}|%2Fshopping`, NOW)).toBeNull();
  });

  it.each([
    '',
    'garbage',
    '|%2Fshopping',
    'abc|%2Fshopping',
    '0|%2Fshopping',
    `${NOW}|%E0%A4%A`,
    `${NOW}|%2Fadd`,
    `${NOW}|%2F%2Fevil.com`,
    `${NOW}|https%3A%2F%2Fevil.com`,
    `${NOW}|%2Fapi%2Ftrpc%2Fuser.me`,
  ])('should reject the tampered value %j', (raw) => {
    expect(parseRememberedRoute(raw, NOW)).toBeNull();
  });
});

describe('readCookieValue', () => {
  it('should find the cookie among others', () => {
    const header = `NEXT_LOCALE=es-AR; ${LAST_ROUTE_COOKIE}=${NOW}|%2Fshopping; other=1`;

    expect(readCookieValue(header, LAST_ROUTE_COOKIE)).toBe(`${NOW}|%2Fshopping`);
  });

  it('should not match a cookie whose name merely ends the same', () => {
    expect(readCookieValue(`not.${LAST_ROUTE_COOKIE}=x`, LAST_ROUTE_COOKIE)).toBeNull();
  });

  it('should return null without a cookie header', () => {
    expect(readCookieValue(undefined, LAST_ROUTE_COOKIE)).toBeNull();
    expect(readCookieValue('', LAST_ROUTE_COOKIE)).toBeNull();
  });
});

describe('resolveStartDestination', () => {
  it('should send the user back to the remembered screen', () => {
    const value = serializeRememberedRoute('/shopping', NOW)!;

    expect(resolveStartDestination(value, '/dashboard', NOW)).toBe('/shopping');
  });

  it('should fall back to the default homepage without a cookie', () => {
    expect(resolveStartDestination(null, '/dashboard', NOW)).toBe('/dashboard');
  });

  it('should fall back to the default homepage when the cookie expired', () => {
    const value = serializeRememberedRoute('/shopping', NOW)!;

    expect(resolveStartDestination(value, '/dashboard', NOW + LAST_ROUTE_TTL_MS + 1)).toBe(
      '/dashboard',
    );
  });

  it.each([
    `${NOW}|%2F%2Fevil.com`,
    `${NOW}|https%3A%2F%2Fevil.com`,
    `${NOW}|%2Fapi%2Fx`,
    `${NOW}|%2Fadd`,
    'evil.com',
  ])('should never leave the site with the tampered cookie %j', (raw) => {
    const destination = resolveStartDestination(raw, '/dashboard', NOW);

    expect(destination).toBe('/dashboard');
  });

  it('should ignore a default homepage that is not an internal path', () => {
    expect(resolveStartDestination(null, 'https://evil.com', NOW)).toBe('/dashboard');
  });

  it('should honour a custom default homepage', () => {
    expect(resolveStartDestination(null, '/balances', NOW)).toBe('/balances');
  });
});

describe('isRememberedRoute', () => {
  it('should detect that the cookie points at this screen', () => {
    const value = serializeRememberedRoute('/groups/7', NOW)!;

    expect(isRememberedRoute(value, '/groups/7', NOW)).toBe(true);
    expect(isRememberedRoute(value, '/groups/8', NOW)).toBe(false);
    expect(isRememberedRoute(null, '/groups/7', NOW)).toBe(false);
  });
});

describe('CLEAR_LAST_ROUTE_COOKIE', () => {
  it('should expire the cookie on the whole site', () => {
    expect(CLEAR_LAST_ROUTE_COOKIE).toContain(`${LAST_ROUTE_COOKIE}=;`);
    expect(CLEAR_LAST_ROUTE_COOKIE).toContain('Path=/');
    expect(CLEAR_LAST_ROUTE_COOKIE).toContain('Max-Age=0');
  });
});
