import { MAX_TODOS_PER_BATCH, cleanTodoTitle, parseTodoItems } from '~/lib/todo';

describe('cleanTodoTitle', () => {
  it('drops bullets and extra spaces but keeps punctuation', () => {
    expect(cleanTodoTitle('  - Arreglar   la canilla ')).toBe('Arreglar la canilla');
    expect(cleanTodoTitle('2) ¿Llamar al cerrajero?')).toBe('¿Llamar al cerrajero?');
    expect(cleanTodoTitle('[x] Pintar la reja')).toBe('Pintar la reja');
  });
});

describe('parseTodoItems', () => {
  it('splits by line, not by comma', () => {
    expect(parseTodoItems('Pintar, lijar antes\nCambiar foco')).toEqual([
      'Pintar, lijar antes',
      'Cambiar foco',
    ]);
  });

  it('skips empty and repeated lines', () => {
    expect(parseTodoItems('Regar\n\n  \nregar\nPodar')).toEqual(['Regar', 'Podar']);
  });

  it('caps the batch', () => {
    const text = Array.from({ length: MAX_TODOS_PER_BATCH + 5 }, (_, i) => `Tarea ${i}`).join('\n');
    expect(parseTodoItems(text)).toHaveLength(MAX_TODOS_PER_BATCH);
  });
});
