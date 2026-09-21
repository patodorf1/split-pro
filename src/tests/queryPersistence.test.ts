import {
  EAGER_RESTORE_MAX_SIZE,
  PERSISTED_CACHE_MAX_AGE_MS,
  type PersistedMeta,
  buildCacheBuster,
  entryKey,
  getOptimisticOwner,
  getTrpcPath,
  isOwnedBy,
  isPersistablePath,
  parsePersistedEntry,
  parsePersistedMeta,
  shouldPersistQuery,
  splitEntriesForRestore,
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

const makeCache = (overrides: Partial<PersistedMeta> = {}): PersistedMeta => ({
  buster: BUSTER,
  timestamp: NOW - 60_000,
  owner: { user: { id: 1 }, expires: new Date(NOW + 24 * 60 * 60 * 1000).toISOString() },
  entries: {
    small: { size: 800, savedAt: NOW - 60_000 },
    big: { size: 2_000_000, savedAt: NOW - 60_000 },
  },
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

describe('parsePersistedMeta', () => {
  it('should accept a fresh index from this build', () => {
    const meta = parsePersistedMeta(makeCache(), { buster: BUSTER, now: NOW });

    expect(meta?.owner.user.id).toBe(1);
    expect(Object.keys(meta?.entries ?? {})).toEqual(['small', 'big']);
  });

  it('should discard an index from another build (buster)', () => {
    const cache = makeCache({ buster: buildCacheBuster('old-build') });

    expect(parsePersistedMeta(cache, { buster: BUSTER, now: NOW })).toBeNull();
  });

  it('should discard an index older than 7 days', () => {
    const fresh = makeCache({ timestamp: NOW - PERSISTED_CACHE_MAX_AGE_MS + 1000 });
    const stale = makeCache({ timestamp: NOW - PERSISTED_CACHE_MAX_AGE_MS - 1000 });

    expect(parsePersistedMeta(fresh, { buster: BUSTER, now: NOW })).not.toBeNull();
    expect(parsePersistedMeta(stale, { buster: BUSTER, now: NOW })).toBeNull();
  });

  it('should discard an index dated in the future', () => {
    const cache = makeCache({ timestamp: NOW + 24 * 60 * 60 * 1000 });

    expect(parsePersistedMeta(cache, { buster: BUSTER, now: NOW })).toBeNull();
  });

  it('should drop single entries that expired or are broken', () => {
    const meta = parsePersistedMeta(
      {
        ...makeCache(),
        entries: {
          ok: { size: 10, savedAt: NOW - 1000 },
          old: { size: 10, savedAt: NOW - PERSISTED_CACHE_MAX_AGE_MS - 1000 },
          negative: { size: -1, savedAt: NOW },
          broken: 'x',
        },
      },
      { buster: BUSTER, now: NOW },
    );

    expect(Object.keys(meta?.entries ?? {})).toEqual(['ok']);
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
    { ...makeCache(), owner: { user: { id: 1 } } },
    { ...makeCache(), owner: null },
    { ...makeCache(), entries: 'nope' },
  ])('should reject malformed input %#', (value) => {
    expect(parsePersistedMeta(value, { buster: BUSTER, now: NOW })).toBeNull();
  });
});

describe('parsePersistedEntry', () => {
  const query = {
    queryKey: trpcKey('stats.monthlySummary'),
    queryHash: 'h',
    state: { data: { total: 10n }, dataUpdatedAt: NOW, status: 'success' },
  };

  it('should accept one dehydrated query', () => {
    const state = parsePersistedEntry({ mutations: [], queries: [query] });

    expect(state?.queries).toHaveLength(1);
    expect(state?.mutations).toEqual([]);
  });

  it('should never bring mutations back', () => {
    const state = parsePersistedEntry({ mutations: [{ state: {} }], queries: [query] });

    expect(state?.mutations).toEqual([]);
  });

  it.each([
    null,
    'x',
    { queries: [] },
    { queries: [query, query] },
    { queries: [{ ...query, queryHash: 3 }] },
    { queries: [{ ...query, state: null }] },
  ])('should reject a broken entry %#', (value) => {
    expect(parsePersistedEntry(value)).toBeNull();
  });
});

describe('splitEntriesForRestore', () => {
  it('should restore small queries at boot and big ones on demand', () => {
    expect(splitEntriesForRestore(makeCache().entries)).toEqual({
      eager: ['small'],
      lazy: ['big'],
    });
  });

  it('should treat the limit itself as small', () => {
    const entries = { edge: { size: EAGER_RESTORE_MAX_SIZE, savedAt: NOW } };

    expect(splitEntriesForRestore(entries).eager).toEqual(['edge']);
  });
});

describe('entryKey', () => {
  it('should namespace entries under the index key', () => {
    expect(entryKey('abc')).toBe('casa.queryCache:abc');
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
