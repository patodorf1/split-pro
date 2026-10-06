import { parseRecipeBody } from '~/lib/recipeBody';

describe('parseRecipeBody', () => {
  it('reads numbered steps with their lists and tips', () => {
    const body = [
      'Ingredientes',
      '- 4 huevos',
      '',
      '1. Condimentar la carne:',
      'Sobre las milanesas espolvoreá:',
      '- 3 cucharitas de sal',
      '- 2 de pimienta',
      'Tip: pisá el ajo con sal.',
      '',
      '2) Empanar',
      'consejo: doble empanado',
    ].join('\n');

    expect(parseRecipeBody(body)).toEqual({
      intro: [
        { type: 'text', text: 'Ingredientes' },
        { type: 'list', items: ['4 huevos'] },
      ],
      steps: [
        {
          number: 1,
          title: 'Condimentar la carne',
          blocks: [
            { type: 'text', text: 'Sobre las milanesas espolvoreá:' },
            { type: 'list', items: ['3 cucharitas de sal', '2 de pimienta'] },
            { type: 'tip', text: 'pisá el ajo con sal.' },
          ],
        },
        { number: 2, title: 'Empanar', blocks: [{ type: 'tip', text: 'doble empanado' }] },
      ],
    });
  });

  it('numbers the steps in order even if the text skips numbers', () => {
    const { steps } = parseRecipeBody('2. Dorar\n9. Servir');

    expect(steps.map((step) => [step.number, step.title])).toEqual([
      [1, 'Dorar'],
      [2, 'Servir'],
    ]);
  });

  it('turns a long step line into the text of the step', () => {
    const text =
      'Lavá bien el boniato y cortalo en cubos de dos o tres centímetros, con o sin piel.';

    expect(parseRecipeBody(`1. ${text}`).steps[0]).toEqual({
      number: 1,
      title: '',
      blocks: [{ type: 'text', text }],
    });
  });

  it('keeps tags as plain text', () => {
    expect(parseRecipeBody('<b>hola</b>').intro).toEqual([{ type: 'text', text: '<b>hola</b>' }]);
  });

  it('is empty for an empty body', () => {
    expect(parseRecipeBody('  \n ')).toEqual({ intro: [], steps: [] });
  });
});
