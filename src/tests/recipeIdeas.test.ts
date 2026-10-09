import { DailyLimiter, buildIdeasMessages, parseIdeasResponse } from '~/lib/recipeIdeas';
import { stockKey } from '~/lib/stock';
import {
  IdeasFailedError,
  IdeasLimitError,
  IdeasUnavailableError,
  suggestRecipeIdeas,
} from '~/server/recipes/ideas';

const idea = (overrides: Record<string, unknown> = {}) => ({
  title: 'Bife con mostaza',
  kind: 'PROTEIN',
  description: 'Bife sellado con costra de mostaza.',
  yield: 'Para 2 personas',
  ingredients: ['Bife americano', 'Granos de mostaza'],
  steps: '1. Sellar\n- 1 cucharita de sal\nFuego fuerte.',
  ...overrides,
});

const response = (ideas: unknown[]) => JSON.stringify({ ideas });

describe('buildIdeasMessages', () => {
  const stock = [
    { name: 'Trucha', note: null, section: 'FREEZER' as const },
    { name: 'Atún', note: '3 latas', section: 'PANTRY' as const },
    { name: 'Papel higiénico', note: null, section: 'CLEANING' as const },
  ];

  it('lists the stock by section, without cleaning products', () => {
    const [, user] = buildIdeasMessages({ stock, avoidTitles: [] });

    expect(user!.content).toContain('Freezer: Trucha.');
    expect(user!.content).toContain('Alacena: Atún (3 latas).');
    expect(user!.content).not.toContain('Papel');
  });

  it('asks for the filter kind, or for different kinds with no filter', () => {
    expect(buildIdeasMessages({ kind: 'SALAD', stock, avoidTitles: [] })[1]!.content).toContain(
      'tipo SALAD',
    );
    expect(buildIdeasMessages({ stock, avoidTitles: [] })[1]!.content).toContain(
      'de tipos distintos',
    );
  });

  it('names the titles to avoid', () => {
    const [, user] = buildIdeasMessages({ stock, avoidTitles: ['Milanesas', 'Guiso'] });

    expect(user!.content).toContain('Milanesas, Guiso');
  });
});

describe('parseIdeasResponse', () => {
  it('reads the ideas, also wrapped in a code block', () => {
    const ideas = parseIdeasResponse(`\`\`\`json\n${response([idea()])}\n\`\`\``);

    expect(ideas).toEqual([
      {
        title: 'Bife con mostaza',
        kind: 'PROTEIN',
        description: 'Bife sellado con costra de mostaza.',
        yieldText: 'Para 2 personas',
        ingredients: ['Bife americano', 'Granos de mostaza'],
        body: '1. Sellar\n- 1 cucharita de sal\nFuego fuerte.',
      },
    ]);
  });

  it('forces the filter kind and falls back to MAIN for unknown kinds', () => {
    expect(parseIdeasResponse(response([idea()]), 'SALAD')[0]!.kind).toBe('SALAD');
    expect(parseIdeasResponse(response([idea({ kind: 'POSTRE' })]))[0]!.kind).toBe('MAIN');
  });

  it('accepts ingredients as text and drops ideas it cannot save', () => {
    const ideas = parseIdeasResponse(
      response([
        idea({ title: 'Ensalada', ingredients: 'lechuga, palta' }),
        idea({ title: 'Sin pasos', steps: '' }),
        idea({ title: 'Sin ingredientes', ingredients: [] }),
        { title: 'Roto' },
      ]),
    );

    expect(ideas.map((item) => item.title)).toEqual(['Ensalada']);
    expect(ideas[0]!.ingredients).toEqual(['lechuga', 'palta']);
  });

  it('keeps two ideas at most, without repeated titles', () => {
    const ideas = parseIdeasResponse(
      response([
        idea(),
        idea({ title: 'bife con mostaza' }),
        idea({ title: 'B' }),
        idea({ title: 'C' }),
      ]),
    );

    expect(ideas.map((item) => item.title)).toEqual(['Bife con mostaza', 'B']);
  });

  it('drops the stock quantity from ingredient names', () => {
    const [parsed] = parseIdeasResponse(
      response([idea({ ingredients: ['Lentejas (1 paquete)', 'Tomate triturado (2 cajas)'] })]),
    );

    expect(parsed!.ingredients).toEqual(['Lentejas', 'Tomate triturado']);
  });

  it('returns nothing for text that is not JSON', () => {
    expect(parseIdeasResponse('Perdón, no puedo.')).toEqual([]);
  });
});

describe('DailyLimiter', () => {
  it('counts per group and resets the next day in Argentina', () => {
    const limiter = new DailyLimiter(2);
    const morning = new Date('2026-10-09T12:00:00Z');

    expect(limiter.take(1, morning)).toBe(true);
    expect(limiter.take(1, morning)).toBe(true);
    expect(limiter.take(1, morning)).toBe(false);
    expect(limiter.take(2, morning)).toBe(true);
    // 23:30 en Argentina sigue siendo el mismo día.
    expect(limiter.take(1, new Date('2026-10-10T02:30:00Z'))).toBe(false);
    expect(limiter.take(1, new Date('2026-10-10T03:30:00Z'))).toBe(true);
  });
});

describe('suggestRecipeIdeas', () => {
  const makeDb = () => ({
    stockItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          name: 'Bife americano',
          note: null,
          key: stockKey('Bife americano'),
          section: 'FREEZER',
        },
      ]),
    },
    recipe: { findMany: jest.fn().mockResolvedValue([{ title: 'Milanesas' }]) },
  });

  const okFetch = (content: string) =>
    jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    });

  const call = (deps: Parameters<typeof suggestRecipeIdeas>[2], db = makeDb()) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- base falsa de prueba
    suggestRecipeIdeas(db as never, { groupId: 1, kind: 'PROTEIN', avoidTitles: ['Guiso'] }, deps);

  it('asks OpenRouter avoiding saved and seen recipes, and marks what is missing', async () => {
    const fetch = okFetch(response([idea()]));
    const ideas = await call({ apiKey: 'k', fetch, limiter: new DailyLimiter(5) });

    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.missing).toEqual(['Granos de mostaza']);

    const [, init] = fetch.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(init.body).toContain('Milanesas, Guiso');
  });

  it('fails clearly without key, over the limit, or with an unreadable answer', async () => {
    await expect(call({ apiKey: undefined })).rejects.toBeInstanceOf(IdeasUnavailableError);
    await expect(
      call({ apiKey: 'k', fetch: okFetch(''), limiter: new DailyLimiter(0) }),
    ).rejects.toBeInstanceOf(IdeasLimitError);
    await expect(
      call({ apiKey: 'k', fetch: okFetch('nada'), limiter: new DailyLimiter(5) }),
    ).rejects.toBeInstanceOf(IdeasFailedError);
    await expect(
      call({
        apiKey: 'k',
        fetch: jest.fn().mockResolvedValue({ ok: false, status: 402 }),
        limiter: new DailyLimiter(5),
      }),
    ).rejects.toBeInstanceOf(IdeasFailedError);
  });
});
