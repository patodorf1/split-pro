import { parseRecipeBody } from '~/lib/recipeBody';
import { buildImportSql, parseReviewedRecipes, vaultRecipeToBody } from '~/lib/recipeImport';

const review = (recipes: unknown[]) =>
  `Revisión\n\n| tabla |\n\n\`\`\`json\n${JSON.stringify(recipes, null, 2)}\n\`\`\`\n`;

const base = {
  title: 'Guiso de lentejas',
  kind: 'PLATOS',
  yield: 'Para 1,2 kg de lentejas',
  ingredients: [
    'lenteja',
    'chorizo',
    'panceta',
    'roastbeef',
    'tomate triturado',
    'papa',
    'cebolla',
    'zanahoria',
  ],
  file: 'Guiso.md',
};

/** "[1 con emoji de tecla]": el dígito, el selector de emoji y el cerco de tecla. */
const keycap = (digit: number) => `${digit}\u{FE0F}\u{20E3}`;

describe('parseReviewedRecipes', () => {
  it('reads the json block, maps the kinds and allows eight ingredients', () => {
    const [recipe] = parseReviewedRecipes(review([base]));

    expect(recipe).toMatchObject({
      title: 'Guiso de lentejas',
      kind: 'MAIN',
      yield: 'Para 1,2 kg de lentejas',
      file: 'Guiso.md',
    });
    expect(recipe?.ingredients).toHaveLength(8);
  });

  it('maps every kind of the review', () => {
    const kinds = parseReviewedRecipes(
      review([
        { ...base, kind: 'PROTEINAS' },
        { ...base, kind: 'Proteínas' },
        { ...base, kind: 'ENSALADAS' },
        { ...base, kind: 'GUARNICIONES' },
        { ...base, kind: 'SIDE' },
      ]),
    ).map((recipe) => recipe.kind);

    expect(kinds).toEqual(['PROTEIN', 'PROTEIN', 'SALAD', 'SIDE', 'SIDE']);
  });

  it('rejects unknown kinds and recipes without ingredients', () => {
    expect(() => parseReviewedRecipes(review([{ ...base, kind: 'POSTRES' }]))).toThrow();
    expect(() => parseReviewedRecipes(review([{ ...base, ingredients: [] }]))).toThrow();
  });

  it('fails clearly without a json block', () => {
    expect(() => parseReviewedRecipes('nada')).toThrow('bloque');
  });
});

