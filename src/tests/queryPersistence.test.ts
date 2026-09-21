import { type DehydratedState } from '@tanstack/react-query';

import {
  PERSISTED_CACHE_MAX_AGE_MS,
  type PersistedCache,
  buildCacheBuster,
  getOptimisticOwner,
  getTrpcPath,
  isOwnedBy,
  isPersistablePath,
  parsePersistedCache,
  shouldPersistQuery,
} from '~/lib/queryPersistence';

const NOW = new Date('2026-09-21T12:00:00Z').getTime();
const BUSTER = buildCacheBuster('build-abc');

const trpcKey = (path: string, input?: unknown) => [
  path.split('.'),
  { input, type: 'query' as const },
];

const successQuery = (path: string, data: unknown = { ok: true }) => ({
  queryKey: trpcKey(path),
  state: { status: 'success', data },
});

const makeCache = (overrides: Partial<PersistedCache> = {}): PersistedCache => ({
  buster: BUSTER,
  timestamp: NOW - 60_000,
  owner: { user: { id: 1 }, expires: new Date(NOW + 24 * 60 * 60 * 1000).toISOString() },
  clientState: { mutations: [], queries: [] } as DehydratedState,
  ...overrides,
});

describe('buildCacheBuster', () => {
  it('should change with the build id', () => {
    expect(buildCacheBuster('a')).not.toBe(buildCacheBuster('b'));
  });

  it('should fall back to a stable dev value without build id', () => {
    expect(buildCacheBuster(undefined)).toBe(buildCacheBuster(null));
    expect(buildCacheBuster('')).toBe(buildCacheBuster(null));
  });
});

describe('getTrpcPath', () => {
  it('should read the tRPC v11 query key', () => {
    expect(getTrpcPath(trpcKey('stats.monthlySummary', { year: 2026 }))).toBe(
      'stats.monthlySummary',
    );
  });

  it.each([[null], ['stats'], [[]], [[[]]], [[['stats', 3]]], [[['', 'me']]]])(
    'should reject a key that is not tRPC: %p',
    (key) => {
      expect(getTrpcPath(key)).toBeNull();
    },
  );
});

describe('isPersistablePath', () => {
  it.each([
    'stats.monthlySummary',
    'stats.homeBalances',
    'stats.recentActivity',
    'group.getAllGroupsWithBalances',
    'group.getGroupDetails',
    'expense.getGroupExpenses',
    'expense.getRecurringExpenses',
    'shopping.getList',
    'user.me',
    'user.getFriends',
  ])('should persist everyday screens: %s', (path) => {
    expect(isPersistablePath(path)).toBe(true);
  });

  it.each([
    // Sesión / cuenta / notificaciones
    'user.getWebPushPublicKey',
    'user.getUserDetails',
    'user.downloadData',
    // Bancos: sensible
    'bankTransactions.getTransactions',
    'bankTransactions.getInstitutions',
    // Efímeros
    'expense.getCurrencyRate',
    'expense.getBatchCurrencyRates',
    // Routers nuevos o desconocidos: afuera por defecto
    'documents.list',
    'auth.session',
  ])('should never persist %s', (path) => {
    expect(isPersistablePath(path)).toBe(false);
  });

  it('should reject a missing path', () => {
    expect(isPersistablePath(null)).toBe(false);
  });
});

describe('shouldPersistQuery', () => {
  it('should persist successful everyday queries', () => {
    expect(shouldPersistQuery(successQuery('stats.monthlySummary'))).toBe(true);
  });

  it('should not persist pending or failed queries', () => {
    expect(
      shouldPersistQuery({
        queryKey: trpcKey('stats.monthlySummary'),
        state: { status: 'pending' },
      }),
    ).toBe(false);
    expect(
      shouldPersistQuery({
        queryKey: trpcKey('stats.monthlySummary'),
        state: { status: 'error', data: undefined },
      }),
    ).toBe(false);
  });

  it('should not persist excluded procedures even when successful', () => {
    expect(shouldPersistQuery(successQuery('bankTransactions.getTransactions'))).toBe(false);
    expect(shouldPersistQuery(successQuery('user.getWebPushPublicKey', 'key'))).toBe(false);
  });

  it('should not persist non-tRPC queries', () => {
    expect(
      shouldPersistQuery({ queryKey: ['session'], state: { status: 'success', data: 1 } }),
    ).toBe(false);
  });
});

describe('parsePersistedCache', () => {
  it('should accept a fresh cache from this build', () => {
    expect(parsePersistedCache(makeCache(), { buster: BUSTER, now: NOW })).not.toBeNull();
  });

  it('should discard a cache from another build (buster)', () => {
    const cache = makeCache({ buster: buildCacheBuster('old-build') });

    expect(parsePersistedCache(cache, { buster: BUSTER, now: NOW })).toBeNull();
  });

  it('should discard a cache older than 7 days', () => {
    const fresh = makeCache({ timestamp: NOW - PERSISTED_CACHE_MAX_AGE_MS + 1000 });
    const stale = makeCache({ timestamp: NOW - PERSISTED_CACHE_MAX_AGE_MS - 1000 });

    expect(parsePersistedCache(fresh, { buster: BUSTER, now: NOW })).not.toBeNull();
    expect(parsePersistedCache(stale, { buster: BUSTER, now: NOW })).toBeNull();
  });

  it('should discard a cache dated in the future', () => {
    const cache = makeCache({ timestamp: NOW + 24 * 60 * 60 * 1000 });

    expect(parsePersistedCache(cache, { buster: BUSTER, now: NOW })).toBeNull();
  });

  it.each([
    undefined,
    null,
    '',
    'a string',
    42,
    { buster: BUSTER, timestamp: NOW },
    { ...makeCache(), timestamp: 'yesterday' },
    { ...makeCache(), owner: { user: { id: 'x' }, expires: '' } },
    { ...makeCache(), owner: null },
    { ...makeCache(), clientState: { queries: 'nope' } },
  ])('should reject malformed input %#', (value) => {
    expect(parsePersistedCache(value, { buster: BUSTER, now: NOW })).toBeNull();
  });
});

describe('getOptimisticOwner', () => {
  it('should return the owner while the saved session is still valid', () => {
    expect(getOptimisticOwner(makeCache(), NOW)?.user.id).toBe(1);
  });

  it('should not paint with an expired saved session', () => {
    const cache = makeCache({
      owner: { user: { id: 1 }, expires: new Date(NOW - 1000).toISOString() },
    });

    expect(getOptimisticOwner(cache, NOW)).toBeNull();
  });

  it('should not paint with a broken expiry date or no cache', () => {
    expect(
      getOptimisticOwner(makeCache({ owner: { user: { id: 1 }, expires: 'x' } }), NOW),
    ).toBeNull();
    expect(getOptimisticOwner(null, NOW)).toBeNull();
  });
});

describe('isOwnedBy', () => {
  it('should only match the same user', () => {
    expect(isOwnedBy(makeCache(), 1)).toBe(true);
    expect(isOwnedBy(makeCache(), 2)).toBe(false);
    expect(isOwnedBy(makeCache(), undefined)).toBe(false);
    expect(isOwnedBy(null, 1)).toBe(false);
  });
});