describe('vaultRecipeToBody', () => {
  it('converts "Paso N" steps, tips and drops chat leftovers', () => {
    const markdown = [
      '# Milanesas de pollo',
      '',
      'Ajusto las cantidades para 1,8 kg:',
      '',
      '**Paso 1 — Condimentar la carne**',
      'Sobre las milanesas crudas espolvoreá:',
      '- 3 cucharitas de sal',
      '',
      '*Tip: pisar el ajo con sal ayuda.*',
      '',
      '¿Las cocinás hoy o freezás parte?',
    ].join('\n');

    expect(vaultRecipeToBody(markdown, 'Para 1,8 kg')).toBe(
      [
        '1. Condimentar la carne',
        'Sobre las milanesas crudas espolvoreá:',
        '- 3 cucharitas de sal',
        '',
        'Tip: pisar el ajo con sal ayuda.',
      ].join('\n'),
    );
  });

  it('drops the line that repeats the yield and keeps what follows the step title', () => {
    const markdown = [
      '# Guiso',
      '',
      '*Para 1,2 kg de lentejas*',
      '',
      '**Paso 2 — Dorar chorizo y panceta** — fuego medio-fuerte',
      'Cortá en rodajas:',
    ].join('\n');

    expect(vaultRecipeToBody(markdown, 'Para 1,2 kg de lentejas')).toBe(
      '2. Dorar chorizo y panceta — fuego medio-fuerte\nCortá en rodajas:',
    );
  });

  it('converts tab-numbered steps with round bullets', () => {
    const markdown = [
      '# Solomillo',
      '',
      '⸻',
      '',
      'Paso a paso:',
      '\t1.\tPreparar el solomillo:',
      '\t•\tSecalo con papel de cocina.',
      '\t2.\tSellar en sartén:',
      '\t•\tDorá 2-3 minutos por lado.',
    ].join('\n');

    const body = vaultRecipeToBody(markdown);

    expect(body).toBe(
      [
        '1. Preparar el solomillo:',
        '- Secalo con papel de cocina.',
        '2. Sellar en sartén:',
        '- Dorá 2-3 minutos por lado.',
      ].join('\n'),
    );
    expect(parseRecipeBody(body).steps.map((step) => step.title)).toEqual([
      'Preparar el solomillo',
      'Sellar en sartén',
    ]);
  });

  it('converts keycap emoji steps and drops decorative emojis', () => {
    const markdown = [
      '# Trucha',
      '',
      '⸻',
      '',
      `\u{1F52A} ${keycap(1)} Preparar la trucha`,
      '\t•\tSecala bien.',
      '',
      '\u{1F449} Condimentá la carne:',
      '\t•\tSal: 1 cucharadita',
      '',
      '⸻',
      '',
      `\u{1F34B} ${keycap(2)} Colocar los aromáticos`,
      '\t•\tRomero encima.',
    ].join('\n');

    expect(vaultRecipeToBody(markdown)).toBe(
      [
        '1. Preparar la trucha',
        '- Secala bien.',
        '',
        'Condimentá la carne:',
        '- Sal: 1 cucharadita',
        '',
        '2. Colocar los aromáticos',
        '- Romero encima.',
      ].join('\n'),
    );
  });

  it('keeps a dressing list when there are no steps', () => {
    const markdown =
      '**Ensalada de chauchas**\n\nAderezo:\n- 3 cdas aceite de oliva\n- Sal y pimienta';

    expect(vaultRecipeToBody(markdown)).toBe(
      'Aderezo:\n- 3 cdas aceite de oliva\n- Sal y pimienta',
    );
  });

  it('converts bold step numbers ("**1.** …") and bold step titles ("1. **Título.** …")', () => {
    const markdown = [
      '**Tomates salteados**',
      '',
      '**1.** Lavá y secá los tomates.',
      '- 300 g de tomates cherry',
      '',
      '2. **Salteá las verduras** en una sartén con:',
      ' - 1 cebolla en cubos',
    ].join('\n');

    const body = vaultRecipeToBody(markdown);

    expect(body).toBe(
      [
        '1. Lavá y secá los tomates.',
        '- 300 g de tomates cherry',
        '',
        '2. Salteá las verduras en una sartén con:',
        '- 1 cebolla en cubos',
      ].join('\n'),
    );
    expect(parseRecipeBody(body).steps).toHaveLength(2);
  });

  it('puts a tip written at the end of a line on its own line and drops trailing emojis', () => {
    const markdown = [
      '# Coliflor',
      '',
      '3. Mezclá bien. *Tip: no uses ajo en polvo.*',
      `4. Opcional: queso rallado encima. \u{1F9C0}`,
      `- Un toque de ají si querés picante \u{1F525}.`,
    ].join('\n');

    const body = vaultRecipeToBody(markdown);

    expect(body).toBe(
      [
        '3. Mezclá bien.',
        'Tip: no uses ajo en polvo.',
        '4. Opcional: queso rallado encima.',
        '- Un toque de ají si querés picante.',
      ].join('\n'),
    );
    expect(parseRecipeBody(body).steps[0]?.blocks).toEqual([
      { type: 'tip', text: 'no uses ajo en polvo.' },
    ]);
  });

  it('keeps the ingredient list that opens a recipe with steps', () => {
    const markdown = [
      '# Mini Shakshuka',
      '\u{1F373} Huevos al plato (2 porciones)',
      '',
      'Ingredientes',
      '\t•\tHuevos – 4 grandes',
      '\t•\tCebolla – 2 medianas',
      '',
      `${keycap(1)} Preparar la base`,
      '\t•\tPicar la cebolla.',
    ].join('\n');

    expect(vaultRecipeToBody(markdown)).toBe(
      [
        'Ingredientes',
        '- Huevos – 4 grandes',
        '- Cebolla – 2 medianas',
        '',
        '1. Preparar la base',
        '- Picar la cebolla.',
      ].join('\n'),
    );
  });
});

describe('buildImportSql', () => {
  it('builds repeatable inserts with escaped text', () => {
    const sql = buildImportSql(1, [
      {
        title: "Tarta d'atún",
        kind: 'MAIN',
        yieldText: null,
        body: '1. Hornear\n- 30 minutos',
        ingredients: ['Masa de tarta', 'atún', 'huevos', 'huevo'],
      },
    ]);

    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain("'Tarta d''atún'");
    expect(sql).toContain("'tarta d''atun'");
    expect(sql).toContain('ON CONFLICT ("groupId", "titleKey") DO NOTHING');
    expect(sql).toContain("'MAIN', NULL, '1. Hornear\n- 30 minutos', 'IMPORT'");
    expect(sql).toContain("('Masa de tarta', 'masa de tarta', 0)");
    expect(sql).toContain("('atún', 'atun', 1)");
    expect(sql).toContain("('huevos', 'huevo', 2)");
    expect(sql).not.toContain("'huevo', 'huevo'");
  });
});
